import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerAnnotationHandlers } from '../handlers/annotations'

export function registerAnnotationsDomain(ipcMain: IpcMain): void {
  registerAnnotationHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
