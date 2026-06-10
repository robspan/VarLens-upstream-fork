/**
 * Audit-log read gating (spec AS-5): audit:query / audit:getByEntity are
 * admin-only overrides, not autorouted read tasks. The trail contains
 * employee activity (logins, API access), so clinical users must not be
 * able to browse it — and an admin reading it is itself an audited access.
 */
import { describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { isReadTaskType } from '../../src/web/server/task-types'
import { makeDeps } from './helpers/dispatcher-adapters'

function buildApp(
  deps: ReturnType<typeof makeDeps>['deps'],
  role: 'admin' | 'user'
): FastifyInstance {
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    request.session = {
      user: {
        id: 1,
        username: role === 'admin' ? 'admin' : 'analyst',
        role,
        passwordChangedAt: null
      }
    } as never
  })
  registerDispatcher(app, deps, buildDispatcher(deps).overrides)
  return app
}

describe('web dispatcher: audit-log read gating', () => {
  test('audit reads are not autorouted read tasks', () => {
    expect(isReadTaskType('audit:query')).toBe(false)
    expect(isReadTaskType('audit:getByEntity')).toBe(false)
  })

  test('non-admin audit:query and audit:getByEntity return 403 without touching storage or the trail', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const app = buildApp(deps, 'user')

    const query = await app.inject({
      method: 'POST',
      url: '/api/audit/query',
      payload: { args: [{ limit: 10 }] }
    })
    const byEntity = await app.inject({
      method: 'POST',
      url: '/api/audit/getByEntity',
      payload: { args: ['1:100:A:G'] }
    })

    expect(query.statusCode).toBe(403)
    expect(byEntity.statusCode).toBe(403)
    expect(query.json()).toMatchObject({ details: { error: 'admin-required' } })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
    await app.close()
  })

  test('admin audit:query succeeds and the access is itself read-audited', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const app = buildApp(deps, 'admin')

    const query = await app.inject({
      method: 'POST',
      url: '/api/audit/query',
      payload: { args: [{ limit: 10 }] }
    })

    expect(query.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith({ type: 'audit:query', params: [{ limit: 10 }] })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: 'audit:query',
          old_value: null,
          new_value: { success: true, method: 'audit:query' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    await app.close()
  })

  test('admin audit:getByEntity delegates to the read executor', async () => {
    const { deps, execute } = makeDeps()
    const app = buildApp(deps, 'admin')

    const byEntity = await app.inject({
      method: 'POST',
      url: '/api/audit/getByEntity',
      payload: { args: ['1:100:A:G'] }
    })

    expect(byEntity.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith({ type: 'audit:getByEntity', params: ['1:100:A:G'] })
    await app.close()
  })
})
