import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerCohortHandlers } from '../handlers/cohort'

export function registerCohortDomain(ipcMain: IpcMain): void {
  registerCohortHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
