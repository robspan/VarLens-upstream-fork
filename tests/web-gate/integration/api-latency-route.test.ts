import { describe, expect, test } from 'vitest'

import { startIsolatedWebSchema } from '../helpers/web-driver'

const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!HAS_PG)('web dev API latency route', () => {
  test('delays real /api dispatcher calls in development only', async () => {
    const isolated = await startIsolatedWebSchema('api_latency_route')
    const previousLatency = process.env.VARLENS_WEB_API_LATENCY_MS
    try {
      process.env.NODE_ENV = 'development'
      process.env.VARLENS_WEB_API_LATENCY_MS = '120'

      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const started = performance.now()
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/isAccountsEnabled',
          payload: { args: [] }
        })
        const elapsedMs = performance.now() - started

        expect(res.statusCode, res.body).toBe(200)
        expect(elapsedMs).toBeGreaterThanOrEqual(100)
      } finally {
        await app.close()
      }
    } finally {
      if (previousLatency === undefined) delete process.env.VARLENS_WEB_API_LATENCY_MS
      else process.env.VARLENS_WEB_API_LATENCY_MS = previousLatency
      await isolated.close()
    }
  })
})
