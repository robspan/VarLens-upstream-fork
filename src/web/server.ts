/**
 * VarLens web server entrypoint.
 *
 * Stage 1 — minimum scope per §app2.1:
 *   - Fastify app with Pino JSON logging
 *   - `/healthz` (200/503)
 *   - SIGTERM/SIGINT graceful shutdown
 *   - Domain routes (cases, auth, variants) via the handler-seam
 *   - Fail-loud boot: invalid configuration aborts the process; no
 *     silent half-servers serving 404 for every domain endpoint
 *   - Optional admin bootstrap from env using upstream's existing
 *     AuthService.createFirstUser (no modifications to that file)
 *
 * Built to `out/web/server.cjs` via `vite.web.config.ts`. Two consumers:
 *   - tests import `buildApp` directly (no `listen()`, no signal handlers)
 *   - production runs `node out/web/server.cjs`, which calls `main()`
 *
 * Postgres backend wiring is intentionally Stage 1.5 work and lives outside
 * this file — see `.planning/web/qa-report-phase1.md` follow-ups.
 */

import { closeSync, existsSync, openSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'

import Fastify, { type FastifyInstance } from 'fastify'

import { DatabaseService } from '../main/database/DatabaseService'
import { SqliteStorageSession } from '../main/storage/sqlite/SqliteStorageSession'
import type { StorageSession } from '../main/storage/session'
import { registerCasesRoutes } from './routes/cases'
import { registerAuthRoutes } from './routes/auth'
import { registerVariantsRoutes } from './routes/variants'
import pkg from '../../package.json'

export interface AdminBootstrapOptions {
  username: string
  password: string
  displayName?: string
}

export interface BuildAppOptions {
  db: string
  admin?: AdminBootstrapOptions
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.VARLENS_LOG_LEVEL ?? 'info'
    }
  })

  // Fail-loud: any boot-time failure here propagates. Caller (main() or
  // a test) decides what to do with the rejection.
  // DatabaseService constructor runs migrations synchronously, so the
  // `users` table is guaranteed to exist before maybeBootstrapAdmin runs
  // its pre-check below.
  const db = new DatabaseService(options.db)
  const session: StorageSession = new SqliteStorageSession({
    databaseService: db,
    dbPool: null
  })

  if (options.admin !== undefined) {
    await maybeBootstrapAdmin(db, options.db, options.admin, app.log)
  }

  const getSession = (): StorageSession => session
  const getDb = (): DatabaseService => db
  registerCasesRoutes(app, getSession)
  registerAuthRoutes(app, getDb)
  registerVariantsRoutes(app, getSession)

  app.get('/healthz', async (_request, reply) => {
    const open = isDatabaseOpen(db)
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

async function maybeBootstrapAdmin(
  db: DatabaseService,
  dbPath: string,
  admin: AdminBootstrapOptions,
  log: BootstrapLogger
): Promise<void> {
  // Pre-check avoids paying Argon2's ~600ms hashing cost on every reboot
  // when the admin already exists. Migrations have already run inside
  // `new DatabaseService(...)` above, so the `users` table is guaranteed
  // to exist here.
  const existing = db.database
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { id: number } | undefined

  if (existing !== undefined) {
    // Diagnostic 1 (F7): a recovery-key file lingering on disk after the
    // admin row exists means a prior boot generated the key but the
    // operator never captured-and-deleted it. The file is the only copy
    // of an extremely sensitive secret; we surface it loudly but do NOT
    // auto-delete (deletion is the operator's explicit confirmation that
    // they have captured the value).
    if (dbPath !== ':memory:' && isAbsolute(dbPath)) {
      const recoveryKeyPath = join(dirname(dbPath), 'admin-recovery-key.txt')
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
    }

    // Diagnostic 2 (F7): VARLENS_ADMIN_USERNAME/PASSWORD set in env after
    // an admin already exists almost always means the operator is trying
    // to rotate credentials by changing env vars and rebooting. That has
    // never been supported (bootstrap is strictly first-user creation),
    // and silently ignoring the env vars hides the failure mode. Log a
    // WARN so the misuse is visible; rotation will eventually flow through
    // a dedicated `varlens admin rotate` path.
    log.warn(
      {
        event: 'admin-bootstrap',
        action: 'env-rotation-ignored',
        username: admin.username
      },
      'VARLENS_ADMIN_USERNAME/PASSWORD are set but an admin already exists — env-based rotation is NOT supported; the new credentials are being ignored. Use the dedicated admin rotation flow (planned: `varlens admin rotate`).'
    )

    log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
    return
  }

  if (dbPath === ':memory:') {
    throw new Error(
      'Admin bootstrap requires a persistent VARLENS_DB_PATH; refusing against :memory:.'
    )
  }
  // Recovery-key file derives its location from dirname(dbPath); a relative
  // path would land it in CWD (ephemeral container layer). Enforce here so
  // any caller of buildApp() — not only main() — gets the same guarantee.
  if (!isAbsolute(dbPath)) {
    throw new Error(
      `Admin bootstrap requires an absolute VARLENS_DB_PATH; got: ${JSON.stringify(dbPath)}.`
    )
  }

  // The recovery key is the only path to recover access if the admin
  // password is lost. Writing it to a file under the volume avoids
  // permanent persistence in any log aggregator (Loki, journald, etc.) —
  // operators capture and delete the file, the secret never enters
  // structured logs in the steady-state path.
  const recoveryKeyPath = join(dirname(dbPath), 'admin-recovery-key.txt')

  // Atomically reserve the path BEFORE creating the admin row. `wx` flag
  // is open(O_CREAT|O_EXCL) — fails if the file exists (uncaptured prior
  // key), fails if the parent dir doesn't exist or isn't writable. This
  // is the only correct ordering: an FS failure here aborts cleanly with
  // no orphan admin in the DB.
  let fd: number
  try {
    fd = openSync(recoveryKeyPath, 'wx', 0o600)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot reserve admin recovery-key file at ${recoveryKeyPath}: ${reason}. ` +
        'Resolve manually before retrying (capture and delete any stale file; ensure the directory exists and is writable).',
      { cause: err }
    )
  }
  closeSync(fd)

  // If createFirstUser fails after we reserved the path, the empty
  // reservation file would wedge every subsequent boot at the wx-open
  // (operator faces a zero-byte file the error message describes as a
  // "stale recovery key" — misleading). Unlink on failure so a retry can
  // proceed cleanly; no user row was committed and no key was generated.
  let result: { recoveryKey: string }
  try {
    result = await db.auth.createFirstUser(
      admin.username,
      admin.displayName ?? admin.username,
      admin.password
    )
  } catch (createErr) {
    try {
      unlinkSync(recoveryKeyPath)
    } catch {
      // Best-effort cleanup; the original error is what matters.
    }
    throw createErr
  }

  // Path was reserved above; this overwrite operates on a file we already
  // own. Failure here is effectively impossible without a concurrent
  // adversarial mutation. If it does happen, the admin row is already
  // committed — last-resort: emit the key at fatal level (single deliberate
  // break of the "no secrets in logs" rule) AND inline it in the thrown
  // error message so the stderr fatal-write path also surfaces it,
  // regardless of the configured log level.
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
    const reason = writeErr instanceof Error ? writeErr.message : String(writeErr)
    log.fatal(
      {
        event: 'admin-bootstrap',
        action: 'recovery-key-write-failed',
        username: admin.username,
        recoveryKey: result.recoveryKey,
        writeError: reason
      },
      'CRITICAL: recovery-key file write failed AFTER admin row was committed — ' +
        'recoveryKey field above is the only copy. Capture immediately and rotate.'
    )
    throw new Error(
      `Admin bootstrap completed but recovery-key write failed: ${reason}. ` +
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

function isDatabaseOpen(db: DatabaseService): boolean {
  try {
    db.database.prepare('SELECT 1').get()
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

  // Production binary requires an explicit DB path. `:memory:` is reachable
  // only via direct buildApp() calls from tests — silently demoting to a
  // volatile DB on a misconfigured deployment would destroy data on every
  // restart with no warning, which is exactly what fail-loud forbids.
  const dbPath = process.env.VARLENS_DB_PATH
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new Error(
      'VARLENS_DB_PATH must be set (e.g. /data/varlens.db). Refusing to start an in-memory database in production.'
    )
  }
  // Must be absolute, with `:memory:` allowed as the explicit volatile-DB
  // sentinel (used by the SIGTERM test). A relative path like `varlens.db`
  // resolves against CWD (the container's WORKDIR /app), which is the
  // ephemeral container layer — the recovery-key file would land there too
  // and vanish on `docker rm`, defeating the on-volume secret design.
  if (dbPath !== ':memory:' && !isAbsolute(dbPath)) {
    throw new Error(
      `VARLENS_DB_PATH must be an absolute path or ':memory:'; got: ${JSON.stringify(dbPath)}.`
    )
  }

  const app = await buildApp({ db: dbPath, admin: readAdminEnv() })

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

// CJS entrypoint guard: `node out/web/server.cjs` triggers main(); test
// imports do not.
declare const require: NodeJS.Require
declare const module: NodeJS.Module
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((err) => {
    // Logger may not be initialised yet — emit a structured error line on
    // stderr so the failure is visible in container logs and exit non-zero.
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
