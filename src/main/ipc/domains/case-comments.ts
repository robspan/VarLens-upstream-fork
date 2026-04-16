import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { registerCaseCommentHandlers } from '../handlers/case-comments'

export function registerCaseCommentsDomain(ipcMain: IpcMain): void {
  registerCaseCommentHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
}
