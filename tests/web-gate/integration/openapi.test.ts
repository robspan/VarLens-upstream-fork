import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

import { startWebDriver } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('web OpenAPI endpoint', () => {
  test('requires an authenticated session and exposes dispatcher and auth method paths', async () => {
    const driver = await startWebDriver()
    try {
      const unauthenticated = await driver.app.inject({
        method: 'GET',
        url: '/api/openapi.json'
      })
      expect(unauthenticated.statusCode, unauthenticated.body).toBe(401)

      const authenticated = await driver.app.inject({
        method: 'GET',
        url: '/api/openapi.json',
        headers: { cookie: driver.cookie }
      })
      expect(authenticated.statusCode, authenticated.body).toBe(200)

      const spec = authenticated.json() as {
        openapi?: string
        info?: { title?: string }
        paths?: Record<string, unknown>
      }
      expect(spec.openapi).toMatch(/^3\./)
      expect(spec.info?.title).toBe('VarLens Web API')
      expect(spec.paths).toHaveProperty('/api/{domain}/{method}')
      expect(spec.paths).toHaveProperty('/api/auth/login')
      expect(spec.paths).toHaveProperty('/api/auth/changePassword')
      expect(spec.paths).toHaveProperty('/api/cases/list')
      expect(spec.paths).toHaveProperty('/api/cohort/getVariants')
      expect(spec.paths).toHaveProperty('/api/cohort/runAssociation')
      expect(spec.paths).toHaveProperty('/api/cohort/getSummaryStatus')
      expect(spec.paths).toHaveProperty('/api/database/info')
      expect(spec.paths).toHaveProperty('/api/database/recentList')
      expect(spec.paths).toHaveProperty('/api/export/variants')
      expect(spec.paths).toHaveProperty('/api/export/cohort')
      expect(spec.paths).toHaveProperty('/api/variants/query')
      expect(spec.paths).toHaveProperty('/api/variants/getFilterOptions')

      const paths = spec.paths as Record<
        string,
        { post?: { requestBody?: unknown; responses?: Record<string, unknown> } }
      >
      expect(paths['/api/auth/login']?.post?.requestBody).toBeDefined()
      expect(paths['/api/auth/changePassword']?.post?.requestBody).toBeDefined()
      expect(paths['/api/cases/list']?.post?.requestBody).toBeDefined()
      expect(paths['/api/cases/list']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/cohort/getVariants']?.post?.requestBody).toBeDefined()
      expect(paths['/api/cohort/getSummaryStatus']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/cohort/runAssociation']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/cohort/runAssociation']?.post?.responses?.['200']).toBeUndefined()
      expect(paths['/api/database/info']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/database/recentList']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/variants']?.post?.requestBody).toBeDefined()
      expect(paths['/api/export/variants']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/variants']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.requestBody).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/variants/query']?.post?.requestBody).toBeDefined()
      expect(paths['/api/variants/query']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/variants/getFilterOptions']?.post?.requestBody).toBeDefined()
      expect(paths['/api/variants/getFilterOptions']?.post?.responses?.['200']).toBeDefined()
    } finally {
      await driver.close()
    }
  })

  test('keeps dispatcher calls with no request body compatible', async () => {
    const driver = await startWebDriver()
    try {
      const res = await driver.app.inject({
        method: 'POST',
        url: '/api/auth/isAccountsEnabled',
        headers: { cookie: driver.cookie }
      })

      expect(res.statusCode, res.body).toBe(200)
      expect(res.json()).toBe(true)
    } finally {
      await driver.close()
    }
  })
})
