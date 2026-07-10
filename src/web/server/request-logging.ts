import type { FastifyRequest } from 'fastify'

const REDACTED_QUERY = '?<redacted>'

export function redactRequestLogUrl(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : `${url.slice(0, queryIndex)}${REDACTED_QUERY}`
}

export function serializeRequestForTechnicalLog(request: FastifyRequest): {
  method: string
  url: string
  version: string | string[] | undefined
  host: string
  remoteAddress: string
  remotePort: number | undefined
} {
  return {
    method: request.method,
    url: redactRequestLogUrl(request.url),
    version: request.headers['accept-version'],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort
  }
}
