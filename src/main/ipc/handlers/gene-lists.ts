import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { readFileSync } from 'node:fs'

/**
 * Gene Lists and Region Files IPC handlers
 */

// ============================================================
// Gene Lists
// ============================================================

ipcMain.handle('gene-lists:list', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listGeneLists()
  })
})

ipcMain.handle('gene-lists:create', async (_event, name: string, description?: string | null) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.createGeneList(name, description)
  })
})

ipcMain.handle('gene-lists:delete', async (_event, id: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteGeneList(id)
    return undefined
  })
})

ipcMain.handle('gene-lists:getGenes', async (_event, listId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getGeneListGenes(listId)
  })
})

ipcMain.handle('gene-lists:setGenes', async (_event, listId: number, genes: string[]) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.setGeneListGenes(listId, genes)
    return db.getGeneListGenes(listId)
  })
})

// ============================================================
// Region Files (BED)
// ============================================================

ipcMain.handle('region-files:list', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listRegionFiles()
  })
})

ipcMain.handle('region-files:create', async (_event, name: string, description: string | null) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.createRegionFile(name, description)
  })
})

ipcMain.handle('region-files:delete', async (_event, id: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteRegionFile(id)
    return undefined
  })
})

ipcMain.handle('region-files:importBed', async (_event, fileId: number, filePath: string) => {
  return wrapHandler(async () => {
    const content = readFileSync(filePath, 'utf-8')
    const entries: Array<{ chr: string; start: number; end: number; label?: string }> = []

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (
        trimmed === '' ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('browser') ||
        trimmed.startsWith('track')
      ) {
        continue
      }
      const parts = trimmed.split('\t')
      if (parts.length >= 3) {
        const start = parseInt(parts[1], 10)
        const end = parseInt(parts[2], 10)
        if (!isNaN(start) && !isNaN(end)) {
          entries.push({
            chr: parts[0],
            start,
            end,
            label: parts.length >= 4 ? parts[3] : undefined
          })
        }
      }
    }

    const db = getDatabaseService()
    return db.importBedEntries(fileId, entries)
  })
})
