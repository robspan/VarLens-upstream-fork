import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerImportHandlers } from '../handlers/import'

export function registerImportDomain(ipcMain: IpcMain): void {
  registerImportHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
