/**
 * Composable for managing gene panels (CRUD operations)
 *
 * Provides reactive panel list with create, update, delete, duplicate,
 * and gene management operations via IPC.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary item returned from panels:list */
export interface PanelListItem {
  id: number
  name: string
  description: string | null
  version: string | null
  source: string
  source_id: string | null
  gene_count: number
  created_at: number
  updated_at: number
}

/** Input for creating a new panel */
export interface CreatePanelInput {
  name: string
  description?: string | null
  version?: string | null
  source: string
  sourceId?: string | null
  sourceMetadata?: Record<string, unknown> | null
}

/** Gene entry for panel gene management */
export interface PanelGene {
  hgncId: string
  symbol: string
}

/** Return type for usePanelManager composable */
export interface UsePanelManagerReturn {
  panels: Ref<PanelListItem[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  loadPanels: () => Promise<void>
  createPanel: (input: CreatePanelInput) => Promise<number | undefined>
  updatePanel: (
    id: number,
    updates: { name?: string; description?: string | null; version?: string | null }
  ) => Promise<void>
  deletePanel: (id: number) => Promise<void>
  duplicatePanel: (id: number, newName: string) => Promise<number | undefined>
  setGenes: (panelId: number, genes: PanelGene[]) => Promise<void>
  getGenes: (panelId: number) => Promise<PanelGene[]>
}

// ---------------------------------------------------------------------------
// Shared state (singleton across all usePanelManager() calls)
// ---------------------------------------------------------------------------

const _panels = ref<PanelListItem[]>([])
const _loading = ref(false)
const _error = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Composable for gene panel CRUD operations.
 *
 * Uses shared singleton state so all consumers (PanelManagerDialog,
 * PanelFilterSection, etc.) see the same panel list and stay in sync.
 *
 * @returns Reactive panel list and management methods
 */
export function usePanelManager(): UsePanelManagerReturn {
  const { api } = useApiService()

  const panels = _panels
  const loading = _loading
  const error = _error

  /**
   * Fetch all panels from the database
   */
  const loadPanels = async (): Promise<void> => {
    if (!api) return

    loading.value = true
    error.value = null
    try {
      panels.value = await api.panels.list()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to load panels: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new panel and reload the list
   * @returns The new panel ID, or undefined on error
   */
  const createPanel = async (input: CreatePanelInput): Promise<number | undefined> => {
    if (!api) return undefined

    error.value = null
    try {
      const result = await api.panels.create({
        name: input.name,
        description: input.description ?? null,
        version: input.version ?? null,
        source: input.source,
        sourceId: input.sourceId ?? null,
        sourceMetadata: input.sourceMetadata ?? null
      })
      await loadPanels()
      return result?.id ?? result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to create panel: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
      return undefined
    }
  }

  /**
   * Update a panel and reload the list
   */
  const updatePanel = async (
    id: number,
    updates: { name?: string; description?: string | null; version?: string | null }
  ): Promise<void> => {
    if (!api) return

    error.value = null
    try {
      await api.panels.update({ id, ...updates })
      await loadPanels()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to update panel: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
    }
  }

  /**
   * Delete a panel and reload the list
   */
  const deletePanel = async (id: number): Promise<void> => {
    if (!api) return

    error.value = null
    try {
      await api.panels.delete(id)
      await loadPanels()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to delete panel: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
    }
  }

  /**
   * Duplicate a panel and reload the list
   * @returns The new panel ID, or undefined on error
   */
  const duplicatePanel = async (id: number, newName: string): Promise<number | undefined> => {
    if (!api) return undefined

    error.value = null
    try {
      const result = await api.panels.duplicate(id, newName)
      await loadPanels()
      return result?.id ?? result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to duplicate panel: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
      return undefined
    }
  }

  /**
   * Set the genes for a panel and reload the list
   */
  const setGenes = async (panelId: number, genes: PanelGene[]): Promise<void> => {
    if (!api) return

    error.value = null
    try {
      await api.panels.setGenes(panelId, genes)
      await loadPanels()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      logService.error(
        'Failed to set panel genes: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
    }
  }

  /**
   * Get the genes for a panel
   */
  const getGenes = async (panelId: number): Promise<PanelGene[]> => {
    if (!api) return []

    try {
      const rows = await api.panels.getGenes(panelId)
      return rows.map((r) => ({ hgncId: r.hgnc_id, symbol: r.symbol }))
    } catch (e) {
      logService.error(
        'Failed to get panel genes: ' + (e instanceof Error ? e.message : String(e)),
        'panels'
      )
      return []
    }
  }

  return {
    panels,
    loading,
    error,
    loadPanels,
    createPanel,
    updatePanel,
    deletePanel,
    duplicatePanel,
    setGenes,
    getGenes
  }
}
