import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerExportHandlers } from '../handlers/export'

export function registerExportDomain(ipcMain: IpcMain): void {
  registerExportHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
