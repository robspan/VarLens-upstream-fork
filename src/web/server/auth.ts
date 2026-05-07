/**
 * Web-mode session + auth gate.
 *
 * Stateless signed-encrypted cookie sessions via @fastify/secure-session.
 * The cookie holds `{ user: { id, username, role } }` and nothing else;
 * there is no server-side session store. This matches the project's
 * "single-user-style auth, no roles" stance — every authenticated
 * request is treated identically; the only access decision is "do you
 * have a valid session cookie or not."
 *
 * Secret resolution, in order:
 *
 *   1. `VARLENS_SESSION_SECRET_HEX` env var (64 hex chars = 32 bytes)
 *   2. `<recoveryKeyDir>/web-session-secret` file (created on first
 *      boot, mode 0600)
 *
 * The recovery-key dir defaults to `/data` (same as the admin
 * recovery key) so a single mounted volume covers both secrets.
 *
 * preHandler gate: any request whose path starts with `/api/` is
 * 401'd unless `request.session.user` is present, with two exceptions:
 *
 *   - `/api/auth/login`
 *   - `/api/auth/isAccountsEnabled`
 *
 * `/healthz` and static assets bypass the gate naturally because
 * they don't start with `/api/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { randomBytes } from 'crypto'

import type { FastifyInstance } from 'fastify'
import secureSession from '@fastify/secure-session'

declare module '@fastify/secure-session' {
  interface SessionData {
    user: { id: number; username: string; role: string }
  }
}

const DEFAULT_RECOVERY_KEY_DIR = '/data'
const SESSION_SECRET_FILENAME = 'web-session-secret'
const SESSION_COOKIE_NAME = 'varlens.sid'

const PUBLIC_API_PATHS = new Set<string>(['/api/auth/login', '/api/auth/isAccountsEnabled'])

function resolveRecoveryKeyDir(): string {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  const dir = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_RECOVERY_KEY_DIR
  if (!isAbsolute(dir)) {
    throw new Error(
      `VARLENS_RECOVERY_KEY_DIR must be an absolute path; got: ${JSON.stringify(dir)}`
    )
  }
  return dir
}

function loadOrCreateSessionKey(): Buffer {
  const fromEnv = process.env.VARLENS_SESSION_SECRET_HEX
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const buf = Buffer.from(fromEnv.trim(), 'hex')
    if (buf.length !== 32) {
      throw new Error(
        `VARLENS_SESSION_SECRET_HEX must decode to exactly 32 bytes; got ${buf.length}`
      )
    }
    return buf
  }

  const dir = resolveRecoveryKeyDir()
  const path = join(dir, SESSION_SECRET_FILENAME)
  if (existsSync(path)) {
    const buf = readFileSync(path)
    if (buf.length !== 32) {
      throw new Error(
        `Session-secret file at ${path} is corrupt: expected 32 bytes, got ${buf.length}. ` +
          'Delete the file to regenerate (this invalidates all current sessions).'
      )
    }
    return buf
  }

  // Generate-on-first-boot. Persisting it means restarts don't sign
  // every user out — important for a single-tenant deployment.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const generated = randomBytes(32)
  writeFileSync(path, generated, { mode: 0o600 })
  return generated
}

export async function registerSessions(app: FastifyInstance): Promise<void> {
  const key = loadOrCreateSessionKey()

  await app.register(secureSession, {
    key,
    cookieName: SESSION_COOKIE_NAME,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // `secure: true` requires HTTPS. Caddy terminates TLS in
      // production; the dev container runs over plain HTTP. Read
      // from env so we don't accidentally lock dev out.
      secure: process.env.VARLENS_SESSION_COOKIE_SECURE !== '0',
      maxAge: 60 * 60 * 8 // 8 hours
    }
  })

  app.addHook('preHandler', async (request, reply) => {
    const url = request.url
    // Strip query string for the gate decision.
    const path = url.split('?', 1)[0]

    if (!path.startsWith('/api/')) return
    if (PUBLIC_API_PATHS.has(path)) return

    if (request.session.user === undefined) {
      reply.code(401)
      return reply.send({
        code: 'UNAUTHENTICATED',
        message: 'authentication required',
        userMessage: 'Please log in to continue.'
      })
    }
  })
}
