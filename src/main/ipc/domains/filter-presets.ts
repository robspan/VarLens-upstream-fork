import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerFilterPresetHandlers } from '../handlers/filter-presets'

export function registerFilterPresetsDomain(ipcMain: IpcMain): void {
  registerFilterPresetHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  })
}
