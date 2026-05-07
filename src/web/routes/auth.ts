/**
 * Web routes for the `auth` domain.
 *
 * Phase 2: backend-agnostic. The route consumes a `WebAuthService`
 * interface (authenticate-only for Phase 1; createUser / changePassword /
 * deactivate land with the auth-scenarios parity work). The web variant
 * is Postgres-only in production but the interface is shaped so the
 * desktop AuthService could be wrapped behind it for any future shared
 * runner; today only PostgresWebAuthService implements it.
 *
 * Cookie / session management is intentionally minimal here — Phase 1
 * single-user means the gate-criterion is "login works in browser",
 * not "session lifecycle is production-grade." Session hardening lands
 * with the auth parity scenarios in
 * tests/web-gate/parity/auth-scenarios.parity.test.ts.
 */
import type { FastifyInstance } from 'fastify'

export interface WebAuthService {
  authenticate(
    username: string,
    password: string
  ): Promise<{
    success: boolean
    user: unknown
    locked?: boolean
    mustChangePassword?: boolean
  }>
}

interface LoginBody {
  username?: unknown
  password?: unknown
}

export function registerAuthRoutes(
  app: FastifyInstance,
  getAuthService: () => WebAuthService
): void {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      reply.code(400)
      return { error: 'username and password (string) required' }
    }
    return await getAuthService().authenticate(username, password)
  })
}
