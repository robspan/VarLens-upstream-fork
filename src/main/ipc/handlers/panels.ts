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
  CaseIdSchema,
  PanelAppSearchSchema,
  PanelAppImportSchema,
  StringDbGenerateSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'
import { PanelAppClient } from '../../services/api/PanelAppClient'
import { StringDbClient } from '../../services/api/StringDbClient'

/** Confidence levels considered "green" (high confidence) */
const GREEN_LEVELS = new Set(['3', '4', 'green'])

/** Confidence levels considered "green + amber" (medium-high confidence) */
const GREEN_AMBER_LEVELS = new Set(['2', '3', '4', 'green', 'amber'])

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
        mainLogger.error(`Invalid panels:autocomplete params: ${validated.error.message}`, 'panels')
        throw new Error('Invalid autocomplete parameters')
      }

      const geneRef = getGeneReferenceDb()
      return geneRef.autocomplete(validated.data.query, validated.data.limit)
    })
  })

  // ============================================================
  // PanelApp / StringDB Integration
  // ============================================================

  ipcMain.handle('panels:search-panelapp', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelAppSearchSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:search-panelapp params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid PanelApp search parameters')
      }

      const client = new PanelAppClient()
      return client.searchPanels(validated.data.keyword, validated.data.region)
    })
  })

  ipcMain.handle('panels:import-panelapp', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = PanelAppImportSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:import-panelapp params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid PanelApp import parameters')
      }

      const { panelId, region, confidenceThreshold, name } = validated.data

      // 1. Fetch full panel from PanelApp
      const client = new PanelAppClient()
      const panel = await client.getPanel(panelId, region)

      // 2. Filter genes by confidence level
      const confidenceSet =
        confidenceThreshold === 'green'
          ? GREEN_LEVELS
          : confidenceThreshold === 'green_amber'
            ? GREEN_AMBER_LEVELS
            : null // 'all' = no filter

      const filteredGenes = confidenceSet
        ? panel.genes.filter((g) => confidenceSet.has(g.confidence_level))
        : panel.genes

      // 3. Validate gene symbols against gene reference DB
      const geneRef = getGeneReferenceDb()
      const symbols = filteredGenes.map((g) => g.gene_data.gene_symbol)
      const validationResults = geneRef.validateSymbols(symbols)

      // Build genes array with resolved symbols and HGNC IDs
      const resolvedGenes: Array<{ hgncId: string; symbol: string }> = []
      for (const result of validationResults) {
        if (
          result.status === 'approved' &&
          result.hgncId !== undefined &&
          result.symbol !== undefined
        ) {
          resolvedGenes.push({ hgncId: result.hgncId, symbol: result.symbol })
        } else if (
          result.status === 'alias' &&
          result.hgncId !== undefined &&
          result.currentSymbol !== undefined
        ) {
          // Use the current approved symbol for aliases
          resolvedGenes.push({ hgncId: result.hgncId, symbol: result.currentSymbol })
        }
        // Skip 'ambiguous' and 'unknown' genes
      }

      // 4. Create panel in DB
      const db = getDb()
      const source = region === 'uk' ? 'panelapp_uk' : 'panelapp_aus'
      const createdPanel = db.panels.createPanel({
        name: name ?? `${panel.name} (PanelApp ${region.toUpperCase()})`,
        description: `Imported from PanelApp ${region.toUpperCase()} v${panel.version}`,
        version: panel.version,
        source,
        sourceId: String(panelId),
        sourceMetadata: {
          confidence_threshold: confidenceThreshold,
          total_genes: panel.genes.length,
          filtered_genes: filteredGenes.length,
          resolved_genes: resolvedGenes.length,
          panel_version: panel.version
        }
      })

      // 5. Set genes
      if (resolvedGenes.length > 0) {
        db.panels.setGenes(createdPanel.id, resolvedGenes)
      }

      // Return panel with gene count
      const genes = db.panels.getGenes(createdPanel.id)
      return { ...createdPanel, genes }
    })
  })

  ipcMain.handle('panels:generate-stringdb', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = StringDbGenerateSchema.safeParse(params)
      if (!validated.success) {
        mainLogger.error(
          `Invalid panels:generate-stringdb params: ${validated.error.message}`,
          'panels'
        )
        throw new Error('Invalid StringDB generation parameters')
      }

      const { seedGenes, requiredScore, networkType, name } = validated.data

      // 1. Query StringDB for interaction partners
      const client = new StringDbClient()
      const partners = await client.getInteractionPartners(seedGenes, {
        requiredScore,
        networkType
      })

      // 2. Validate all genes (seed + partners) against gene reference DB
      const geneRef = getGeneReferenceDb()
      const allSymbols = [...seedGenes, ...partners.map((p) => p.symbol)]
      const validationResults = geneRef.validateSymbols(allSymbols)

      // Build resolved genes
      const resolvedGenes: Array<{ hgncId: string; symbol: string }> = []
      const seenHgnc = new Set<string>()

      for (const result of validationResults) {
        let hgncId: string | undefined
        let symbol: string | undefined

        if (
          result.status === 'approved' &&
          result.hgncId !== undefined &&
          result.symbol !== undefined
        ) {
          hgncId = result.hgncId
          symbol = result.symbol
        } else if (
          result.status === 'alias' &&
          result.hgncId !== undefined &&
          result.currentSymbol !== undefined
        ) {
          hgncId = result.hgncId
          symbol = result.currentSymbol
        }

        if (hgncId !== undefined && symbol !== undefined && !seenHgnc.has(hgncId)) {
          seenHgnc.add(hgncId)
          resolvedGenes.push({ hgncId, symbol })
        }
      }

      // 3. Create panel
      const db = getDb()
      const createdPanel = db.panels.createPanel({
        name:
          name ??
          `StringDB Network (${seedGenes.slice(0, 3).join(', ')}${seedGenes.length > 3 ? '...' : ''})`,
        description: `Generated from StringDB ${networkType} network (score >= ${requiredScore})`,
        source: 'stringdb',
        sourceMetadata: {
          seed_genes: seedGenes,
          score_threshold: requiredScore,
          network_type: networkType,
          partners_found: partners.length
        }
      })

      // 4. Set genes
      if (resolvedGenes.length > 0) {
        db.panels.setGenes(createdPanel.id, resolvedGenes)
      }

      const genes = db.panels.getGenes(createdPanel.id)
      return { ...createdPanel, genes }
    })
  })
}
