/**
 * Composable for table sort state management
 *
 * Extracts sort state handling from CohortTable.vue (line 688, lines 1264-1271)
 * into a reusable composable with explicit return types.
 *
 * Provides:
 * - sortBy ref for v-data-table binding
 * - Computed accessors for current sort key/order
 * - Methods to set and clear sort state
 *
 * SOL-04: Centralized sort state management for table components.
 */

import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'

/**
 * Sort item structure matching Vuetify's v-data-table sort format
 */
export interface SortItem {
  /** Column key to sort by */
  key: string
  /** Sort direction */
  order: 'asc' | 'desc'
}

/**
 * Return type for useTableSort composable
 *
 * @property sortBy - Ref containing array of sort items (for v-data-table binding)
 * @property currentSortKey - Computed accessor for first sort key
 * @property currentSortOrder - Computed accessor for first sort order (default 'desc')
 * @property setSortBy - Method to set sort by key and order
 * @property clearSort - Method to clear all sorting
 */
export interface UseTableSortReturn {
  /** Array of sort items for v-data-table v-model:sort-by binding */
  sortBy: Ref<SortItem[]>
  /** Current sort key (first item's key, or undefined if not sorting) */
  currentSortKey: ComputedRef<string | undefined>
  /** Current sort order (first item's order, defaults to 'desc' if not sorting) */
  currentSortOrder: ComputedRef<'asc' | 'desc'>
  /** Set sort by a specific key and order */
  setSortBy: (key: string, order: 'asc' | 'desc') => void
  /** Clear all sorting */
  clearSort: () => void
}

/**
 * Composable for table sort state management
 *
 * @returns Object with sortBy ref and sort manipulation methods
 *
 * @example
 * ```typescript
 * const { sortBy, currentSortKey, setSortBy, clearSort } = useTableSort()
 *
 * // Bind to v-data-table
 * <v-data-table v-model:sort-by="sortBy" />
 *
 * // Programmatic sort
 * setSortBy('position', 'asc')
 *
 * // Check current sort
 * if (currentSortKey.value === 'position') {
 *   console.log('Sorting by position')
 * }
 *
 * // Clear sort
 * clearSort()
 * ```
 */
export function useTableSort(): UseTableSortReturn {
  // Sort state - array format for Vuetify v-data-table compatibility
  const sortBy = ref<SortItem[]>([])

  // Computed accessor for current sort key
  const currentSortKey = computed<string | undefined>(() => {
    return sortBy.value[0]?.key
  })

  // Computed accessor for current sort order (default 'desc' when not sorting)
  const currentSortOrder = computed<'asc' | 'desc'>(() => {
    return sortBy.value[0]?.order ?? 'desc'
  })

  /**
   * Set sort by key and order
   *
   * @param key - Column key to sort by
   * @param order - Sort direction ('asc' or 'desc')
   */
  const setSortBy = (key: string, order: 'asc' | 'desc'): void => {
    sortBy.value = [{ key, order }]
  }

  /**
   * Clear all sorting
   */
  const clearSort = (): void => {
    sortBy.value = []
  }

  return {
    sortBy,
    currentSortKey,
    currentSortOrder,
    setSortBy,
    clearSort
  }
}
