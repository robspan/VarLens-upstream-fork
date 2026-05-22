import type { FastifyReply } from 'fastify'

export function unsupportedWebCapability(
  reply: FastifyReply,
  capability: string
): {
  error: string
  capability: string
  message: string
} {
  reply.code(501)
  return {
    error: 'unsupported-web-capability',
    capability,
    message: `${capability} is not available in web mode yet.`
  }
}
