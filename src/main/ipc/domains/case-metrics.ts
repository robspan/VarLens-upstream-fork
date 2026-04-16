import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerCaseMetricHandlers } from '../handlers/case-metrics'

export function registerCaseMetricsDomain(ipcMain: IpcMain): void {
  registerCaseMetricHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
