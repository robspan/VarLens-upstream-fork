/**
 * Shared composable for cursor-based (keyset) pagination with v-data-table-server.
 *
 * Extracts the cursor caching, gap-filling, and sort-change handling logic
 * that was previously duplicated in useVariantData.ts and CohortTable.vue.
 *
 * Usage: bind the returned `page`, `itemsPerPage`, `sortBy` refs via v-model
 * to v-data-table-server, and use `loadPage` as the @update:options handler.
 * Call `invalidateAndReload()` when filters change.
 *
 * DRY: Both case (VariantTable) and cohort (CohortTable) views use this composable.
 */

import { ref, watch, type Ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { APP_CONFIG } from '../../../shared/config'

export interface SortItem {
  key: string
  order: boolean | 'asc' | 'desc'
}

/** Normalized sort item with strict 'asc'/'desc' order (IPC-safe). */
export interface NormalizedSortItem {
  key: string
  order: 'asc' | 'desc'
}

/** Normalize Vuetify's boolean sort orders to 'asc'/'desc' for IPC safety. */
const normalizeOrder = (order: SortItem['order']): 'asc' | 'desc' => {
  if (order === 'desc' || order === false) return 'desc'
  return 'asc'
}

const normalizeSortBy = (items: SortItem[]): NormalizedSortItem[] =>
  items.map(({ key, order }) => ({ key, order: normalizeOrder(order) }))

export interface CursorPageResult<T> {
  data: T[]
  total_count: number
  next_cursor: unknown | null
  has_more: boolean
}

export interface UseCursorPaginationOptions<T> {
  /** Fetch a single page. sortBy is already normalized to 'asc'/'desc' (IPC-safe). */
  fetchPage: (params: {
    cursor: unknown | undefined
    limit: number
    sortBy: NormalizedSortItem[]
  }) => Promise<CursorPageResult<T>>
  /** Called when sort state changes (e.g. to update "has sort" indicator) */
  onSortChange?: (hasSort: boolean) => void
}

export function useCursorPagination<T>(options: UseCursorPaginationOptions<T>) {
  const settingsStore = useSettingsStore()

  // Table state — bind to v-data-table-server via v-model
  const page = ref(1)
  const itemsPerPage = ref(settingsStore.itemsPerPage)
  const sortBy = ref<SortItem[]>([])
  const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

  // Result state
  const items = ref<T[]>([]) as Ref<T[]>
  const totalCount = ref(0)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // Cursor cache: "pageNum-sortKey-sortOrder" -> cursor
  const cursorCache = ref<Map<string, unknown>>(new Map())

  // Sort change detection (prevents spurious reloads on reference changes)
  let prevSortSerialized = ''

  // Sync items-per-page to settings store
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
  })

  const getCacheKey = (pageNum: number): string => {
    const normalized = normalizeSortBy(sortBy.value)
    const sortKey = normalized.length > 0 ? normalized[0].key : 'default'
    const sortOrder = normalized.length > 0 ? normalized[0].order : 'asc'
    return `${pageNum}-${sortKey}-${sortOrder}`
  }

  const deepClone = <V>(value: V): V => JSON.parse(JSON.stringify(value))

  /**
   * Load the current page. Use as @update:options handler.
   * Reads page/sortBy/itemsPerPage from reactive refs (set by Vuetify v-model).
   */
  const loadPage = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const targetPage = page.value
      const plainSortBy = normalizeSortBy(sortBy.value)

      // Fill cursor gaps for page jumps (e.g. "Last page" button)
      if (targetPage > 1) {
        let startPage = 1
        for (let p = targetPage; p > 1; p--) {
          if (cursorCache.value.has(getCacheKey(p))) {
            startPage = p
            break
          }
        }

        for (let p = startPage; p < targetPage; p++) {
          const key = getCacheKey(p)
          const rawCursor = p === 1 ? undefined : cursorCache.value.get(key)
          const cursor = rawCursor !== undefined ? deepClone(rawCursor) : undefined

          const result = await options.fetchPage({
            cursor,
            limit: itemsPerPage.value,
            sortBy: plainSortBy
          })

          if (result.next_cursor !== null && result.has_more) {
            cursorCache.value.set(getCacheKey(p + 1), result.next_cursor)
          } else {
            // No more data — can't reach target page
            break
          }
        }
      }

      // Fetch the target page
      const targetKey = getCacheKey(targetPage)
      const rawCursor = targetPage === 1 ? undefined : cursorCache.value.get(targetKey)
      const cursor = rawCursor !== undefined ? deepClone(rawCursor) : undefined

      const result = await options.fetchPage({
        cursor,
        limit: itemsPerPage.value,
        sortBy: plainSortBy
      })

      items.value = result.data
      totalCount.value = result.total_count

      // Cache cursor for next page
      if (result.next_cursor !== null && result.has_more) {
        cursorCache.value.set(getCacheKey(targetPage + 1), result.next_cursor)
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      items.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear cursor cache, reset to page 1, and reload.
   * Use when filters change or data needs a full refresh.
   */
  const invalidateAndReload = async (): Promise<void> => {
    cursorCache.value.clear()
    page.value = 1
    await loadPage()
  }

  // Watch sort changes — clear cache and reset page.
  // The page reset triggers Vuetify to re-emit @update:options → loadPage.
  watch(
    sortBy,
    () => {
      const serialized = normalizeSortBy(sortBy.value)
        .map((s) => `${s.key}:${s.order}`)
        .join(',')
      if (serialized === prevSortSerialized) return
      prevSortSerialized = serialized
      cursorCache.value.clear()
      page.value = 1
      options.onSortChange?.(sortBy.value.length > 0)
    },
    { deep: true }
  )

  const resetSort = (): void => {
    sortBy.value = []
  }

  const resetState = (): void => {
    items.value = []
    totalCount.value = 0
    error.value = null
    cursorCache.value.clear()
    page.value = 1
    sortBy.value = []
    prevSortSerialized = ''
  }

  return {
    // Table state (v-model bindings for v-data-table-server)
    page,
    itemsPerPage,
    sortBy,
    itemsPerPageOptions,

    // Result state
    items,
    totalCount,
    loading,
    error,

    // Methods
    loadPage,
    invalidateAndReload,
    resetSort,
    resetState
  }
}
