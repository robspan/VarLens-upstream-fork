import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Phase 1 gate — `/healthz` returns 200 with `{ status, version, db }` on
 * a healthy server, 503 when the database is unreachable.
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

  test('GET /healthz returns 503 when DB is unreachable', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp({ db: '/nonexistent/path/that/cannot/be/created' })
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' })
      expect(res.statusCode).toBe(503)
    } finally {
      await app.close().catch(() => {})
    }
  })
})
