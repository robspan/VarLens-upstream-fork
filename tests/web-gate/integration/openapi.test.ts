import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

import { startWebDriver } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('web OpenAPI endpoint', () => {
  test('requires an authenticated session and exposes the compatibility dispatcher route', async () => {
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
    } finally {
      await driver.close()
    }
  })
})
