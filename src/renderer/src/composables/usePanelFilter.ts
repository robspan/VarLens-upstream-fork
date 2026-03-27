/**
 * Composable for panel selection in the filter sidebar
 *
 * Loads available panels and exposes them for selection in the
 * PanelFilterSection component. Panels are global (not per-case),
 * so no case ID is required.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import { useApiService } from './useApiService'

/**
 * Panel option for filter selection UI
 */
export interface PanelOption {
  id: number
  name: string
  gene_count: number
  source: string
}

/**
 * Return type for usePanelFilter composable
 */
export interface UsePanelFilterReturn {
  availablePanels: Ref<PanelOption[]>
  loading: Ref<boolean>
  loadAvailablePanels: () => Promise<void>
}

/**
 * Composable for loading available panels for filter selection
 *
 * @returns Available panels list and loading state
 */
export function usePanelFilter(): UsePanelFilterReturn {
  const { api } = useApiService()
  const availablePanels = ref<PanelOption[]>([])
  const loading = ref(false)

  /**
   * Fetch all panels from the database for filter selection
   */
  async function loadAvailablePanels(): Promise<void> {
    if (!api) return
    loading.value = true
    try {
      const panels = await api.panels.list()
      availablePanels.value = panels.map(
        (p: { id: number; name: string; gene_count: number; source: string }) => ({
          id: p.id,
          name: p.name,
          gene_count: p.gene_count,
          source: p.source
        })
      )
    } catch (e) {
      console.error('Failed to load panels for filter:', e)
      availablePanels.value = []
    } finally {
      loading.value = false
    }
  }

  // Load panels immediately on init
  loadAvailablePanels()

  return {
    availablePanels,
    loading,
    loadAvailablePanels
  }
}
