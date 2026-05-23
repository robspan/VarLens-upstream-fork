import { createServer, type Server } from 'http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { buildDocumentedDispatcherPathSet } from './routes/openapi-paths'

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const documentedApiPaths = buildDocumentedDispatcherPathSet()

type LabelValue = string | number
type Labels = Record<string, LabelValue>

interface HistogramState {
  buckets: Map<number, number>
  count: number
  sum: number
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${String(labels[key])}`)
    .join('\n')
}

function labelText(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${String(labels[key]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

function metricLine(name: string, labels: Labels, value: number): string {
  const text = labelText(labels)
  return `${name}${text === '' ? '' : `{${text}}`} ${value}`
}

function pathName(url: string): string {
  try {
    return new URL(url, 'http://varlens.local').pathname
  } catch {
    return 'unknown'
  }
}

export function resolveMetricsRoute(method: string, url: string): string {
  const pathname = pathName(url)
  if (pathname === '/healthz' || pathname === '/api/openapi.json') return pathname

  if (method === 'POST' && /^\/api\/[^/]+\/[^/]+$/.test(pathname)) {
    return documentedApiPaths.has(pathname) ? pathname : 'unknown'
  }

  if (pathname.startsWith('/api/')) return 'unknown'
  return 'static'
}

export class AppMetrics {
  private readonly baseLabels: Labels
  private readonly requests = new Map<string, { labels: Labels; value: number }>()
  private readonly inFlight = new Map<string, { labels: Labels; value: number }>()
  private readonly durations = new Map<string, { labels: Labels; state: HistogramState }>()
  private dbHealthy = 0
  private readonly startedAt = Date.now() / 1000

  constructor(options: { app: string; environment: string }) {
    this.baseLabels = {
      app: options.app,
      environment: options.environment
    }
  }

  beginRequest(method: string, route: string): void {
    const labels = { ...this.baseLabels, method, route }
    const key = labelKey(labels)
    const current = this.inFlight.get(key)
    this.inFlight.set(key, { labels, value: (current?.value ?? 0) + 1 })
  }

  endRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const inFlightLabels = { ...this.baseLabels, method, route }
    const inFlightKey = labelKey(inFlightLabels)
    const current = this.inFlight.get(inFlightKey)
    this.inFlight.set(inFlightKey, {
      labels: inFlightLabels,
      value: Math.max(0, (current?.value ?? 0) - 1)
    })

    const requestLabels = { ...this.baseLabels, method, route, status }
    const requestKey = labelKey(requestLabels)
    const request = this.requests.get(requestKey)
    this.requests.set(requestKey, { labels: requestLabels, value: (request?.value ?? 0) + 1 })

    const duration = this.durations.get(requestKey) ?? {
      labels: requestLabels,
      state: {
        buckets: new Map(DEFAULT_BUCKETS.map((bucket) => [bucket, 0])),
        count: 0,
        sum: 0
      }
    }
    duration.state.count += 1
    duration.state.sum += durationSeconds
    for (const bucket of DEFAULT_BUCKETS) {
      if (durationSeconds <= bucket) {
        duration.state.buckets.set(bucket, (duration.state.buckets.get(bucket) ?? 0) + 1)
      }
    }
    this.durations.set(requestKey, duration)
  }

  setDatabaseHealthy(value: boolean): void {
    this.dbHealthy = value ? 1 : 0
  }

  contentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8'
  }

  metricsText(): string {
    const lines: string[] = []
    lines.push('# HELP http_requests_total Total HTTP requests.')
    lines.push('# TYPE http_requests_total counter')
    for (const metric of this.requests.values()) {
      lines.push(metricLine('http_requests_total', metric.labels, metric.value))
    }

    lines.push('# HELP http_request_duration_seconds HTTP request duration.')
    lines.push('# TYPE http_request_duration_seconds histogram')
    for (const metric of this.durations.values()) {
      for (const bucket of DEFAULT_BUCKETS) {
        lines.push(
          metricLine(
            'http_request_duration_seconds_bucket',
            { ...metric.labels, le: bucket },
            metric.state.buckets.get(bucket) ?? 0
          )
        )
      }
      lines.push(
        metricLine(
          'http_request_duration_seconds_bucket',
          { ...metric.labels, le: '+Inf' },
          metric.state.count
        )
      )
      lines.push(metricLine('http_request_duration_seconds_sum', metric.labels, metric.state.sum))
      lines.push(
        metricLine('http_request_duration_seconds_count', metric.labels, metric.state.count)
      )
    }

    lines.push('# HELP http_requests_in_flight Current in-flight HTTP requests.')
    lines.push('# TYPE http_requests_in_flight gauge')
    for (const metric of this.inFlight.values()) {
      lines.push(metricLine('http_requests_in_flight', metric.labels, metric.value))
    }

    lines.push('# HELP varlens_database_healthy Database health from the latest health check.')
    lines.push('# TYPE varlens_database_healthy gauge')
    lines.push(metricLine('varlens_database_healthy', this.baseLabels, this.dbHealthy))

    lines.push('# HELP process_start_time_seconds Start time of the Node.js process.')
    lines.push('# TYPE process_start_time_seconds gauge')
    lines.push(metricLine('process_start_time_seconds', this.baseLabels, this.startedAt))

    lines.push('# HELP process_uptime_seconds Uptime of the Node.js process.')
    lines.push('# TYPE process_uptime_seconds gauge')
    lines.push(metricLine('process_uptime_seconds', this.baseLabels, process.uptime()))

    const memory = process.memoryUsage()
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.')
    lines.push('# TYPE process_resident_memory_bytes gauge')
    lines.push(metricLine('process_resident_memory_bytes', this.baseLabels, memory.rss))
    lines.push('# HELP nodejs_heap_size_used_bytes Node.js heap used in bytes.')
    lines.push('# TYPE nodejs_heap_size_used_bytes gauge')
    lines.push(metricLine('nodejs_heap_size_used_bytes', this.baseLabels, memory.heapUsed))

    return `${lines.join('\n')}\n`
  }
}

export function createAppMetricsFromEnv(env: NodeJS.ProcessEnv = process.env): AppMetrics {
  return new AppMetrics({
    app: env.VARLENS_OBSERVABILITY_APP?.trim() || 'varlens',
    environment: env.VARLENS_OBSERVABILITY_ENVIRONMENT?.trim() || env.NODE_ENV || 'unknown'
  })
}

export function registerRequestMetrics(app: FastifyInstance, metrics: AppMetrics): void {
  const requests = new WeakMap<FastifyRequest, { start: bigint; method: string; route: string }>()

  app.addHook('onRequest', async (request) => {
    const method = request.method
    const route = resolveMetricsRoute(method, request.url)
    requests.set(request, { start: process.hrtime.bigint(), method, route })
    metrics.beginRequest(method, route)
  })

  app.addHook('onResponse', async (request, reply) => {
    recordResponse(metrics, requests, request, reply)
  })
}

function recordResponse(
  metrics: AppMetrics,
  requests: WeakMap<FastifyRequest, { start: bigint; method: string; route: string }>,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const state = requests.get(request)
  if (state === undefined) return
  const durationSeconds = Number(process.hrtime.bigint() - state.start) / 1_000_000_000
  metrics.endRequest(state.method, state.route, reply.statusCode, durationSeconds)
  requests.delete(request)
}

export function startMetricsServer(options: {
  metrics: AppMetrics
  host: string
  port: number
  path?: string
}): Promise<Server> {
  const metricsPath = options.path ?? '/metrics'
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || pathName(request.url ?? '/') !== metricsPath) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    response.writeHead(200, { 'content-type': options.metrics.contentType() })
    response.end(options.metrics.metricsText())
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
