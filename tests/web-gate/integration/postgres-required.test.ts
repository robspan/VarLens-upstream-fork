import { describe, expect, test } from 'vitest'

/**
 * Phase 2 #4: web mode is Postgres-only. buildApp must reject before
 * doing anything else when VARLENS_PG_URL is missing — the operator
 * needs to see the env-var gate at preflight, not after a half-spun
 * Fastify instance has bound a port.
 *
 * This test goes RED while the SQLite branch is still in src/web/
 * server.ts; GREEN once it's removed and the bare path requires
 * Postgres config.
 */

describe('web server — Postgres requirement', () => {
  test('buildApp rejects when VARLENS_PG_URL is not set (fail-loud contract)', async () => {
    const prev = process.env.VARLENS_PG_URL
    delete process.env.VARLENS_PG_URL
    try {
      const { buildApp } = await import('../../../src/web/server')
      await expect(buildApp({} as never)).rejects.toThrow(/VARLENS_PG_URL/i)
    } finally {
      if (prev !== undefined) process.env.VARLENS_PG_URL = prev
    }
  })
})
