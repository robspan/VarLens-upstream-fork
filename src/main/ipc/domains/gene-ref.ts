import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerGeneRefHandlers } from '../handlers/gene-ref'

export function registerGeneRefDomain(ipcMain: IpcMain): void {
  registerGeneRefHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
