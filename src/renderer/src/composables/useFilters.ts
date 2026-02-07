/**
 * Composable for filter state management with preset sync
 *
 * Extracts filter state handling from CohortTable.vue (lines 726-1105)
 * into a reusable composable with explicit return types.
 *
 * IMPORTANT: This is a SINGLETON composable - state is shared across all
 * components that call useFilters(). This enables CohortFilterBar and
 * CohortTable to share the same filter state without prop drilling.
 *
 * Provides:
 * - Core filter state (gene, consequences, funcs, clinvars, numeric filters)
 * - Preset selections for common filter values
 * - Bidirectional sync between presets and custom inputs
 * - hasActiveFilters computed for UI feedback
 * - activeFiltersList for chip-based filter summary
 * - clearAllFilters and clearFilter methods
 * - reset() for database context changes
 *
 * SOL-03: Centralized filter state management for CohortTable.vue.
 */

import { ref, computed, watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import {
  clearFilter as clearFilterUtil,
  buildActiveFiltersList,
  buildIpcParams,
  type FilterId,
  type ActiveFilter,
  type FilterIpcParams
} from '../utils/filters'

/**
 * NULL Handling Policy (ANTI-10)
 *
 * Numeric filters (gnomAD AF, CADD, cohort frequency) use NULL-inclusive semantics:
 * - NULL values in database PASS numeric filter conditions
 * - This prevents excluding novel/unannotated variants that lack external data
 *
 * Example: minCadd=20 matches variants where cadd >= 20 OR cadd IS NULL
 * Rationale: A variant without CADD annotation isn't necessarily benign
 *
 * This policy was established in Phase 26 (BUG-01, BUG-02) for consistency
 * between mock API and production database queries.
 */

/**
 * Valid ranges for numeric filters (ANTI-12)
 * - Cohort frequency: 0-100% (user input), stored as 0-1 decimal
 * - gnomAD AF: 0-100% (user input), stored as 0-1 decimal
 * - CADD score: 0-60 (raw phred score)
 */
const FILTER_RANGES = {
  cohortFreqPercent: { min: 0, max: 100 },
  gnomadAfPercent: { min: 0, max: 100 },
  cadd: { min: 0, max: 60 }
} as const

/**
 * Core filter state structure
 */
export interface FilterState {
  /** Gene symbol filter */
  geneSymbol: string
  /** Impact consequences to include */
  consequences: string[]
  /** Functional consequence types to include */
  funcs: string[]
  /** ClinVar classifications to include */
  clinvars: string[]
  /** Maximum gnomAD allele frequency (decimal, 0-1) */
  maxGnomadAf: number | null
  /** Minimum CADD phred score */
  minCadd: number | null
  /** Minimum cohort frequency (decimal, 0-1) */
  minCohortFrequency: number | null
  /** Minimum carrier count */
  minCarriers: number | null
}

/**
 * Return type for useFilters composable
 *
 * @property filters - Core filter state ref
 * @property searchTerm - Search term ref
 * @property selectedImpactPresets - Selected impact level presets
 * @property selectedCohortFreqPreset - Selected cohort frequency preset
 * @property selectedAfPreset - Selected gnomAD AF preset
 * @property selectedCaddPreset - Selected CADD preset
 * @property customCohortFreq - Custom cohort frequency input (percentage)
 * @property customGnomadAf - Custom gnomAD AF input (percentage)
 * @property customCadd - Custom CADD score input
 * @property hasActiveFilters - Computed boolean for any active filter
 * @property activeFiltersList - Computed list of active filters for display
 * @property clearAllFilters - Method to clear all filters
 * @property clearFilter - Method to clear a specific filter by ID
 * @property reset - Method to reset all state (for database switches)
 * @property getIpcParams - Method to build IPC-safe filter parameters
 */
export interface UseFiltersReturn {
  // Core filter state
  filters: Ref<FilterState>
  searchTerm: Ref<string>

  // Preset selections
  selectedImpactPresets: Ref<string[]>
  selectedCohortFreqPreset: Ref<number | null>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>

  // Custom numeric inputs (percentage units for user)
  customCohortFreq: Ref<number | null>
  customGnomadAf: Ref<number | null>
  customCadd: Ref<number | null>

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFiltersList: ComputedRef<ActiveFilter[]>

  // Actions
  clearAllFilters: () => void
  clearFilter: (filterId: string) => void
  reset: () => void
  getIpcParams: () => FilterIpcParams
}

/**
 * Create initial filter state
 */
function createInitialFilterState(): FilterState {
  return {
    geneSymbol: '',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    minCohortFrequency: null,
    minCarriers: null
  }
}

// ============================================================================
// SINGLETON STATE - Shared across all components calling useFilters()
// This is intentional architecture to enable filter state sharing between
// CohortFilterBar and CohortTable without prop drilling or event payloads.
// ============================================================================

// Core filter state (singleton)
const filters = ref<FilterState>(createInitialFilterState())
const searchTerm = ref('')

// Preset selections (singleton)
const selectedImpactPresets = ref<string[]>([])
const selectedCohortFreqPreset = ref<number | null>(null)
const selectedAfPreset = ref<number | null>(null)
const selectedCaddPreset = ref<number | null>(null)

// Custom inputs (percentage/raw values) (singleton)
const customCohortFreq = ref<number | null>(null) // Percentage (0-100)
const customGnomadAf = ref<number | null>(null) // Percentage (0-100)
const customCadd = ref<number | null>(null) // Raw CADD score

// Track if watchers have been initialized (only once)
let watchersInitialized = false

/**
 * Initialize watchers for bidirectional preset/custom sync
 * Only runs once per application lifetime
 */
function initializeWatchers(): void {
  if (watchersInitialized) return
  watchersInitialized = true

  // BIDIRECTIONAL SYNC: Preset -> Filter + clear custom
  // When a preset is selected, update the filter state and clear custom input
  watch(selectedCohortFreqPreset, (value) => {
    filters.value.minCohortFrequency = value
    if (value !== null) {
      customCohortFreq.value = null
    }
  })

  watch(selectedAfPreset, (value) => {
    filters.value.maxGnomadAf = value
    if (value !== null) {
      customGnomadAf.value = null
    }
  })

  watch(selectedCaddPreset, (value) => {
    filters.value.minCadd = value
    if (value !== null) {
      customCadd.value = null
    }
  })

  // Custom -> Filter + clear preset
  // When custom input is used, update filter state and clear preset
  watch(customCohortFreq, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (
      value < FILTER_RANGES.cohortFreqPercent.min ||
      value > FILTER_RANGES.cohortFreqPercent.max
    ) {
      // Invalid range - reset to null (consumer shows error via snackbar)
      customCohortFreq.value = null
      return
    }

    if (value > 0) {
      // Convert percentage (0-100) to decimal (0-1)
      // NOTE (ANTI-10): NULL values in database pass cohort frequency filter by design
      // (variants without cohort data should not be excluded by frequency filters)
      filters.value.minCohortFrequency = value / 100
      selectedCohortFreqPreset.value = null
    }
  })

  watch(customGnomadAf, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (value < FILTER_RANGES.gnomadAfPercent.min || value > FILTER_RANGES.gnomadAfPercent.max) {
      customGnomadAf.value = null
      return
    }

    if (value > 0) {
      // Convert percentage (0-100) to decimal (0-1)
      // NOTE (ANTI-10): NULL gnomAD AF values pass filter by design
      // (novel variants without population data should not be excluded)
      filters.value.maxGnomadAf = value / 100
      selectedAfPreset.value = null
    }
  })

  watch(customCadd, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (value < FILTER_RANGES.cadd.min || value > FILTER_RANGES.cadd.max) {
      customCadd.value = null
      return
    }

    if (value >= 0) {
      // NOTE (ANTI-10): NULL CADD scores pass filter by design
      // (variants without CADD annotation should not be excluded by score filters)
      filters.value.minCadd = value
      selectedCaddPreset.value = null
    }
  })
}

