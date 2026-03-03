import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch
 */

/**
 * List all transcripts for a variant
 */
ipcMain.handle('transcripts:list', async (_event, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getVariantTranscripts(variantId)
  })
})

/**
 * Switch the selected transcript for a variant
 */
ipcMain.handle(
  'transcripts:switch',
  async (_event, variantId: number, transcriptId: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.switchSelectedTranscript(variantId, transcriptId)
      return { success: true }
    })
  }
)
