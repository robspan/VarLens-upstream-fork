import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerHpoHandlers } from '../handlers/hpo'

export function registerHpoDomain(ipcMain: IpcMain): void {
  registerHpoHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