/**
 * Clear all filters and reset to initial state
 */
function clearAllFilters(): void {
  searchTerm.value = ''
  filters.value = createInitialFilterState()
  selectedImpactPresets.value = []
  selectedCohortFreqPreset.value = null
  selectedAfPreset.value = null
  selectedCaddPreset.value = null
  customCohortFreq.value = null
  customGnomadAf.value = null
  customCadd.value = null
}

/**
 * Clear a specific filter by ID
 *
 * @param filterId - The ID of the filter to clear
 */
function clearFilter(filterId: string): void {
  // Use shared utility for filter state updates
  const partialUpdate = clearFilterUtil(filterId as FilterId)

  // Handle searchQuery -> searchTerm mapping
  if ('searchQuery' in partialUpdate) {
    searchTerm.value = partialUpdate.searchQuery as string
    delete partialUpdate.searchQuery
  }

  // Apply remaining filter updates
  Object.assign(filters.value, partialUpdate)

  // Clear associated presets and custom inputs
  switch (filterId) {
    case 'frequency':
      selectedAfPreset.value = null
      customGnomadAf.value = null
      break
    case 'cadd':
      selectedCaddPreset.value = null
      customCadd.value = null
      break
    case 'cohortFreq':
      selectedCohortFreqPreset.value = null
      customCohortFreq.value = null
      break
    case 'impact':
      selectedImpactPresets.value = []
      break
  }
}

