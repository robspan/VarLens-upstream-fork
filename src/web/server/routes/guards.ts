import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * 403s the request unless the session user is an admin. Returns the
 * admin's identity for audit attribution, or undefined after setting
 * the status code — callers return their own error payload.
 */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): { username: string } | undefined {
  const user = request.session?.user
  if (user?.role !== 'admin') {
    reply.code(403)
    return undefined
  }
  return { username: user.username }
}
