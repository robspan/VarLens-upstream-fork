import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerGnomadHandlers } from '../handlers/gnomad'

export function registerGnomadDomain(ipcMain: IpcMain): void {
  registerGnomadHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
