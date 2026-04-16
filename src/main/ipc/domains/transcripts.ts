import type { IpcMain } from 'electron'
import { getDatabaseService } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerTranscriptHandlers } from '../handlers/transcripts'

export function registerTranscriptsDomain(ipcMain: IpcMain): void {
  registerTranscriptHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbPool
  })
}
