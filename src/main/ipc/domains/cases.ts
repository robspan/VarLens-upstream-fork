import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerCaseHandlers } from '../handlers/cases'

export function registerCasesDomain(ipcMain: IpcMain): void {
  registerCaseHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
