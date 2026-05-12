/**
 * VarLens web server entrypoint — Postgres-only.
 *
 * Phase 2: SQLite branch removed. The web mode now requires
 * VARLENS_PG_URL and refuses to boot without it. Desktop SQLite stays
 * untouched in src/main/.
 *
 *   - Fastify app with Pino JSON logging
 *   - `/healthz` (200/503)
 *   - SIGTERM/SIGINT graceful shutdown
 *   - Postgres-backed StorageSession (cases, variants) and
 *     PostgresWebAuthService (auth)
 *   - Recovery-key file path comes from VARLENS_RECOVERY_KEY_DIR
 *     (default `/data`) — was derived from VARLENS_DB_PATH in Phase 1
 *   - Fail-loud boot: missing VARLENS_PG_URL aborts before any port
 *     is bound; missing VARLENS_RECOVERY_KEY_DIR (when admin bootstrap
 *     is requested) likewise.
 *
 * Two consumers:
 *   - tests import `buildApp` directly (no listen/signals)
 *   - production runs `node out/web/server.cjs` via main()
 */

import { isAbsolute } from 'path'

import Fastify, { type FastifyInstance } from 'fastify'

import { getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'
import type { PostgresStorageSession } from '../main/storage/postgres/PostgresStorageSession'
import type { StorageSession } from '../main/storage/session'
import { AdminAlreadyExistsError, PostgresWebAuthService } from './auth/PostgresWebAuthService'
import { buildDispatcher, registerDispatcher } from './server/dispatcher'
import { registerSessions } from './server/auth'
import { registerEventStream, WebEventHub } from './server/events'
import { registerLoginRoute, resolveAppPathPrefix } from './server/login-route'
import { registerPageGate } from './server/page-gate'
import { registerStatic } from './server/static'
import pkg from '../../package.json'

/**
 * Admin bootstrap on first boot. Exactly one credential field must
 * be set: either a pre-computed Argon2id hash (preferred — no
 * plaintext on disk anywhere) or a plaintext password (deprecated,
 * kept for one migration release with a hard-deprecation log).
 *
 * Tests construct this directly; production reads from env via
 * `readAdminEnv()` below.
 */
export interface AdminBootstrapOptions {
  username: string
  /** Pre-computed Argon2id hash. Preferred path. */
  passwordHash?: string
  /** Plaintext password. Deprecated — emits a warn at boot. */
  password?: string
  displayName?: string
}

/**
 * Empty-object options is intentional: every parameter the web server
 * needs comes from the env (VARLENS_PG_URL, VARLENS_RECOVERY_KEY_DIR,
 * VARLENS_ADMIN_*). Phase 1 took an explicit `db` path; that's gone.
 * Tests can still pass `admin` to override the env-driven path.
 */
export interface BuildAppOptions {
  admin?: AdminBootstrapOptions
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Validate Postgres config BEFORE building the app; any later
  // failure path means we'd hold a partially-spun Fastify instance,
  // which the SIGTERM tests can't cleanly tear down.
  const pgConfig = getPostgresStorageConfig(process.env)
  if (pgConfig === null) {
    throw new Error(
      'VARLENS_PG_URL must be set. The web server is Postgres-only; ' +
        'see .planning/web/decision-postgres-as-web-backend.md and ' +
        '.planning/web/phase2-execution-plan.md for context.'
    )
  }

  const app = Fastify({
    logger: {
      level: process.env.VARLENS_LOG_LEVEL ?? 'info'
    }
  })

  const session: PostgresStorageSession = await createPostgresStorageSession(pgConfig)
  // Share the storage session's pool with the auth service so we open
  // exactly one connection pool per process. The public getPool()
  // accessor (added in the QA round on Step 4) makes this contract
  // type-checked rather than a structural cast.
  const pool = session.getPool()
  const authService = new PostgresWebAuthService({
    pool,
    schema: pgConfig.schema
  })

  if (options.admin !== undefined) {
    await maybeBootstrapAdmin(authService, options.admin, app.log)
  }

  await registerSessions(app, { authService })
  const events = new WebEventHub()

  // Login wall: the `/login` page itself + the preHandler that redirects
  // unauthenticated GETs to it. Registered before the dispatcher and
  // static handler so the explicit `/login` route wins over the SPA
  // fallback, and so the gate runs before any route handler ships
  // bytes. `/api/*`, `/healthz`, and `/login*` are passthrough.
  const appPathPrefix = resolveAppPathPrefix()
  registerLoginRoute(app)
  registerPageGate(app, { appPathPrefix })

  const dispatcherDeps = {
    session: session as StorageSession,
    authService,
    events
  }
  const { overrides } = buildDispatcher(dispatcherDeps)
  registerDispatcher(app, dispatcherDeps, overrides)
  registerEventStream(app, events)

  app.get('/healthz', async (_request, reply) => {
    const open = await isPostgresHealthy(pool)
    if (!open) {
      reply.code(503)
      return { status: 'unhealthy', version: pkg.version, db: { open: false } }
    }
    return { status: 'ok', version: pkg.version, db: { open: true } }
  })

  await registerStatic(app)

  app.addHook('onClose', async () => {
    try {
      await session.close()
    } catch {
      // ignore close errors during shutdown
    }
  })

  return app
}

interface BootstrapLogger {
  info: (obj: object, msg?: string) => void
  warn: (obj: object, msg?: string) => void
  fatal: (obj: object, msg?: string) => void
}

/**
 * Validates `VARLENS_RECOVERY_KEY_DIR`. Kept around because the
 * session-secret file (`web-session-secret`) lives in this directory
 * and `auth.ts` resolves the same env var. The recovery-key *file*
 * (`admin-recovery-key.txt`) was deleted in the 2026-security pass —
 * it was plaintext on disk that no consumer code read.
 */
function validateRecoveryKeyDir(): void {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  if (raw === undefined || raw.trim() === '') return
  if (!isAbsolute(raw.trim())) {
    throw new Error(
      `VARLENS_RECOVERY_KEY_DIR must be an absolute path; got: ${JSON.stringify(raw)}`
    )
  }
}

async function maybeBootstrapAdmin(
  authService: PostgresWebAuthService,
  admin: AdminBootstrapOptions,
  log: BootstrapLogger
): Promise<void> {
  validateRecoveryKeyDir()

  // Steady-state pre-check: if an admin already exists, the env vars
  // are stale (operator forgot to blank them after first boot) — log
  // loudly that we're ignoring them and return. The partial unique
  // index in migration 0007 still guarantees race-safety on truly
  // concurrent first-user calls; this is a fast-path.
  if (await authService.hasAdmin()) {
    log.warn(
      {
        event: 'admin-bootstrap',
        action: 'env-rotation-ignored',
        username: admin.username
      },
      'VARLENS_ADMIN_* set but an admin already exists — env-based rotation is NOT supported; ignoring.'
    )
    log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
    return
  }

  // Hash-preferred bootstrap. The hash path never sees plaintext at
  // any process boundary; the plaintext path is retained for one
  // migration release with a hard-deprecation warn.
  const useHash = typeof admin.passwordHash === 'string' && admin.passwordHash !== ''
  if (!useHash) {
    if (typeof admin.password !== 'string' || admin.password === '') {
      throw new Error(
        'admin bootstrap: neither VARLENS_ADMIN_PASSWORD_HASH nor VARLENS_ADMIN_PASSWORD provided. ' +
          'Generate a hash with `npm run varlens:hash-password` and set VARLENS_ADMIN_PASSWORD_HASH=...'
      )
    }
    log.warn(
      {
        event: 'admin-bootstrap',
        action: 'plaintext-deprecated',
        username: admin.username
      },
      'VARLENS_ADMIN_PASSWORD (plaintext) is DEPRECATED. ' +
        'Replace with VARLENS_ADMIN_PASSWORD_HASH (generate via `npm run varlens:hash-password`). ' +
        'The plaintext path will be removed in a future release.'
    )
  }

  try {
    if (useHash) {
      await authService.createFirstUserFromHash(
        admin.username,
        admin.displayName ?? admin.username,
        admin.passwordHash as string
      )
    } else {
      await authService.createFirstUser(
        admin.username,
        admin.displayName ?? admin.username,
        admin.password as string
      )
    }
  } catch (createErr) {
    // Race-loser branch: a concurrent first-user call beat us to the
    // partial unique index. The hasAdmin() pre-check above covers the
    // steady-state case; this branch covers exactly the race window.
    if (createErr instanceof AdminAlreadyExistsError) {
      log.warn(
        {
          event: 'admin-bootstrap',
          action: 'env-rotation-ignored-race',
          username: admin.username
        },
        'admin bootstrap raced an existing admin INSERT — env-based rotation is NOT supported; ignoring.'
      )
      log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
      return
    }
    throw createErr
  }

  // The bootstrapped admin is created with must_change_password=TRUE.
  // The dispatcher's pre-rotation gate enforces that this user can
  // only call auth:changePassword and auth:logout — so even though a
  // login succeeds with the bootstrap credentials, the resulting
  // session has zero application-surface access until the user picks
  // a new password. There is no exposure window where the bootstrap
  // password could read or write any data.
  log.info(
    {
      event: 'admin-bootstrap',
      action: 'created',
      username: admin.username,
      mustChangePassword: true,
      via: useHash ? 'hash' : 'plaintext'
    },
    `admin created — must rotate on first login (via ${useHash ? 'hash' : 'plaintext'})`
  )
}

/**
 * Liveness probe that bounds itself: kubernetes / load-balancer probes
 * expect /healthz to return quickly. A wedged Postgres or exhausted
 * pool would otherwise block on `pool.query` indefinitely (pg's
 * default has no statement timeout) and the orchestrator would not
 * see a 503 in time to evict the pod. Cap at 1.5s — well under the
 * typical 5s probe deadline.
 */
async function isPostgresHealthy(pool: import('pg').Pool): Promise<boolean> {
  const HEALTH_PROBE_TIMEOUT_MS = 1500
  let timer: NodeJS.Timeout | undefined
  const probe = pool.query('SELECT 1').then(
    () => true,
    () => false
  )
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), HEALTH_PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([probe, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Resolve admin-bootstrap credentials from env. Hash takes precedence:
 * if both VARLENS_ADMIN_PASSWORD_HASH and VARLENS_ADMIN_PASSWORD are
 * set, the hash wins and the plaintext is silently ignored — the
 * operator is migrating and we shouldn't second-guess them.
 *
 * Returns undefined when no usable credential is set, in which case
 * the boot path skips the bootstrap entirely (admin must already
 * exist or the user surface stays unreachable).
 */
function readAdminEnv(): AdminBootstrapOptions | undefined {
  const username = process.env.VARLENS_ADMIN_USERNAME
  const passwordHash = process.env.VARLENS_ADMIN_PASSWORD_HASH
  const password = process.env.VARLENS_ADMIN_PASSWORD
  const displayName = process.env.VARLENS_ADMIN_DISPLAY_NAME

  if (typeof username !== 'string' || username.trim() === '') {
    return undefined
  }

  const hashSet = typeof passwordHash === 'string' && passwordHash.trim() !== ''
  const passwordSet = typeof password === 'string' && password !== ''
  if (!hashSet && !passwordSet) {
    return undefined
  }

  return {
    username: username.trim(),
    passwordHash: hashSet ? (passwordHash as string).trim() : undefined,
    password: !hashSet && passwordSet ? password : undefined,
    displayName:
      typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : undefined
  }
}

async function main(): Promise<void> {
  const portRaw = process.env.VARLENS_WEB_PORT ?? '0'
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `VARLENS_WEB_PORT must be an integer in [0, 65535]; got: ${JSON.stringify(portRaw)}`
    )
  }

  const app = await buildApp({ admin: readAdminEnv() })

  await app.listen({ port, host: '0.0.0.0' })

  const address = app.server.address()
  const boundPort = address !== null && typeof address === 'object' ? address.port : port
  app.log.info({ port: boundPort }, 'listening')

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
}

declare const require: NodeJS.Require
declare const module: NodeJS.Module
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((err) => {
    const payload = {
      level: 50,
      time: Date.now(),
      msg: 'fatal: web server failed to start',
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
    }
    process.stderr.write(JSON.stringify(payload) + '\n')
    process.exit(1)
  })
}
