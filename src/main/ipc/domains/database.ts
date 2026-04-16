import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerDatabaseHandlers } from '../handlers/database'

export function registerDatabaseDomain(ipcMain: IpcMain): void {
  registerDatabaseHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
