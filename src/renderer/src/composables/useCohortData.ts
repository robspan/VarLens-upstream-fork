/**
 * Composable for cohort variant data loading with pagination
 *
 * Extracts data loading logic from CohortTable.vue (lines 982-1048, 964-980)
 * into a reusable composable with explicit return types.
 *
 * Provides:
 * - Variant fetching with pagination and filtering
 * - Loading state management
 * - Error handling via ref (consumer decides how to display)
 * - Cohort summary fetching
 * - Reset method for database context changes
 *
 * SOL-02: Centralized cohort data management for CohortTable.vue.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type {
  CohortVariant,
  CohortSummary,
  CohortPaginationCursor
} from '../../../shared/types/cohort'
import { useApiService } from './useApiService'

/**
 * Query parameters for cohort variant fetching
 */
export interface CohortQueryParams {
  /** Number of items per page */
  limit: number
  /** Cursor for keyset pagination (undefined = first page) */
  cursor?: CohortPaginationCursor
  /** Column to sort by */
  sort_by?: string
  /** Sort direction */
  sort_order: 'asc' | 'desc'
  /** Search term (gene symbol, chr:pos) */
  search_term?: string
  /** Gene symbol exact match */
  gene_symbol?: string
  /** Impact levels to include (HIGH, MODERATE, LOW) */
  consequences?: string[]
  /** Functional consequence types to include */
  funcs?: string[]
  /** ClinVar classifications to include */
  clinvars?: string[]
  /** Maximum gnomAD allele frequency */
  gnomad_af_max?: number
  /** Minimum CADD phred score */
  cadd_min?: number
  /** Minimum cohort frequency (carrier_count / total_cases) */
  cohort_frequency_min?: number
  /** Minimum carrier count */
  carrier_count_min?: number
  /** Show only starred variants (global annotations) */
  starred_only?: boolean
  /** Show only variants with comments (global annotations) */
  has_comment?: boolean
  /** Filter by ACMG classifications (global annotations) */
  acmg_classifications?: string[]
  /** Per-column text filters from table header inputs */
  column_filters?: Record<string, string>
}

/**
 * Return type for useCohortData composable
 *
 * @property variants - Array of cohort variants
 * @property totalCount - Total number of variants matching query (for pagination)
 * @property isLoading - Loading state indicator
 * @property error - Error object if fetch failed (null when no error)
 * @property summary - Cohort summary statistics (null until fetched)
 * @property fetchVariants - Method to fetch variants with given params
 * @property fetchSummary - Method to fetch cohort summary
 * @property reset - Method to reset all state (for database switches)
 */
/** Raw result from cohort variant query (before state update) */
export interface CohortQueryResult {
  data: CohortVariant[]
  total_count: number
  next_cursor: CohortPaginationCursor | null
  has_more: boolean
}

export interface UseCohortDataReturn {
  /** Array of cohort variants */
  variants: Ref<CohortVariant[]>
  /** Total count for pagination */
  totalCount: Ref<number>
  /** Loading state */
  isLoading: Ref<boolean>
  /** Error state - consumer decides how to display */
  error: Ref<Error | null>
  /** Cohort summary statistics */
  summary: Ref<CohortSummary | null>
  /** Cursor for next page, null if no more results */
  nextCursor: Ref<CohortPaginationCursor | null>
  /** Whether more results exist */
  hasMore: Ref<boolean>
  /** Fetch variants and update reactive state */
  fetchVariants: (params: CohortQueryParams) => Promise<void>
  /** Query variants without updating reactive state (for cursor prefetching) */
  queryVariants: (params: CohortQueryParams) => Promise<CohortQueryResult>
  /** Fetch cohort summary */
  fetchSummary: () => Promise<void>
  /** Reset all state (for database context changes) */
  reset: () => void
}

/**
 * Composable for cohort variant data loading
 *
 * @returns Object with variant data refs and fetch methods
 *
 * @example
 * ```typescript
 * const { variants, totalCount, isLoading, error, fetchVariants, reset } = useCohortData()
 *
 * // Fetch variants with pagination
 * await fetchVariants({
 *   limit: 50,
 *   offset: 0,
 *   sort_order: 'desc',
 *   gene_symbol: 'BRCA1'
 * })
 *
 * // Handle loading state
 * if (isLoading.value) {
 *   // Show spinner
 * }
 *
 * // Handle error
 * if (error.value) {
 *   // Display error message
 * }
 *
 * // Reset on database switch
 * reset()
 * ```
 */
