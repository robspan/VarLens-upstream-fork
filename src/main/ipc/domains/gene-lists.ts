import type { IpcMain } from 'electron'
import { registerGeneListHandlers } from '../handlers/gene-lists'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'

export function registerGeneListsDomain(ipcMain: IpcMain): void {
  registerGeneListHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
