/**
 * Shared filter types for variant filtering across components
 *
 * Moves filter type definitions from local component/composable definitions
 * to shared types for consistency and single source of truth.
 *
 * Used by:
 * - src/renderer/src/utils/filters/* (pure utilities)
 * - src/renderer/src/composables/useFilters.ts
 * - CohortTable.vue, FilterToolbar.vue
 */

/**
 * Active filter representation for chip display
 */
export interface ActiveFilter {
  /** Unique filter identifier (e.g., 'gene', 'frequency', 'impact') */
  id: string
  /** Human-readable label for display */
  label: string
  /** Current filter value as string */
  value: string
}

/**
 * Filter state for cohort/variant queries
 * All numeric thresholds stored as decimals (0-1 for percentages)
 */
export interface FilterState {
  /** Gene symbol filter (FTS5 search) */
  geneSymbol: string
  /** Full-text search term */
  searchQuery: string
  /** Selected consequence types (HIGH, MODERATE, etc.) */
  consequences: string[]
  /** Selected functional annotations */
  funcs: string[]
  /** Selected ClinVar classifications */
  clinvars: string[]
  /** Maximum gnomAD allele frequency (0-1) */
  maxGnomadAf: number | null
  /** Minimum CADD score (0-60) */
  minCadd: number | null
  /** Minimum cohort frequency (0-1) - cohort view only */
  minCohortFrequency: number | null
  /** Minimum carrier count - cohort view only */
  minCarriers: number | null
}

/**
 * IPC-safe filter parameters for database queries
 * Uses snake_case to match database column naming
 */
export interface FilterIpcParams {
  search_term?: string
  gene_symbol?: string
  consequences?: string[]
  funcs?: string[]
  clinvars?: string[]
  gnomad_af_max?: number
  cadd_min?: number
  cohort_frequency_min?: number
  carrier_count_min?: number
}
