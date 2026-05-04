/**
 * Web routes for the `auth` domain.
 *
 * Imports `login` from src/main/ipc/handlers/auth-logic.ts — same function
 * the Electron IPC layer registers. Phase 1 password-only flow; the
 * Credential discriminated union ({kind:'password'} | {kind:'token'}) at
 * src/main/auth/types.ts shapes the future OIDC retrofit.
 *
 * Cookie/session management is intentionally minimal here — Phase 1
 * single-user means the gate-criterion is "login works in browser",
 * not "session lifecycle is production-grade." Session hardening lands
 * with the auth parity scenarios in
 * tests/web-gate/parity/auth-scenarios.parity.test.ts.
 */
import type { FastifyInstance } from 'fastify'

import { login } from '../../main/ipc/handlers/auth-logic'
import type { DatabaseService } from '../../main/database/DatabaseService'

interface LoginBody {
  username?: unknown
  password?: unknown
}

export function registerAuthRoutes(app: FastifyInstance, getDb: () => DatabaseService): void {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      reply.code(400)
      return { error: 'username and password (string) required' }
    }

    return await login(username, password, getDb)
  })
}
