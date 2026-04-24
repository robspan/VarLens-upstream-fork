import { DatabaseService } from '../../database/DatabaseService'
import { DbPool } from '../../database/DbPool'
import { WrongPasswordError } from '../../database/errors'
import { resolveGeneRefDbPath } from '../../database/geneReferenceLoader'
import { getWorkerThreads } from '../../ipc/dbPoolManager'
import { SqliteStorageSession } from './SqliteStorageSession'

export function createSqliteStorageSession(dbPath: string, key?: string): SqliteStorageSession {
  const databaseService = new DatabaseService(dbPath, key)

  if (key !== undefined && key.length > 0) {
    try {
      databaseService.database.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      databaseService.close()

      if (
        error instanceof Error &&
        error.message.includes('file is encrypted or is not a database')
      ) {
        throw new WrongPasswordError()
      }

      throw error
    }
  }

  let geneRefDbPath: string | undefined
  try {
    geneRefDbPath = resolveGeneRefDbPath()
  } catch {
    geneRefDbPath = undefined
  }

  const configuredWorkerThreads = getWorkerThreads()
  const maxThreads = configuredWorkerThreads > 0 ? configuredWorkerThreads : undefined
  const dbPool = new DbPool()

  dbPool.init(dbPath, key, {
    ...(maxThreads !== undefined ? { maxThreads } : {}),
    ...(geneRefDbPath !== undefined ? { geneRefDbPath } : {})
  })

  return new SqliteStorageSession({
    databaseService,
    dbPool
  })
}
