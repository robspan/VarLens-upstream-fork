import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * §app2.1 Phase 1 gate — `/healthz` returns 200 with `{ status, version, db }`
 * on a healthy server. The boot path is fail-loud (see fail-loud.test.ts):
 * an unreachable DB rejects buildApp instead of producing a 503-serving
 * half-server, so the runtime 503 path is exercised by code-level checks
 * only (kept as defensive coverage for post-boot DB failures).
 *
 * SKIPPED until the web build target lands (`out/web/server.cjs`). At
 * that point this test activates automatically. Imports are dynamic so
 * the file resolves even before `fastify` / `light-my-request` are
 * installed.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

describe.skipIf(!isWebBuilt)('healthz integration', () => {
  test('GET /healthz returns 200 with status payload when DB is open', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp({ db: ':memory:' })
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({
        status: 'ok',
        version: expect.any(String),
        db: expect.objectContaining({ open: true })
      })
    } finally {
      await app.close()
    }
  })

  test('buildApp rejects when DB path is unreachable (fail-loud contract)', async () => {
    const { buildApp } = await import('../../../src/web/server')
    await expect(
      buildApp({ db: '/nonexistent/path/that/cannot/be/created/varlens.db' })
    ).rejects.toThrow()
  })
})
