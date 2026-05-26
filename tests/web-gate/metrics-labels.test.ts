import { describe, expect, test } from 'vitest'

import { AppMetrics, resolveMetricsRoute, startMetricsServer } from '../../src/web/server/metrics'

describe('web metrics route labels', () => {
  test('uses documented OpenAPI paths as stable API route labels', () => {
    expect(resolveMetricsRoute('POST', '/api/auth/login')).toBe('/api/auth/login')
    expect(resolveMetricsRoute('POST', '/api/cases/list')).toBe('/api/cases/list')
    expect(resolveMetricsRoute('GET', '/api/openapi.json')).toBe('/api/openapi.json')
  })

  test('groups unknown API routes without raw-path cardinality', () => {
    expect(resolveMetricsRoute('POST', '/api/not-a-domain/not-a-method')).toBe('unknown')
    expect(resolveMetricsRoute('GET', '/api/cases/list')).toBe('unknown')
    expect(resolveMetricsRoute('POST', '/api/cases/list/extra')).toBe('unknown')
  })

  test('renders Prometheus text with app and environment labels', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })
    metrics.beginRequest('POST', '/api/auth/login')
    metrics.endRequest('POST', '/api/auth/login', 200, 0.021)
    metrics.setDatabaseHealthy(true)

    const text = metrics.metricsText()
    expect(text).toContain(
      'http_requests_total{app="varlens",environment="test",method="POST",route="/api/auth/login",status="200"} 1'
    )
    expect(text).toContain('http_request_duration_seconds_bucket')
    expect(text).toContain('http_requests_in_flight')
    expect(text).toContain('varlens_database_healthy{app="varlens",environment="test"} 1')
    expect(text).toContain('process_resident_memory_bytes')
  })

  test('escapes line breaks in label values', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'prod\ncanary' })
    metrics.beginRequest('POST', '/api/auth/login')
    metrics.endRequest('POST', '/api/auth/login', 200, 0.021)

    const text = metrics.metricsText()
    expect(text).toContain('environment="prod\\ncanary"')
    expect(text).not.toContain('environment="prod\ncanary"')
  })

  test('rejects invalid metrics scrape paths before binding', async () => {
    const result = await startMetricsServer({
      metrics: new AppMetrics({ app: 'varlens', environment: 'test' }),
      host: '127.0.0.1',
      port: 0,
      path: 'metrics'
    }).then(
      async (server) => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) reject(error)
            else resolve()
          })
        })
        return 'resolved'
      },
      (error: unknown) => error
    )

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('VARLENS_METRICS_PATH')
  })
})
