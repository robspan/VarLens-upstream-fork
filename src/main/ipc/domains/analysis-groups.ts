import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerAnalysisGroupHandlers } from '../handlers/analysis-groups'

export function registerAnalysisGroupsDomain(ipcMain: IpcMain): void {
  registerAnalysisGroupHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
