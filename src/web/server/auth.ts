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
    /**
     * Sticky bit set on login when the authenticated user has
     * must_change_password=TRUE in the DB; cleared by the
     * auth:changePassword override on success. The dispatcher's
     * pre-rotation gate reads this directly from the session so
     * every request doesn't have to re-query the DB.
     */
    mustChangePassword: boolean
  }
}

const DEFAULT_RECOVERY_KEY_DIR = '/data'
const SESSION_SECRET_FILENAME = 'web-session-secret'

/**
 * Cookie name. In production we use the `__Host-` prefix, which the
 * browser binds to:
 *   - Path=/ (we set this)
 *   - Secure (we set this)
 *   - no Domain attribute (we don't set Domain)
 *
 * Browsers reject `__Host-` cookies that don't satisfy all three, so
 * the prefix turns "I configured this cookie correctly" into a
 * runtime invariant. Dev (HTTP) drops the prefix because Secure
 * isn't possible there.
 */
function resolveSessionCookieName(): string {
  return isProductionMode() ? '__Host-varlens.sid' : 'varlens.sid'
}

/**
 * Production mode = anything but explicit dev. We default-deny
 * insecurity: only NODE_ENV=development relaxes Secure, and only
 * NODE_ENV=test relaxes it for the test runner. Anything else
 * (including missing NODE_ENV in a packaged image) gets the
 * production cookie posture.
 */
function isProductionMode(): boolean {
  const env = process.env.NODE_ENV
  return env !== 'development' && env !== 'test'
}

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
  const production = isProductionMode()

  await app.register(secureSession, {
    key,
    cookieName: resolveSessionCookieName(),
    cookie: {
      path: '/',
      httpOnly: true,
      // SameSite=Strict for an admin-only single-tenant tool with no
      // cross-site flows (no SSO redirect, no embeds, no third-party
      // links coming back into authenticated pages). Lax was a
      // legacy-from-desktop default that opened a window for
      // cross-site GET-triggered side effects; Strict closes it.
      sameSite: 'strict',
      // Production: Secure is non-negotiable — `__Host-` prefix
      // *requires* Secure, and we never want a session cookie
      // travelling over HTTP. Dev / test: drop Secure so localhost
      // HTTP works; the cookie name also drops the __Host- prefix
      // there so browsers don't reject the Set-Cookie outright.
      secure: production,
      // 4h max-age. An admin tool that's used in burst sessions
      // doesn't need a multi-day cookie; the shorter window limits
      // exposure if a laptop is briefly unattended. Re-login is
      // cheap.
      maxAge: 60 * 60 * 4
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
