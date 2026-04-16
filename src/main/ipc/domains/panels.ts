import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerPanelHandlers } from '../handlers/panels'

export function registerPanelsDomain(ipcMain: IpcMain): void {
  registerPanelHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
