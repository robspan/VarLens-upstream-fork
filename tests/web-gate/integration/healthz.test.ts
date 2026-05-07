import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Phase 2: `/healthz` returns 200 with `{ status, version, db }` on a
 * healthy server. The boot path is fail-loud — buildApp rejects when
 * VARLENS_PG_URL is missing or the configured Postgres is unreachable.
 *
 * Gated on (a) the web build existing AND (b) VARLENS_PG_URL being set.
 * Without VARLENS_PG_URL the new postgres-required.test.ts covers the
 * abort-without-pg behaviour. Without out/web/server.cjs (no `make
 * build`) we skip to keep dev iteration fast.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('healthz integration', () => {
  test('GET /healthz returns 200 with status payload when Postgres is open', async () => {
    const { buildApp } = await import('../../../src/web/server')
    const app = await buildApp()
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
})
