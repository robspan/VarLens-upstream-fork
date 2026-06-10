import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import fastify from 'fastify'
import { describe, expect, test } from 'vitest'

import { registerImportUploadRoutes } from '../../src/web/server/routes/upload-staging'
import { makeDeps } from './helpers/dispatcher-adapters'

describe('web import upload route audit', () => {
  test('staged uploads record a sanitized api_write audit event', async () => {
    const prevUploadDir = process.env.VARLENS_WEB_UPLOAD_DIR
    const uploadDir = await mkdtemp(join(tmpdir(), 'varlens-upload-audit-'))
    process.env.VARLENS_WEB_UPLOAD_DIR = uploadDir
    try {
      const { deps, writeExecute } = makeDeps()
      const app = fastify()
      app.addHook('preHandler', async (request) => {
        request.session = {
          user: { id: 7, username: 'admin', role: 'admin', passwordChangedAt: null }
        } as never
      })
      registerImportUploadRoutes(app, deps)

      const response = await app.inject({
        method: 'POST',
        url: '/api/import/upload',
        headers: {
          'content-type': 'application/octet-stream',
          'x-varlens-file-name': 'Case A.json'
        },
        payload: Buffer.from('{}')
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        fileName: 'Case A.json',
        size: 2
      })
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'audit:append',
        params: [
          {
            action_type: 'api_write',
            entity_type: 'api_call',
            entity_key: 'import:upload',
            old_value: null,
            new_value: { success: true, method: 'import:upload' },
            user_name: 'admin',
            metadata: { source: 'web-dispatcher' }
          }
        ]
      })
      expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('Case A.json')
      await app.close()
    } finally {
      if (prevUploadDir === undefined) delete process.env.VARLENS_WEB_UPLOAD_DIR
      else process.env.VARLENS_WEB_UPLOAD_DIR = prevUploadDir
      await rm(uploadDir, { recursive: true, force: true })
    }
  })
})
