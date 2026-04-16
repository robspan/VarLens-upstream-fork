import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerBatchImportHandlers } from '../handlers/batch-import'

export function registerBatchImportDomain(ipcMain: IpcMain): void {
  registerBatchImportHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
