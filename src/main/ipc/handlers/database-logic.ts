/**
 * Pure business logic for database IPC handlers.
 *
 * All functions take explicit dependencies as parameters and never touch
 * IPC/Electron APIs directly. Dialog operations and shell.showItemInFolder
 * remain in the handler layer.
 */
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { extname, resolve } from 'path'
import { Pool } from 'pg'
import { z } from 'zod'
import { mainLogger } from '../../services/MainLogger'
import { WrongPasswordError } from '../../database/errors'
import { convertBigInts } from '../../utils/convertBigInts'
import {
  buildPostgresPoolConfig,
  buildPostgresStorageConfigFromProfile,
  redactPostgresConnectionUrl,
  type PostgresStorageConfig
} from '../../storage/config'
import { PostgresHealthDiagnostics } from '../../storage/postgres/PostgresHealthDiagnostics'
import { PostgresStorageSession } from '../../storage/postgres/PostgresStorageSession'
import { createPostgresStorageSession } from '../../storage/postgres/createPostgresStorageSession'
import { PostgresMigrationRunner } from '../../storage/postgres/migrations/PostgresMigrationRunner'
import { POSTGRES_MIGRATIONS } from '../../storage/postgres/migrations/definitions'
import {
  PostgresConnectionProfileInputSchema
} from '../../storage/postgres/postgres-profile-validation'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DatabaseManager } from '../../services/DatabaseManager'
import type { DbPool } from '../../database/DbPool'
import type { StorageSession } from '../../storage/session'
import type { DatabaseOpenResult } from '../../../shared/ipc/domains/database'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput,
  PostgresConnectionProfileSecretInput,
  PostgresConnectionTestResult,
  PostgresHealthDiagnosticResult
} from '../../../shared/types/postgres-profile'
import type { PostgresProfileStore } from '../../storage/postgres/PostgresProfileStore'

export { createPostgresStorageSession }

/** File extensions allowed for database deletion -- prevents accidental non-DB file removal */
const ALLOWED_DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3'])

export const PostgresProfileIdSchema = z.string().trim().min(1)
export type PostgresProfileStoreLike = Pick<
  PostgresProfileStore,
  'listProfiles' | 'saveProfile' | 'removeProfile' | 'getProfileSecrets'
>

export type PostgresPoolLike = Pick<Pool, 'end' | 'query'>

export interface PostgresProfileTestDependencies {
  createPool: (config: PostgresStorageConfig) => PostgresPoolLike
  collectDiagnostics?: (
    pool: PostgresPoolLike,
    schema: string
  ) => Promise<PostgresHealthDiagnosticResult>
}

export interface PostgresProfileOpenDependencies {
  profileStore: Pick<PostgresProfileStoreLike, 'listProfiles' | 'getProfileSecrets'>
  getDbManager: () => Pick<DatabaseManager, 'openPostgresSession' | 'getCurrentInfo'>
  createSession?: (config: PostgresStorageConfig) => Promise<StorageSession> | StorageSession
}

/** Callbacks for pool init and cohort rebuild during database open/create. */
export interface DatabaseLifecycleCallbacks {
  triggerStartupRebuild: (db: DatabaseService) => void
}

export function createDefaultPostgresPool(config: PostgresStorageConfig): PostgresPoolLike {
  return new Pool(buildPostgresPoolConfig(config))
}

export function createDefaultPostgresSession(
  config: PostgresStorageConfig,
  pool: PostgresPoolLike
): StorageSession {
  return new PostgresStorageSession({ config, pool: pool as Pool })
}

export async function migratePostgresStorage(
  pool: PostgresPoolLike,
  schema: string
): Promise<void> {
  const runner = new PostgresMigrationRunner(pool as Pool, schema, POSTGRES_MIGRATIONS)
  await runner.migrate()
}

async function collectPostgresDiagnostics(
  pool: PostgresPoolLike,
  schema: string
): Promise<PostgresHealthDiagnosticResult> {
  return await new PostgresHealthDiagnostics(pool, schema).collect()
}

