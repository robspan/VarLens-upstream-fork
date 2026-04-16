import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerAuthHandlers } from '../handlers/auth'

export function registerAuthDomain(ipcMain: IpcMain): void {
  registerAuthHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
