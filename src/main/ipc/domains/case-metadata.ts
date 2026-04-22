import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerCaseMetadataHandlers } from '../handlers/case-metadata'

export function registerCaseMetadataDomain(ipcMain: IpcMain): void {
  registerCaseMetadataHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
