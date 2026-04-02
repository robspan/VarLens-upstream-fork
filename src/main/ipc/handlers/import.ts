import { dialog } from 'electron'
import { dirname } from 'path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { safeEmit } from '../utils/safeEmit'
import { loadSettings, saveSettings } from '../utils/settings-io'
import { startImport, cancelImport, getVcfPreview } from './import-logic'
import type { ImportCallbacks } from './import-logic'

/** Shared callbacks that wire logic-layer events to renderer via safeEmit. */
const importCallbacks: ImportCallbacks = {
  onProgress: (data) => safeEmit('import:progress', data)
}

export function registerImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('import:selectFile', async () => {
    return wrapHandler(async () => {
      const settings = await loadSettings()

      const result = await dialog.showOpenDialog({
        title: 'Select Variant File',
        defaultPath: settings.lastImportDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'Variant Files', extensions: ['vcf', 'json', 'gz'] },
          { name: 'VCF Files', extensions: ['vcf', 'gz'] },
          { name: 'JSON Files', extensions: ['json', 'gz'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled === true || result.filePaths.length === 0) {
        return null
      }

      const filePath = result.filePaths[0]
      await saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })

      return filePath
    })
  })

  ipcMain.handle(
    'import:start',
    async (
      _event,
      filePath: string,
      caseName: string,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string }
    ) => {
      return wrapHandler(async () => {
        return startImport(filePath, caseName, vcfOptions, getDb, importCallbacks)
      })
    }
  )

  ipcMain.handle('import:cancel', async () => {
    return wrapHandler(async () => {
      cancelImport()
    })
  })

  ipcMain.handle('import:vcfPreview', async (_event, filePath: string) => {
    return wrapHandler(async () => {
      return getVcfPreview(filePath)
    })
  })
}
