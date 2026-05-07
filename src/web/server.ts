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

import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'

import Fastify, { type FastifyInstance } from 'fastify'

import { getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'
import type { StorageSession } from '../main/storage/session'
import { PostgresWebAuthService } from './auth/PostgresWebAuthService'
import { registerCasesRoutes } from './routes/cases'
import { registerAuthRoutes } from './routes/auth'
import { registerVariantsRoutes } from './routes/variants'
import pkg from '../../package.json'

export interface AdminBootstrapOptions {
  username: string
  password: string
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

const DEFAULT_RECOVERY_KEY_DIR = '/data'

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

  const session: StorageSession = await createPostgresStorageSession(pgConfig)
  // The Postgres session shares its pool with the auth service so we
  // don't open two connection pools per process. Both consume the same
  // schema (per-tenant routing in Stage 3 will key off this).
  const pool = (session as unknown as { pool?: import('pg').Pool }).pool
  if (!pool) {
    throw new Error(
      'PostgresStorageSession did not expose its pool — auth service cannot share the connection pool.'
    )
  }
  const authService = new PostgresWebAuthService({
    pool,
    schema: pgConfig.schema
  })

  if (options.admin !== undefined) {
    await maybeBootstrapAdmin(authService, options.admin, app.log)
  }

  const getSession = (): StorageSession => session
  const getAuthService = (): PostgresWebAuthService => authService
  registerCasesRoutes(app, getSession)
  registerAuthRoutes(app, getAuthService)
  registerVariantsRoutes(app, getSession)

  app.get('/healthz', async (_request, reply) => {
    const open = await isPostgresHealthy(pool)
    if (!open) {
      reply.code(503)
      return { status: 'unhealthy', version: pkg.version, db: { open: false } }
    }
    return { status: 'ok', version: pkg.version, db: { open: true } }
  })

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

function getRecoveryKeyDir(): string {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  const dir = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_RECOVERY_KEY_DIR
  if (!isAbsolute(dir)) {
    throw new Error(
      `VARLENS_RECOVERY_KEY_DIR must be an absolute path; got: ${JSON.stringify(dir)}`
    )
  }
  return dir
}

async function maybeBootstrapAdmin(
  authService: PostgresWebAuthService,
  admin: AdminBootstrapOptions,
  log: BootstrapLogger
): Promise<void> {
  const recoveryKeyDir = getRecoveryKeyDir()
  const recoveryKeyPath = join(recoveryKeyDir, 'admin-recovery-key.txt')

  // Ensure the recovery-key directory exists and is writable. Mode 700
  // so the parent dir mirrors the file's 0o600 protection. The web
  // container's volume mount lands at /data with 1001:1001 ownership
  // already; on dev/test the mkdir is the only thing standing between
  // a fresh checkout and a working bootstrap.
  try {
    mkdirSync(recoveryKeyDir, { recursive: true, mode: 0o700 })
  } catch (err) {
    throw new Error(
      `Cannot ensure recovery-key dir ${recoveryKeyDir}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }

  // Diagnostic 1 (F7 carry-over from Phase 1): a recovery-key file
  // lingering on disk after createFirstUser would have been the
  // hint that a prior boot generated a key. Under Postgres we still
  // emit the warning if the file exists; capture-and-delete remains
  // the operator's signal.
  if (existsSync(recoveryKeyPath)) {
    log.warn(
      {
        event: 'admin-bootstrap',
        action: 'stale-recovery-key-present',
        path: recoveryKeyPath
      },
      `stale admin recovery-key file present at ${recoveryKeyPath} — capture its contents and delete it; the file will not be regenerated`
    )
  }

  // Atomically reserve the recovery-key path BEFORE attempting the
  // admin INSERT. `wx` flag is open(O_CREAT|O_EXCL) — fails if the
  // file already exists (uncaptured prior key) or the directory
  // isn't writable.
  let fd: number
  try {
    fd = openSync(recoveryKeyPath, 'wx', 0o600)
  } catch (err) {
    throw new Error(
      `Cannot reserve admin recovery-key file at ${recoveryKeyPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        'Resolve manually before retrying (capture and delete any stale file; ensure the directory exists and is writable).',
      { cause: err }
    )
  }
  closeSync(fd)

  let result: { recoveryKey: string }
  try {
    result = await authService.createFirstUser(
      admin.username,
      admin.displayName ?? admin.username,
      admin.password
    )
  } catch (createErr) {
    // If createFirstUser refused because an admin already exists, this
    // is the env-rotation footgun the SQLite path also warned about.
    // Surface the WARN, clean up the reservation file, and proceed.
    if (createErr instanceof Error && /admin user already exists/i.test(createErr.message)) {
      try {
        unlinkSync(recoveryKeyPath)
      } catch {
        /* best-effort */
      }
      log.warn(
        {
          event: 'admin-bootstrap',
          action: 'env-rotation-ignored',
          username: admin.username
        },
        'VARLENS_ADMIN_USERNAME/PASSWORD are set but an admin already exists — env-based rotation is NOT supported; the new credentials are being ignored.'
      )
      log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
      return
    }
    // Any other failure: clean up the empty reservation file so a retry
    // can proceed without facing a confusing "stale recovery key" error.
    try {
      unlinkSync(recoveryKeyPath)
    } catch {
      /* best-effort */
    }
    throw createErr
  }

  try {
    writeFileSync(
      recoveryKeyPath,
      `# VarLens admin recovery key — generated ${new Date().toISOString()}\n` +
        '# This is the ONLY copy. If you lose it the admin account cannot be recovered.\n' +
        '# After capturing this value, DELETE this file from the volume.\n' +
        `${result.recoveryKey}\n`,
      { mode: 0o600 }
    )
  } catch (writeErr) {
    log.fatal(
      {
        event: 'admin-bootstrap',
        action: 'recovery-key-write-failed',
        username: admin.username,
        recoveryKey: result.recoveryKey,
        writeError: writeErr instanceof Error ? writeErr.message : String(writeErr)
      },
      'CRITICAL: recovery-key file write failed AFTER admin row was committed.'
    )
    throw new Error(
      `Admin bootstrap completed but recovery-key write failed. ` +
        `RECOVERY KEY (capture immediately and rotate): ${result.recoveryKey}`,
      { cause: writeErr }
    )
  }

  log.warn(
    {
      event: 'admin-bootstrap',
      action: 'created',
      username: admin.username,
      recoveryKeyPath
    },
    `admin created — recovery key written to ${recoveryKeyPath}; capture it now and delete the file`
  )
}

async function isPostgresHealthy(pool: import('pg').Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

function readAdminEnv(): AdminBootstrapOptions | undefined {
  const username = process.env.VARLENS_ADMIN_USERNAME
  const password = process.env.VARLENS_ADMIN_PASSWORD
  const displayName = process.env.VARLENS_ADMIN_DISPLAY_NAME

  if (
    typeof username !== 'string' ||
    username.trim() === '' ||
    typeof password !== 'string' ||
    password === ''
  ) {
    return undefined
  }

  return {
    username: username.trim(),
    password,
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

// Quiet "unused" lint warnings on imports kept for future-proofing.
void dirname

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