// Computed: has active filters (matches CohortTable logic)
const hasActiveFilters = computed(() => {
  const afActive =
    filters.value.maxGnomadAf !== null &&
    !Number.isNaN(filters.value.maxGnomadAf) &&
    filters.value.maxGnomadAf > 0
  const caddActive =
    filters.value.minCadd !== null &&
    !Number.isNaN(filters.value.minCadd) &&
    filters.value.minCadd >= 0
  const cohortFreqActive =
    filters.value.minCohortFrequency !== null &&
    !Number.isNaN(filters.value.minCohortFrequency) &&
    filters.value.minCohortFrequency > 0

  return (
    searchTerm.value !== '' ||
    filters.value.geneSymbol !== '' ||
    filters.value.consequences.length > 0 ||
    filters.value.funcs.length > 0 ||
    filters.value.clinvars.length > 0 ||
    afActive ||
    caddActive ||
    cohortFreqActive ||
    (filters.value.minCarriers !== null && filters.value.minCarriers > 0) ||
    // Preset selections
    selectedImpactPresets.value.length > 0 ||
    selectedCohortFreqPreset.value !== null ||
    selectedAfPreset.value !== null ||
    selectedCaddPreset.value !== null
  )
})

// Computed: active filters list for chip display
const activeFiltersList = computed<ActiveFilter[]>(() => {
  // Merge searchTerm into FilterState shape for utility
  const stateWithSearch = {
    ...filters.value,
    searchQuery: searchTerm.value
  }
  return buildActiveFiltersList(stateWithSearch, selectedImpactPresets.value)
})

/**
 * Build IPC-safe filter parameters for data fetching and export
 *
 * Uses shared buildIpcParams utility to convert filter state to
 * IPC-compatible format (snake_case keys, no undefined values).
 * Handles searchTerm -> searchQuery mapping.
 *
 * @returns FilterIpcParams object ready for IPC calls
 */
function getIpcParams(): FilterIpcParams {
  // Merge searchTerm into FilterState shape for utility
  const stateWithSearch = {
    ...filters.value,
    searchQuery: searchTerm.value
  }
  return buildIpcParams(stateWithSearch)
}

/**
 * Reset all state (alias for clearAllFilters, for database context changes)
 */
function reset(): void {
  clearAllFilters()
}

/**
 * Reset singleton state for testing purposes
 * This should ONLY be called in test setup (beforeEach)
 */
export function _resetFiltersForTesting(): void {
  clearAllFilters()
  watchersInitialized = false
}

/**
 * Composable for filter state management with bidirectional preset sync
 *
 * NOTE: This is a SINGLETON composable. All components calling useFilters()
 * share the same filter state. This is intentional to enable CohortFilterBar
 * and CohortTable to stay in sync without prop drilling.
 *
 * @returns Object with filter state refs and management methods
 *
 * @example
 * ```typescript
 * const {
 *   filters,
 *   searchTerm,
 *   selectedImpactPresets,
 *   selectedAfPreset,
 *   hasActiveFilters,
 *   clearAllFilters
 * } = useFilters()
 *
 * // Bind to UI
 * <v-text-field v-model="filters.geneSymbol" />
 * <v-chip-group v-model="selectedImpactPresets" />
 *
 * // Check if filters are active
 * if (hasActiveFilters.value) {
 *   // Show clear button
 * }
 *
 * // Clear all filters
 * clearAllFilters()
 * ```
 */
export function useFilters(): UseFiltersReturn {
  // Initialize watchers on first call (singleton behavior)
  initializeWatchers()

  return {
    filters,
    searchTerm,
    selectedImpactPresets,
    selectedCohortFreqPreset,
    selectedAfPreset,
    selectedCaddPreset,
    customCohortFreq,
    customGnomadAf,
    customCadd,
    hasActiveFilters,
    activeFiltersList,
    clearAllFilters,
    clearFilter,
    reset,
    getIpcParams
  }
}
