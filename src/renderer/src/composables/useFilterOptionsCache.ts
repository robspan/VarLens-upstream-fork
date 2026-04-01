/**
 * Composable for filter options caching
 *
 * Manages loading and LRU caching of filter options (consequences, funcs,
 * clinvars, numeric ranges) from the database. Extracted from useFilterState
 * for modularity.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { WindowAPI } from '../../../shared/types/api'
import type { FilterOptions } from '../../../shared/types/api'
import { LruMap } from '../../../shared/utils/lru-map'
import { logService } from '../services/LogService'

/** Maximum number of cached filter options entries */
const FILTER_OPTIONS_CACHE_MAX = 20

/**
 * Return type for useFilterOptionsCache composable
 */
export interface UseFilterOptionsCacheReturn {
  /** Current filter options loaded from the database */
  filterOptions: Ref<FilterOptions>
  /** Load filter options for a case (uses LRU cache) */
  loadFilterOptions: (caseId: number) => Promise<void>
  /** Load filter options and tags in parallel (for initial mount) */
  loadFilterOptionsAndTags: (caseId: number, loadTags: () => Promise<void>) => Promise<void>
  /** Clear the filter options cache (call after import/delete) */
  invalidateFilterOptionsCache: () => void
}

/**
 * Composable for filter options loading with LRU caching
 *
 * @param api - Window API instance (undefined in browser dev mode)
 * @returns Filter options state and cache management methods
 */
export function useFilterOptionsCache(api: WindowAPI | undefined): UseFilterOptionsCacheReturn {
  const filterOptions = ref<FilterOptions>({
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    minCadd: null as number | null,
    maxCadd: null as number | null,
    minGnomadAf: null as number | null,
    maxGnomadAf: null as number | null,
    columnMeta: []
  })

  // LRU cache for filter options per case
  const filterOptionsCache = new LruMap<number, FilterOptions>(FILTER_OPTIONS_CACHE_MAX)

  /**
   * Store options in the LRU cache (LruMap handles promotion and eviction)
   */
  const cacheFilterOptions = (caseId: number, options: FilterOptions): void => {
    filterOptionsCache.set(caseId, options)
  }

  /**
   * Load filter options for a given case from the database (with LRU cache)
   */
  const loadFilterOptions = async (caseId: number): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      return
    }

    // Check cache first
    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      filterOptions.value = cached
      return
    }

    try {
      const options = await api!.variants.getFilterOptions(caseId)
      filterOptions.value = options
      cacheFilterOptions(caseId, options)
    } catch (error) {
      logService.error(
        'Failed to load filter options: ' +
          (error instanceof Error ? error.message : String(error)),
        'filters'
      )
    }
  }

  /**
   * Load filter options and tags in parallel.
   * Called from the component's onMounted.
   */
  const loadFilterOptionsAndTags = async (
    caseId: number,
    loadTags: () => Promise<void>
  ): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      logService.warn('API not available - running outside Electron', 'filters')
      return
    }

    // Check cache first for filter options
    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      // Options are cached — only need to load tags
      filterOptions.value = cached
      await loadTags()
      return
    }

    try {
      // Load filter options and tags in parallel
      const [options] = await Promise.all([api!.variants.getFilterOptions(caseId), loadTags()])
      filterOptions.value = options
      cacheFilterOptions(caseId, options)
    } catch (error) {
      logService.error(
        'Failed to load filter options: ' +
          (error instanceof Error ? error.message : String(error)),
        'filters'
      )
    }
  }

  /**
   * Invalidate the filter options cache (call after import/delete)
   */
  const invalidateFilterOptionsCache = (): void => {
    filterOptionsCache.clear()
  }

  return {
    filterOptions,
    loadFilterOptions,
    loadFilterOptionsAndTags,
    invalidateFilterOptionsCache
  }
}
