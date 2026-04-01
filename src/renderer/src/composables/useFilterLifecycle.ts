/**
 * Composable for filter lifecycle management
 *
 * Handles case-switch watching, filter reset on case change,
 * and initial search setup. Extracted from useFilterState for modularity.
 */

import { watch, type Ref, type ComputedRef } from 'vue'
import type { VariantFilter } from '../../../shared/types/api'
import type { FilterState } from '../../../shared/types/filters'
import type { useFilterCore } from './useFilterCore'

/**
 * Options for useFilterLifecycle
 */
export interface UseFilterLifecycleOptions {
  /** Reactive ref to the current case ID */
  caseIdRef: Ref<number> | ComputedRef<number>
  /** Reactive filter state */
  filters: Ref<FilterState>
  /** Core filter composable (for reset) */
  core: ReturnType<typeof useFilterCore>
  /** Sync core state back to filters ref */
  syncCoreToFilters: () => void
  /** Reset presets to defaults */
  resetPresets: () => void
  /** Callback when filters update */
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  /** Callback when case switches */
  onCaseSwitch?: () => void
  /** Load filter options for a case */
  loadFilterOptions: (caseId: number) => Promise<void>
}

/**
 * Return type for useFilterLifecycle composable
 */
export interface UseFilterLifecycleReturn {
  /** Reset all filters for a case switch (without sort reset) */
  resetForCaseSwitch: () => void
  /** Set initial search query (e.g., from cohort navigation) */
  setInitialSearch: (search: string) => void
}

/**
 * Composable for filter lifecycle management
 *
 * Sets up the case-switch watcher, provides reset and initial search helpers.
 *
 * @param options - Lifecycle dependencies
 * @returns Lifecycle methods
 */
export function useFilterLifecycle(options: UseFilterLifecycleOptions): UseFilterLifecycleReturn {
  const {
    caseIdRef,
    filters,
    core,
    syncCoreToFilters,
    resetPresets,
    onFiltersUpdate,
    onCaseSwitch,
    loadFilterOptions
  } = options

  /**
   * Reset all filters for a case switch (without triggering sort reset)
   */
  const resetForCaseSwitch = (): void => {
    // Reset shared fields via core, then sync back to filters object
    core.reset()
    syncCoreToFilters()

    // Reset adapter-specific fields
    filters.value.searchQuery = ''
    filters.value.geneSymbol = ''
    filters.value.tagIds = []
    filters.value.starredOnly = false
    filters.value.hasCommentOnly = false
    filters.value.annotationScope = 'case'
    filters.value.activePanelIds = []
    filters.value.panelPaddingBp = 5000
    filters.value.inheritanceModes = []
    filters.value.analysisGroupId = null
    filters.value.considerPhasing = false
    resetPresets()
  }

  // Watch caseId prop and reset filters when case changes
  watch(caseIdRef, async (newCaseId, oldCaseId) => {
    if (newCaseId !== oldCaseId && oldCaseId !== undefined) {
      // Reset all filters when switching cases
      resetForCaseSwitch()

      // Notify parent to clear UI-only state (DSL column filters, etc.)
      onCaseSwitch?.()

      // Emit reset filters immediately (bypass debounce for case switch)
      onFiltersUpdate({})

      // Reload filter options for the new case
      await loadFilterOptions(newCaseId)
    }
  })

  /**
   * Set initial search query (e.g., from cohort navigation)
   */
  const setInitialSearch = (search: string): void => {
    if (search !== undefined && search !== '') {
      filters.value.searchQuery = search
    }
  }

  return {
    resetForCaseSwitch,
    setInitialSearch
  }
}
