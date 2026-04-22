import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerAuditLogHandlers } from '../handlers/audit-log'

export function registerAuditLogDomain(ipcMain: IpcMain): void {
  registerAuditLogHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