function publicProfileFromInput(
  input: PostgresConnectionProfileInput
): PostgresConnectionProfilePublic {
  return {
    id: 'test-profile',
    name: input.name,
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    schema: input.schema,
    sslMode: input.sslMode,
    poolMax: input.poolMax,
    connectionTimeoutMillis: input.connectionTimeoutMillis,
    statementTimeoutMs: input.statementTimeoutMs,
    lockTimeoutMs: input.lockTimeoutMs,
    idleInTransactionSessionTimeoutMs: input.idleInTransactionSessionTimeoutMs,
    caCertificateConfigured: input.secrets.caCertificatePem !== undefined
  }
}

function replaceIfPresent(message: string, value: string | undefined, replacement: string): string {
  if (value === undefined || value === '') {
    return message
  }

  return message.split(value).join(replacement)
}

function sanitizePostgresMessage(
  message: string,
  secrets?: PostgresConnectionProfileSecretInput,
  config?: PostgresStorageConfig
): string {
  let sanitized = message

  if (config !== undefined) {
    try {
      sanitized = replaceIfPresent(sanitized, config.url, redactPostgresConnectionUrl(config.url))
    } catch {
      sanitized = replaceIfPresent(sanitized, config.url, '[redacted-postgres-url]')
    }
  }

  sanitized = replaceIfPresent(sanitized, secrets?.password, '[redacted-password]')
  sanitized = replaceIfPresent(
    sanitized,
    secrets?.password === undefined ? undefined : encodeURIComponent(secrets.password),
    '[redacted-password]'
  )
  sanitized = replaceIfPresent(sanitized, secrets?.caCertificatePem, '[redacted-certificate]')

  return sanitized
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ============================================================
// Database Lifecycle
// ============================================================

/**
 * Open a database: detect encryption, validate password, switch connection.
 */
export async function openDatabase(
  params: { path: string; password?: string },
  getDb: () => DatabaseService,
  getDbManager: () => DatabaseManager,
  callbacks: DatabaseLifecycleCallbacks
): Promise<{
  success: boolean
  needsPassword?: boolean
  error?: string
  info?: { path: string; name: string; encrypted: boolean }
}> {
  const manager = getDbManager()
  const { path: vPath, password: vPassword } = params

  // First detect if database is encrypted
  const { needsPassword } = manager.openDetectEncryption(vPath)

  // If encrypted and no password provided, return early
  if (needsPassword && (vPassword === undefined || vPassword === '')) {
    return {
      success: false,
      needsPassword: true
    }
  }

  // Switch to new database with rollback on failure
  try {
    await manager.switchDatabase(vPath, vPassword)
    mainLogger.info(`Switched to database: ${vPath}`, 'database')

    // Trigger async cohort summary rebuild if needed (non-blocking)
    try {
      callbacks.triggerStartupRebuild(getDb())
    } catch (e) {
      mainLogger.warn(
        'triggerStartupRebuildIfNeeded failed (best effort -- database open continues): ' +
          (e instanceof Error ? e.message : String(e)),
        'database'
      )
    }

    const info = manager.getCurrentInfo()
    return { success: true, info: info! }
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      return { success: false, error: 'WRONG_PASSWORD' }
    }
    throw error
  }
}

/**
 * Create a new database at the specified path.
 */
export async function createDatabase(
  params: { path: string; password?: string },
  getDbManager: () => DatabaseManager
): Promise<{ success: boolean; info: { path: string; name: string; encrypted: boolean } }> {
  const manager = getDbManager()
  await manager.createDatabase(params.path, params.password)

  const info = manager.getCurrentInfo()
  return { success: true, info: info! }
}

/**
 * Change the encryption key for the current database.
 */
export function rekeyDatabase(
  newPassword: string,
  getDbManager: () => DatabaseManager
): { success: boolean } {
  const manager = getDbManager()
  manager.rekey(newPassword)
  return { success: true }
}

// ============================================================
// Database Info
// ============================================================

export function getDatabaseInfo(
  getDbManager: () => DatabaseManager
): { path: string; name: string; encrypted: boolean } | null {
  const manager = getDbManager()
  return manager.getCurrentInfo()
}

export function getDatabaseCapabilities(getDbManager: () => DatabaseManager): StorageCapabilities {
  return getDbManager().getCurrentSession().capabilities
}

