/**
 * Composable for panel selection in the filter sidebar
 *
 * Delegates to usePanelManager's shared singleton state so the filter
 * sidebar and PanelManagerDialog always see the same panel list.
 */

import { computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { usePanelManager } from './usePanelManager'

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
  availablePanels: Ref<PanelOption[]> | ComputedRef<PanelOption[]>
  loading: Ref<boolean>
  loadAvailablePanels: () => Promise<void>
}

/**
 * Composable for loading available panels for filter selection.
 *
 * Uses the shared panel list from usePanelManager so CRUD operations
 * in PanelManagerDialog automatically update the filter dropdown.
 *
 * @returns Available panels list and loading state
 */
export function usePanelFilter(): UsePanelFilterReturn {
  const { panels, loading, loadPanels } = usePanelManager()

  // Map PanelListItem[] to PanelOption[] (subset of fields for the dropdown)
  const availablePanels = computed<PanelOption[]>(() =>
    panels.value.map((p) => ({
      id: p.id,
      name: p.name,
      gene_count: p.gene_count,
      source: p.source
    }))
  )

  return {
    availablePanels,
    loading,
    loadAvailablePanels: loadPanels
  }
}