export function useCohortData(): UseCohortDataReturn {
  const { api } = useApiService()

  // State refs
  const variants = ref<CohortVariant[]>([])
  const totalCount = ref(0)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const summary = ref<CohortSummary | null>(null)
  const nextCursor = ref<CohortPaginationCursor | null>(null)
  const hasMore = ref(false)

  /**
   * Build IPC-safe params from query parameters.
   * Filters out undefined values and strips Vue reactive proxies.
   */
  const buildIpcParams = (params: CohortQueryParams): Record<string, unknown> => {
    const ipcParams: Record<string, unknown> = {
      limit: params.limit,
      sort_order: params.sort_order
    }

    if (params.cursor !== undefined) {
      ipcParams.cursor = {
        sort_value: params.cursor.sort_value,
        sort_key: params.cursor.sort_key,
        variant_key: params.cursor.variant_key
      }
    }
    if (params.sort_by !== undefined && params.sort_by !== '') {
      ipcParams.sort_by = params.sort_by
    }
    if (params.search_term !== undefined && params.search_term !== '') {
      ipcParams.search_term = params.search_term
    }
    if (params.gene_symbol !== undefined && params.gene_symbol !== '') {
      ipcParams.gene_symbol = params.gene_symbol
    }
    if (params.consequences !== undefined && params.consequences.length > 0) {
      ipcParams.consequences = [...params.consequences]
    }
    if (params.funcs !== undefined && params.funcs.length > 0) {
      ipcParams.funcs = [...params.funcs]
    }
    if (params.clinvars !== undefined && params.clinvars.length > 0) {
      ipcParams.clinvars = [...params.clinvars]
    }
    if (params.gnomad_af_max !== undefined) {
      ipcParams.gnomad_af_max = params.gnomad_af_max
    }
    if (params.cadd_min !== undefined) {
      ipcParams.cadd_min = params.cadd_min
    }
    if (params.cohort_frequency_min !== undefined) {
      ipcParams.cohort_frequency_min = params.cohort_frequency_min
    }
    if (params.carrier_count_min !== undefined) {
      ipcParams.carrier_count_min = params.carrier_count_min
    }
    if (params.starred_only === true) {
      ipcParams.starred_only = true
    }
    if (params.has_comment === true) {
      ipcParams.has_comment = true
    }
    if (params.acmg_classifications !== undefined && params.acmg_classifications.length > 0) {
      ipcParams.acmg_classifications = [...params.acmg_classifications]
    }
    if (params.column_filters !== undefined) {
      ipcParams.column_filters = { ...params.column_filters }
    }

    return ipcParams
  }

  /**
   * Execute a cohort query and return raw results without updating reactive state.
   * Use this for intermediate cursor-prefetching to avoid triggering table re-renders.
   */
  const queryVariants = async (params: CohortQueryParams): Promise<CohortQueryResult> => {
    if (!api) {
      return { data: [], total_count: 0, next_cursor: null, has_more: false }
    }

    const plainParams = globalThis.structuredClone(buildIpcParams(params))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).cohort.getVariants(plainParams)

    return {
      data: result.data ?? [],
      total_count: result.total_count ?? 0,
      next_cursor: result.next_cursor ?? null,
      has_more: result.has_more ?? false
    }
  }

  /**
   * Fetch variants and update reactive state (triggers table re-render).
   * Use queryVariants() instead for intermediate cursor-prefetching.
   */
  const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
    if (!api) {
      console.warn('API not available - running outside Electron')
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await queryVariants(params)
      variants.value = result.data
      totalCount.value = result.total_count
      nextCursor.value = result.next_cursor
      hasMore.value = result.has_more
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      variants.value = []
      totalCount.value = 0
      nextCursor.value = null
      hasMore.value = false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Fetch cohort summary statistics
   */
  const fetchSummary = async (): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      return
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).cohort.getSummary()
      summary.value = result
    } catch (err) {
      console.error('Failed to load cohort summary:', err)
    }
  }

  /**
   * Reset all state (for database context changes)
   */
  const reset = (): void => {
    variants.value = []
    totalCount.value = 0
    error.value = null
    summary.value = null
    nextCursor.value = null
    hasMore.value = false
  }

  return {
    variants,
    totalCount,
    isLoading,
    error,
    summary,
    nextCursor,
    hasMore,
    fetchVariants,
    queryVariants,
    fetchSummary,
    reset
  }
}
