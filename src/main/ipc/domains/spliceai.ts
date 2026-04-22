import type { IpcMain } from 'electron'
import { registerSpliceAIHandlers } from '../handlers/spliceai'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'

export function registerSpliceaiDomain(ipcMain: IpcMain): void {
  registerSpliceAIHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
