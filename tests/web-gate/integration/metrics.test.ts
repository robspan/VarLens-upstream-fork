import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

import { AppMetrics, startMetricsServer } from '../../../src/web/server/metrics'
import { startWebDriver } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('web metrics integration', () => {
  test('records documented API calls with stable route labels', async () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })
    const driver = await startWebDriver({ metrics })
    try {
      const res = await driver.app.inject({
        method: 'POST',
        url: '/api/auth/isAccountsEnabled',
        headers: { cookie: driver.cookie, origin: 'http://localhost', host: 'localhost' }
      })
      expect(res.statusCode, res.body).toBe(200)

      const text = metrics.metricsText()
      expect(text).toContain('route="/api/auth/isAccountsEnabled"')
      expect(text).toContain(
        'varlens_ipc_requests_total{app="varlens",environment="test",ipc="auth:isAccountsEnabled",status="success"} 1'
      )
      expect(text).not.toContain('/api/auth/isAccountsEnabled?')
    } finally {
      await driver.close()
    }
  })

  test('serves metrics from a separate unauthenticated HTTP listener', async () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })
    metrics.beginRequest('GET', '/healthz')
    metrics.endRequest('GET', '/healthz', 200, 0.01)
    const server = await startMetricsServer({
      metrics,
      host: '127.0.0.1',
      port: 0,
      path: '/metrics'
    })
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('metrics server did not bind a TCP address')
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/metrics`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/plain')
      expect(await res.text()).toContain('http_requests_total')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error)
          else resolve()
        })
      })
    }
  })
})