export async function getPostgresDiagnostics(
  getDbManager: () => DatabaseManager
): Promise<PostgresHealthDiagnosticResult> {
  const session = getDbManager().getCurrentSession()
  if (session.capabilities.backend !== 'postgres' || session.workspace.kind !== 'postgres') {
    return {
      ok: false,
      schema: '',
      message: 'PostgreSQL diagnostics are only available for PostgreSQL sessions'
    }
  }

  const collectDiagnostics = (
    session as {
      collectDiagnostics?: () => Promise<PostgresHealthDiagnosticResult>
    }
  ).collectDiagnostics
  if (collectDiagnostics !== undefined) {
    return await collectDiagnostics.call(session)
  }

  return {
    ok: false,
    schema: session.workspace.schema,
    message: 'Current PostgreSQL session does not expose diagnostics'
  }
}

// ============================================================
// PostgreSQL Profile Management
// ============================================================

export async function listPostgresProfiles(
  profileStore: Pick<PostgresProfileStoreLike, 'listProfiles'>
): Promise<PostgresConnectionProfilePublic[]> {
  return await profileStore.listProfiles()
}

export async function savePostgresProfile(
  input: PostgresConnectionProfileSaveInput,
  profileStore: Pick<PostgresProfileStoreLike, 'saveProfile'>
): Promise<PostgresConnectionProfilePublic> {
  return await profileStore.saveProfile(input)
}

export async function removePostgresProfile(
  profileId: string,
  profileStore: Pick<PostgresProfileStoreLike, 'removeProfile'>
): Promise<{ success: boolean }> {
  await profileStore.removeProfile(profileId)
  return { success: true }
}

export async function testPostgresProfile(
  input: PostgresConnectionProfileInput,
  dependencies: PostgresProfileTestDependencies
): Promise<PostgresConnectionTestResult> {
  const validated = PostgresConnectionProfileInputSchema.parse(input)
  const profile = publicProfileFromInput(validated)
  const secrets = validated.secrets
  const config = buildPostgresStorageConfigFromProfile(profile, secrets)
  let pool: PostgresPoolLike | undefined

  try {
    pool = dependencies.createPool(config)
    const diagnostics = await (dependencies.collectDiagnostics ?? collectPostgresDiagnostics)(
      pool,
      config.schema
    )

    const result: PostgresConnectionTestResult = {
      ok: diagnostics.ok,
      ...(diagnostics.serverVersion !== undefined
        ? { serverVersion: diagnostics.serverVersion }
        : {}),
      ...(diagnostics.currentUser !== undefined ? { currentUser: diagnostics.currentUser } : {}),
      database: validated.database,
      schema: diagnostics.schema,
      ...(diagnostics.currentMigration !== undefined
        ? { currentMigration: diagnostics.currentMigration }
        : {}),
      ...(diagnostics.message !== undefined
        ? { message: sanitizePostgresMessage(diagnostics.message, secrets, config) }
        : {})
    }

    try {
      await pool.end()
    } catch (cleanupError) {
      return {
        ok: false,
        database: validated.database,
        schema: config.schema,
        message: sanitizePostgresMessage(errorMessage(cleanupError), secrets, config)
      }
    }

    return result
  } catch (error) {
    if (pool !== undefined) {
      try {
        await pool.end()
      } catch (cleanupError) {
        return {
          ok: false,
          database: validated.database,
          schema: config.schema,
          message: `${sanitizePostgresMessage(errorMessage(error), secrets, config)}; cleanup failed: ${sanitizePostgresMessage(
            errorMessage(cleanupError),
            secrets,
            config
          )}`
        }
      }
    }

    return {
      ok: false,
      database: validated.database,
      schema: config.schema,
      message: sanitizePostgresMessage(errorMessage(error), secrets, config)
    }
  }
}

