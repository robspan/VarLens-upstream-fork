import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  PanelCreateSchema,
  PanelUpdateSchema,
  PanelGenesSchema,
  PanelActivateSchema,
  PanelDeactivateSchema,
  ValidateSymbolsSchema,
  AutocompleteSchema,
  PanelDuplicateSchema,
  PanelIdSchema,
  CaseIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'

/**
 * Panel and gene reference IPC handlers
 */
export function registerPanelHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  // ============================================================
  // Panel CRUD
  // ============================================================

  ipcMain.handle('panels:list', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.panels.listPanels()
    })
  })

  ipcMain.handle('panels:get', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:get id: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }

      const db = getDb()
      const panel = db.panels.getPanel(validated.data)
      if (!panel) return null

      const genes = db.panels.getGenes(validated.data)
      return { ...panel, genes }
    })
  })

  ipcMain.handle('panels:create', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelCreateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:create params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel parameters')
      }

      const db = getDb()
      return db.panels.createPanel(validated.data)
    })
  })

  ipcMain.handle('panels:update', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelUpdateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:update params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel update parameters')
      }

      const { id, ...updates } = validated.data
      const db = getDb()
      return db.panels.updatePanel(id, updates)
    })
  })

  ipcMain.handle('panels:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:delete id: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }

      const db = getDb()
      db.panels.deletePanel(validated.data)
      return { success: true }
    })
  })

  ipcMain.handle('panels:duplicate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelDuplicateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:duplicate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel duplicate parameters')
      }

      const db = getDb()
      return db.panels.duplicatePanel(validated.data.id, validated.data.newName)
    })
  })

  // ============================================================
  // Panel Genes
  // ============================================================

  ipcMain.handle('panels:setGenes', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelGenesSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:setGenes params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel genes parameters')
      }

      const db = getDb()
      db.panels.setGenes(validated.data.panelId, validated.data.genes)
      return { success: true }
    })
  })

  ipcMain.handle('panels:getGenes', async (_event, panelId: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelIdSchema.safeParse(panelId)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:getGenes panelId: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel ID')
      }

      const db = getDb()
      return db.panels.getGenes(validated.data)
    })
  })

  // ============================================================
  // Panel Activation (per-case)
  // ============================================================

  ipcMain.handle('panels:activate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelActivateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:activate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel activation parameters')
      }

      const db = getDb()
      db.panels.activatePanel(
        validated.data.caseId,
        validated.data.panelId,
        validated.data.paddingBp
      )
      return { success: true }
    })
  })

  ipcMain.handle('panels:deactivate', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelDeactivateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(`Invalid panels:deactivate params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid panel deactivation parameters')
      }

      const db = getDb()
      db.panels.deactivatePanel(validated.data.caseId, validated.data.panelId)
      return { success: true }
    })
  })

  ipcMain.handle('panels:active-for-case', async (_event, caseId: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(caseId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:active-for-case caseId: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid case ID')
      }

      const db = getDb()
      return db.panels.getActivePanelsForCase(validated.data)
    })
  })

  // ============================================================
  // Gene Reference Queries
  // ============================================================

  ipcMain.handle('panels:validate-symbols', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = ValidateSymbolsSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:validate-symbols params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid symbol validation parameters')
      }

      const geneRef = getGeneReferenceDb()
      return geneRef.validateSymbols(validated.data.symbols)
    })
  })

  ipcMain.handle('panels:autocomplete', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = AutocompleteSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:autocomplete params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid autocomplete parameters')
      }

      const geneRef = getGeneReferenceDb()
      return geneRef.autocomplete(validated.data.query, validated.data.limit)
    })
  })
}
