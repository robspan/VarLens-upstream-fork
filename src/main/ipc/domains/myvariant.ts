import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerMyVariantHandlers } from '../handlers/myvariant'

export function registerMyvariantDomain(ipcMain: IpcMain): void {
  registerMyVariantHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