export async function openPostgresProfile(
  profileId: string,
  dependencies: PostgresProfileOpenDependencies
): Promise<DatabaseOpenResult> {
  const id = PostgresProfileIdSchema.parse(profileId)
  const profiles = await dependencies.profileStore.listProfiles()
  const profile = profiles.find((candidate) => candidate.id === id)
  if (profile === undefined) {
    throw new Error(`Missing PostgreSQL profile ${id}`)
  }
  const profileName = profile.name

  const secrets = await dependencies.profileStore.getProfileSecrets(id)
  let config: PostgresStorageConfig | undefined
  let session: StorageSession | undefined
  let opened = false

  try {
    config = buildPostgresStorageConfigFromProfile(profile, secrets)
    session = await (dependencies.createSession ?? createPostgresStorageSession)(config)
    const manager = dependencies.getDbManager()
    await manager.openPostgresSession(session)
    opened = true

    const info = manager.getCurrentInfo()
    if (info === null) {
      throw new Error('PostgreSQL profile opened but current database info is unavailable')
    }

    return { success: true, info }
  } catch (error) {
    if (opened) {
      throw new Error(
        `Failed to finish opening PostgreSQL profile "${profileName}": ${sanitizePostgresMessage(
          errorMessage(error),
          secrets,
          config
        )}`
      )
    }

    try {
      if (session !== undefined) {
        await session.close()
      }
    } catch (cleanupError) {
      throw new Error(
        `Failed to open PostgreSQL profile "${profileName}": ${sanitizePostgresMessage(
          errorMessage(error),
          secrets,
          config
        )}; cleanup failed: ${sanitizePostgresMessage(
          errorMessage(cleanupError),
          secrets,
          config
        )}`
      )
    }

    throw new Error(
      `Failed to open PostgreSQL profile "${profileName}": ${sanitizePostgresMessage(
        errorMessage(error),
        secrets,
        config
      )}`
    )
  }

  throw new Error(`Failed to open PostgreSQL profile "${profileName}"`)
}

export function getRecentDatabases(getDbManager: () => DatabaseManager): unknown {
  const manager = getDbManager()
  return manager.getRecentDatabases()
}

export async function getDatabaseOverview(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'database:overview', params: [] })
  }
  const db = getDb()
  const overview = db.overview.getDatabaseOverview()
  return convertBigInts(overview)
}

// ============================================================
// Recent Database Management
// ============================================================

export function removeRecentDatabase(
  path: string,
  getDbManager: () => DatabaseManager
): { success: boolean } {
  const manager = getDbManager()
  manager.removeRecentDatabase(path)
  mainLogger.info(`Removed from recent databases: ${path}`, 'database')
  return { success: true }
}

/**
 * Delete a database file from disk and remove from recent list.
 * Refuses to delete the currently active database.
 */
export async function deleteDbFile(
  path: string,
  getDbManager: () => DatabaseManager
): Promise<{ success: boolean }> {
  // Canonicalize to resolve any ../ segments (defense-in-depth)
  const canonicalPath = resolve(path)

  // Only allow deletion of known database file extensions
  const ext = extname(canonicalPath).toLowerCase()
  if (!ALLOWED_DB_EXTENSIONS.has(ext)) {
    throw new Error(
      `Refusing to delete file with extension "${ext}". Only database files (.db, .sqlite, .sqlite3) can be deleted.`
    )
  }

  const manager = getDbManager()

  // Verify the path exists in the recent databases list before allowing deletion
  const recentPaths = manager.getRecentDatabases().map((db) => db.path)
  if (!recentPaths.includes(canonicalPath)) {
    throw new Error('Can only delete databases that appear in the recent databases list.')
  }

  const currentPath = manager.getCurrentPath()

  // Refuse to delete the currently active database
  if (currentPath === canonicalPath) {
    throw new Error(
      'Cannot delete the currently active database. Switch to a different database first.'
    )
  }

  if (!existsSync(canonicalPath)) {
    // File already gone -- just remove from recent list
    manager.removeRecentDatabase(canonicalPath)
    return { success: true }
  }

  // Delete the main database file -- failure here is fatal (return error)
  try {
    await unlink(canonicalPath)
  } catch (e) {
    mainLogger.error(
      `Failed to delete database file ${canonicalPath}: ${e instanceof Error ? e.message : String(e)}`,
      'database'
    )
    throw e
  }

  // Best-effort cleanup of WAL/SHM companion files
  for (const suffix of ['-wal', '-shm']) {
    const filePath = canonicalPath + suffix
    if (existsSync(filePath)) {
      try {
        await unlink(filePath)
      } catch (e) {
        mainLogger.warn(
          `Failed to delete ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
          'database'
        )
      }
    }
  }

  manager.removeRecentDatabase(canonicalPath)
  mainLogger.info(`Deleted database file: ${canonicalPath}`, 'database')
  return { success: true }
}
