/**
 * VarLens web server entrypoint.
 *
 * Phase 1 scaffold:
 *   - Fastify app with Pino JSON logging
 *   - `/healthz` (200/503)
 *   - Graceful SIGTERM/SIGINT shutdown when run as a script
 *
 * Built to `out/web/server.cjs` via `vite.web.config.ts`. The same module
 * is consumed in two ways:
 *   - tests import `buildApp` directly (no `listen()`, no signal handlers)
 *   - production runs `node out/web/server.cjs`, which calls `main()`
 *
 * Domain routes (cases, variants, imports, …) attach in follow-up commits
 * by importing the same handler functions used by the Electron IPC layer
 * (`src/main/ipc/domains/`). The `handler-seam` web-gate test enforces
 * "exact same function" — no parallel implementation.
 *
 * The `db` option accepts a SQLite path (or `:memory:`) for tests; the
 * production deployment will switch this to the Postgres config from env
 * once the StorageSession refactor lands.
 */

import Fastify, { type FastifyInstance } from 'fastify'

import { DatabaseService } from '../main/database/DatabaseService'
import { SqliteStorageSession } from '../main/storage/sqlite/SqliteStorageSession'
import type { StorageSession } from '../main/storage/session'
import { registerCasesRoutes } from './routes/cases'
import { registerAuthRoutes } from './routes/auth'
import { registerVariantsRoutes } from './routes/variants'
import pkg from '../../package.json'

export interface BuildAppOptions {
  db: string
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.VARLENS_LOG_LEVEL ?? 'info'
    }
  })

  let db: DatabaseService | null = null
  let session: StorageSession | null = null
  try {
    db = new DatabaseService(options.db)
    session = new SqliteStorageSession({ databaseService: db, dbPool: null })
  } catch {
    db = null
    session = null
  }

  if (session !== null && db !== null) {
    const getSession = (): StorageSession => session as StorageSession
    const getDb = (): DatabaseService => db as DatabaseService
    registerCasesRoutes(app, getSession)
    registerAuthRoutes(app, getDb)
    registerVariantsRoutes(app, getSession)
  }

  app.get('/healthz', async (_request, reply) => {
    const open = isDatabaseOpen(db)
    if (!open) {
      reply.code(503)
      return { status: 'unhealthy', version: pkg.version, db: { open: false } }
    }
    return { status: 'ok', version: pkg.version, db: { open: true } }
  })

  app.addHook('onClose', async () => {
    if (session) {
      try {
        await session.close()
      } catch {
        // ignore close errors during shutdown
      }
    }
  })

  return app
}

function isDatabaseOpen(db: DatabaseService | null): boolean {
  if (db === null) return false
  try {
    db.database.prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const port = Number(process.env.VARLENS_WEB_PORT ?? '0')
  const dbPath = process.env.VARLENS_DB_PATH ?? ':memory:'

  const app = await buildApp({ db: dbPath })

  await app.listen({ port, host: '127.0.0.1' })

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
    // Fall back to plain stderr; the logger may not be initialised yet.
    process.stderr.write(JSON.stringify({ level: 50, msg: String(err) }) + '\n')
    process.exit(1)
  })
}
