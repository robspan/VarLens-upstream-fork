import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'

/**
 * Gene Reference database IPC handlers
 */
export function registerGeneRefHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('gene-ref:info', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      return geneRef.getInfo()
    })
  })

  ipcMain.handle('gene-ref:assemblies', async () => {
    return wrapHandler(async () => {
      const geneRef = getGeneReferenceDb()
      return geneRef.getAssemblies()
    })
  })
}
