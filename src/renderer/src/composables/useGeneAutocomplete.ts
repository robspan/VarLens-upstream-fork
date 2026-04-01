/**
 * Composable for gene symbol autocomplete functionality
 *
 * Encapsulates gene symbol suggestion loading, debounced IPC calls,
 * and clear handling. Extracted from useFilterState for modularity.
 */

import { ref, type Ref, type ComputedRef } from 'vue'
import type { WindowAPI } from '../../../shared/types/api'
import type { FilterState } from '../../../shared/types/filters'
import { logService } from '../services/LogService'

/**
 * Return type for useGeneAutocomplete composable
 */
export interface UseGeneAutocompleteReturn {
  /** Available gene symbol suggestions from autocomplete */
  geneSymbolSuggestions: Ref<string[]>
  /** Whether suggestions are currently loading */
  loadingSuggestions: Ref<boolean>
  /** Search for gene symbols matching query (debounced IPC) */
  searchGeneSymbols: (query: string) => Promise<void>
  /** Clear gene symbol filter and suggestions */
  handleGeneClear: () => void
}

/**
 * Composable for gene symbol autocomplete
 *
 * @param api - Window API instance (undefined in browser dev mode)
 * @param caseIdRef - Reactive ref to the current case ID
 * @param filters - Reactive ref to the filter state (mutates geneSymbol on clear)
 * @returns Gene autocomplete state and methods
 */
export function useGeneAutocomplete(
  api: WindowAPI | undefined,
  caseIdRef: Ref<number> | ComputedRef<number>,
  filters: Ref<FilterState>
): UseGeneAutocompleteReturn {
  const geneSymbolSuggestions = ref<string[]>([])
  const loadingSuggestions = ref(false)

  const handleGeneClear = (): void => {
    filters.value.geneSymbol = ''
    geneSymbolSuggestions.value = []
  }

  const searchGeneSymbols = async (query: string): Promise<void> => {
    if (!query || query.length < 2) {
      geneSymbolSuggestions.value = []
      return
    }

    loadingSuggestions.value = true
    try {
      // Use optimized geneSymbols API - direct LIKE query instead of FTS5
      const results: string[] = await api!.variants.geneSymbols(caseIdRef.value, query, 50)
      geneSymbolSuggestions.value = results
    } catch (e) {
      logService.warn(
        'Gene symbol autocomplete failed: ' + (e instanceof Error ? e.message : String(e)),
        'filters'
      )
      geneSymbolSuggestions.value = []
    } finally {
      loadingSuggestions.value = false
    }
  }

  return {
    geneSymbolSuggestions,
    loadingSuggestions,
    searchGeneSymbols,
    handleGeneClear
  }
}
