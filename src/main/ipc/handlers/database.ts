/**
 * Database IPC handlers - Lifecycle operations for database management
 *
 * Exposes database open/close/switch/create/rekey operations to renderer.
 * Handles encryption detection and password validation.
 * Dialog operations and shell access stay in this handler layer.
 */

import { dialog, shell } from 'electron'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import {
  DatabaseOpenSchema,
  DatabaseCreateSchema,
  DatabaseRekeySchema,
  FilePathSchema
} from '../../../shared/types/ipc-schemas'
import { triggerStartupRebuildIfNeeded } from './cohort'
import {
  openDatabase,
  createDatabase,
  rekeyDatabase,
  getDatabaseInfo,
  getDatabaseCapabilities,
  getPostgresDiagnostics,
  getRecentDatabases,
  getDatabaseOverview,
  removeRecentDatabase,
  deleteDbFile
} from './database-logic'
import type { DatabaseLifecycleCallbacks } from './database-logic'

/** Shared lifecycle callbacks wiring pool init and cohort rebuild. */
const lifecycleCallbacks: DatabaseLifecycleCallbacks = {
  triggerStartupRebuild: (db) => triggerStartupRebuildIfNeeded(db)
}

export function registerDatabaseHandlers({
  ipcMain,
  getDb,
  getDbManager,
  getDbPool
}: HandlerDependencies): void {
  /**
   * Show file picker for selecting database file
   */
  ipcMain.handle('database:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Database',
      properties: ['openFile'],
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /**
   * Show file picker for selecting save location for new database
   */
  ipcMain.handle('database:selectSaveLocation', async (_event, defaultName: unknown) => {
    // ANTI-07: Runtime validation at IPC boundary
    const validated = FilePathSchema.safeParse(defaultName)
    if (!validated.success) {
      mainLogger.error(
        `Invalid database:selectSaveLocation defaultName: ${validated.error.message}`,
        'database'
      )
      throw new Error('Invalid file name')
    }
    const result = await dialog.showSaveDialog({
      title: 'Create New Database',
      defaultPath: validated.data,
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
  })

  /**
   * Open a database at the specified path
   */
  ipcMain.handle('database:open', async (_event, path: unknown, password?: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseOpenSchema.safeParse({ path, password })
      if (!validated.success) {
        mainLogger.error(`Invalid database:open params: ${validated.error.message}`, 'database')
        throw new Error('Invalid database open parameters')
      }
      return openDatabase(validated.data, getDb, getDbManager, lifecycleCallbacks)
    })
  })

  /**
   * Create a new database at the specified path
   */
  ipcMain.handle('database:create', async (_event, path: unknown, password?: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseCreateSchema.safeParse({ path, password })
      if (!validated.success) {
        mainLogger.error(`Invalid database:create params: ${validated.error.message}`, 'database')
        throw new Error('Invalid database create parameters')
      }
      return createDatabase(validated.data, getDbManager)
    })
  })

  /**
   * Change the encryption key for the current database
   */
  ipcMain.handle('database:rekey', async (_event, newPassword: unknown) => {
    return wrapHandler(async () => {
      const validated = DatabaseRekeySchema.safeParse({ newPassword })
      if (!validated.success) {
        mainLogger.error(`Invalid database:rekey params: ${validated.error.message}`, 'database')
        throw new Error('Invalid encryption key')
      }
      return rekeyDatabase(validated.data.newPassword, getDbManager)
    })
  })

  /**
   * Get information about the current database
   */
  ipcMain.handle('database:info', async () => {
    return wrapHandler(async () => {
      return getDatabaseInfo(getDbManager)
    })
  })

  /**
   * Get capability flags for the current storage backend/session
   */
  ipcMain.handle('database:capabilities', async () => {
    return wrapHandler(async () => {
      return getDatabaseCapabilities(getDbManager)
    })
  })

  /**
   * Get PostgreSQL hosted workspace diagnostics for the current session.
   */
  ipcMain.handle('database:postgresDiagnostics', async () => {
    return wrapHandler(async () => {
      return await getPostgresDiagnostics(getDbManager)
    })
  })

  /**
   * Get the list of recent databases
   */
  ipcMain.handle('database:recentList', async () => {
    return wrapHandler(async () => {
      return getRecentDatabases(getDbManager)
    })
  })

  /**
   * Get database overview (summary stats, cases, cohorts, tags, phenotypes)
   */
  ipcMain.handle('database:overview', async () => {
    return wrapHandler(async () => {
      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({ type: 'database:overview', params: [] })
      }
      return getDatabaseOverview(getDb, getDbPool)
    })
  })

  /**
   * Remove a database from the recent list (does not delete the file)
   */
  ipcMain.handle('database:removeRecent', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:removeRecent path: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid file path')
      }
      return removeRecentDatabase(validated.data, getDbManager)
    })
  })

  /**
   * Delete a database file from disk and remove from recent list.
   */
  ipcMain.handle('database:deleteFile', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(`Invalid database:deleteFile path: ${validated.error.message}`, 'database')
        throw new Error('Invalid file path')
      }
      return deleteDbFile(validated.data, getDbManager)
    })
  })

  /**
   * Reveal a database file in the system file manager
   */
  ipcMain.handle('database:showInFolder', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        throw new Error('Invalid file path')
      }
      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })

  mainLogger.info('Database IPC handlers registered', 'database')
}
