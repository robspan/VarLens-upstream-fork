import { join } from 'node:path'
import { Pool } from 'pg'

import type { DatabaseManager } from '../services/DatabaseManager'
import {
  buildPostgresPoolConfig,
  getPostgresStorageConfig,
  type PostgresStorageConfig
} from '../storage/config'
import { PostgresStorageSession } from '../storage/postgres/PostgresStorageSession'
import { PostgresMigrationRunner } from '../storage/postgres/migrations/PostgresMigrationRunner'
import type { StorageSession } from '../storage/session'

interface OpenConfiguredDatabaseOptions {
  env?: NodeJS.ProcessEnv
  userDataPath: string
  getPostgresConfig?: (env: NodeJS.ProcessEnv) => PostgresStorageConfig | null
  createPostgresPool?: (config: PostgresStorageConfig) => Pool
  createPostgresSession?: (config: PostgresStorageConfig, pool: Pool) => StorageSession
}

function getExperimentalBackend(env: NodeJS.ProcessEnv): string | null {
  const backend = env.VARLENS_EXPERIMENTAL_STORAGE_BACKEND?.trim()
  return backend === undefined || backend === '' ? null : backend
}

export async function openConfiguredDatabase(
  manager: DatabaseManager,
  options: OpenConfiguredDatabaseOptions
): Promise<void> {
  const env = options.env ?? process.env
  const requestedBackend = getExperimentalBackend(env)

  if (requestedBackend === 'postgres') {
    const config = (options.getPostgresConfig ?? getPostgresStorageConfig)(env)

    if (config === null) {
      throw new Error(
        'VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres requires PostgreSQL configuration, including VARLENS_PG_URL'
      )
    }

    const poolFactory =
      options.createPostgresPool ??
      ((pgConfig: PostgresStorageConfig) => new Pool(buildPostgresPoolConfig(pgConfig)))
    const sessionFactory =
      options.createPostgresSession ??
      ((pgConfig: PostgresStorageConfig, pool: Pool) =>
        new PostgresStorageSession({ config: pgConfig, pool }))

    const pool = poolFactory(config)
    let session: StorageSession | undefined

    try {
      const { POSTGRES_MIGRATIONS } = await import('../storage/postgres/migrations/definitions')
      const runner = new PostgresMigrationRunner(pool, config.schema, POSTGRES_MIGRATIONS)
      await runner.migrate()
      session = sessionFactory(config, pool)
      await manager.openPostgresSession(session)
      return
    } catch (error) {
      await closePostgresStartupResources({ error, pool, session })
      throw error
    }
  }

  await manager.open(join(options.userDataPath, 'varlens.db'))
}

async function closePostgresStartupResources({
  error,
  pool,
  session
}: {
  error: unknown
  pool: Pool
  session: StorageSession | undefined
}): Promise<void> {
  try {
    if (session !== undefined) {
      await session.close()
      return
    }

    await pool.end()
  } catch (cleanupError) {
    if (error instanceof Error) {
      const errorWithCleanup = error as Error & { cleanupError?: unknown }
      errorWithCleanup.cleanupError = cleanupError
      return
    }

    const combinedError = new Error('Database startup failed and cleanup failed') as Error & {
      errors: unknown[]
    }
    combinedError.errors = [error, cleanupError]
    throw combinedError
  }
}
