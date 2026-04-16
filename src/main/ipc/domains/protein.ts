import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerProteinHandlers } from '../handlers/protein'

export function registerProteinDomain(ipcMain: IpcMain): void {
  registerProteinHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
