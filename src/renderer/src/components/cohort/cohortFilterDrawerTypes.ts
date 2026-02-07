/**
 * Type definition for the filter state shared between CohortFilterBar and CohortFilterDrawer
 * via Vue provide/inject. This mirrors the case-view filterDrawerTypes.ts pattern but
 * adapted for cohort-specific filters (cohort frequency, no tags).
 */

import type { Ref, ComputedRef } from 'vue'

/**
 * Active filter representation for chip display
 */
export interface CohortActiveFilter {
  id: string
  label: string
  value: string
}

/**
 * Shape of the object provided by CohortFilterBar under the 'cohortFilterDrawerState' key.
 * CohortFilterDrawer injects this to access the same reactive filter state.
 */
export interface CohortFilterDrawerState {
  // Reactive filter state
  filters: Ref<{
    geneSymbol: string
    funcs: string[]
    clinvars: string[]
    maxGnomadAf: number | null
    minCadd: number | null
    minCohortFrequency: number | null
  }>
  searchTerm: Ref<string>

  // Preset selections
  selectedImpactPresets: Ref<string[]>
  selectedCohortFreqPreset: Ref<number | null>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>

  // Custom numeric inputs
  customCohortFreq: Ref<number | null>
  customGnomadAf: Ref<number | null>
  customCadd: Ref<number | null>

  // Gene autocomplete
  geneSymbolSuggestions: Ref<string[]>
  loadingGeneSuggestions: Ref<boolean>

  // Preset constants
  impactPresets: readonly { label: string; value: string; color: string }[]
  cohortFreqPresets: readonly { label: string; value: number }[]
  afPresets: readonly { label: string; value: number }[]
  caddPresets: readonly { label: string; value: number }[]

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFilterCount: ComputedRef<number>
  activeFiltersList: ComputedRef<CohortActiveFilter[]>

  // Methods
  isFilterGroupActive: (groupId: string) => boolean
  clearAllFilters: () => void
  clearFilter: (id: string) => void
  searchGeneSymbols: (query: string) => void
}
