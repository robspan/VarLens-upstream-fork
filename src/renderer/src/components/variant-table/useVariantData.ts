import { ref, watch, type Ref } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../../shared/types/api'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAnnotations } from '../../composables/useAnnotations'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { APP_CONFIG } from '../../../../shared/config'
import { useApiService } from '../../composables/useApiService'

interface UseVariantDataOptions {
  caseId: Ref<number>
  filters: Ref<Omit<VariantFilter, 'case_id'>>
  onCountsUpdate: (counts: { filtered: number; total: number }) => void
  onSortUpdate: (hasSort: boolean) => void
}

export function useVariantData(options: UseVariantDataOptions) {
  const { caseId, filters, onCountsUpdate, onSortUpdate } = options
  const { api } = useApiService()
  const settingsStore = useSettingsStore()

  const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

  // Annotations
  const {
    loadAnnotationsBatch,
    clearCache: clearAnnotationCache,
    ...annotationMethods
  } = useAnnotations()

  // Column filters
  const columnFilterState = useColumnFilters()
  const { getColumnFiltersParam, clearAllColumnFilters } = columnFilterState

  // Table state
  const variants = ref<Variant[]>([])
  const totalCount = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const itemsPerPage = ref(settingsStore.itemsPerPage)
  const sortBy = ref<SortItem[]>([])
  const cursorCache = ref<Map<string, PaginationCursor>>(new Map())
  const unfilteredCount = ref(0)
  const selectedVariantId = ref<number | null>(null)

  // Sync items-per-page changes back to settings store
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
  })

  // Row props for zebra striping and selection highlighting
  const getRowProps = ({ item, index }: { item: Variant; index: number }) => {
    const classes: string[] = []
    if (index % 2 === 1) classes.push('variant-row--striped')
    if (item.id === selectedVariantId.value) classes.push('variant-row--selected')
    return { class: classes.join(' ') }
  }

  // Load variants from backend. Uses loading flag to skip redundant calls
  // when multiple triggers fire in rapid succession (e.g. sort change + page reset).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadVariants = async (_options?: any): Promise<void> => {
    if (!api) {
      console.warn('API not available - running outside Electron')
      return
    }

    loading.value = true
    try {
      const sortKey = sortBy.value.length > 0 ? sortBy.value[0].key : 'default'
      const sortOrder = sortBy.value.length > 0 ? sortBy.value[0].order : 'asc'

      // Deep-clone filters/sort to strip reactive proxies for IPC
      const plainFilters = JSON.parse(JSON.stringify(filters.value))
      const colFilters = getColumnFiltersParam()
      if (colFilters !== undefined) {
        plainFilters.column_filters = colFilters
      }
      const plainSortBy = JSON.parse(JSON.stringify(sortBy.value))

      // For cursor-based pagination, if the target page has no cached cursor,
      // sequentially fetch forward from the nearest cached page to build up cursors.
      // This handles "Last page" and arbitrary page jumps correctly.
      const targetPage = page.value
      if (targetPage > 1) {
        // Find the highest page <= targetPage that has a cursor (or page 1 which needs none)
        let startPage = 1
        for (let p = targetPage; p > 1; p--) {
          const key = `${p}-${sortKey}-${sortOrder}`
          if (cursorCache.value.has(key)) {
            startPage = p
            break
          }
        }

        // Fetch intermediate pages to fill cursor gaps
        for (let p = startPage; p < targetPage; p++) {
          const intermediateKey = `${p}-${sortKey}-${sortOrder}`
          // Deep-clone cursor to strip reactive proxies for IPC
          const rawCursor = p === 1 ? undefined : cursorCache.value.get(intermediateKey)
          const intermediateCursor =
            rawCursor !== undefined ? JSON.parse(JSON.stringify(rawCursor)) : undefined

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const intermediateResult: PaginatedResult<Variant> = await (api as any).variants.query(
            caseId.value,
            plainFilters,
            intermediateCursor,
            itemsPerPage.value,
            plainSortBy
          )

          if ((intermediateResult.next_cursor ?? null) !== null && intermediateResult.has_more) {
            const nextKey = `${p + 1}-${sortKey}-${sortOrder}`
            cursorCache.value.set(nextKey, intermediateResult.next_cursor!)
          }
        }
      }

      // Now fetch the target page with its cursor
      const targetKey = `${targetPage}-${sortKey}-${sortOrder}`
      const rawCursor = targetPage === 1 ? undefined : cursorCache.value.get(targetKey)
      const cursor = rawCursor !== undefined ? JSON.parse(JSON.stringify(rawCursor)) : undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: PaginatedResult<Variant> = await (api as any).variants.query(
        caseId.value,
        plainFilters,
        cursor,
        itemsPerPage.value,
        plainSortBy
      )

      variants.value = result.data
      totalCount.value = result.total_count

      onCountsUpdate({
        filtered: result.total_count,
        total: unfilteredCount.value
      })

      if ((result.next_cursor ?? null) !== null && result.has_more) {
        const nextCacheKey = `${targetPage + 1}-${sortKey}-${sortOrder}`
        cursorCache.value.set(nextCacheKey, result.next_cursor!)
      }
    } catch (error) {
      console.error('Failed to load variants:', error)
      variants.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
  }

  // Shared helper: invalidate pagination state for a fresh load
  const invalidateAndReload = async () => {
    cursorCache.value.clear()
    page.value = 1
    await loadVariants()
  }

  // Fetch unfiltered count on case change
  watch(
    caseId,
    async (newCaseId) => {
      selectedVariantId.value = null
      clearAllColumnFilters()

      if (newCaseId !== undefined && newCaseId !== 0) {
        cursorCache.value.clear()
        page.value = 1
        clearAnnotationCache()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (api as any).variants.query(newCaseId, {}, undefined, 1, [])
        unfilteredCount.value = result.total_count
      }
    },
    { immediate: true }
  )

  // Track serialized sort state to detect actual changes vs spurious triggers.
  // v-data-table-server re-emits update:sort-by (new array reference, same content)
  // on every page change. Without this guard, the deep watcher resets page to 1
  // during the nextTick coalescing window, making pagination impossible.
  let prevSortSerialized = ''

  // Clear cache and reset page when sort actually changes. The page reset triggers
  // @update:options → loadVariants, which coalesces with any concurrent call.
  watch(
    sortBy,
    () => {
      const serialized = sortBy.value.map((s) => `${s.key}:${s.order}`).join(',')
      if (serialized === prevSortSerialized) return
      prevSortSerialized = serialized
      cursorCache.value.clear()
      page.value = 1
      onSortUpdate(sortBy.value.length > 0)
    },
    { deep: true }
  )

  // Reload when filters change
  watch(filters, invalidateAndReload, { deep: true })

  // Debounced reload when per-column filters change
  const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)
  watch(getColumnFiltersParam, debouncedColumnFilterReload, { deep: true })

  // Load annotations when variants change
  watch(
    variants,
    async (newVariants) => {
      if (newVariants.length > 0 && caseId.value !== undefined && caseId.value !== 0) {
        await loadAnnotationsBatch(caseId.value, newVariants)
      }
    },
    { immediate: true }
  )

  const resetSort = () => {
    sortBy.value = []
  }

  return {
    // Table state
    variants,
    totalCount,
    loading,
    page,
    itemsPerPage,
    sortBy,
    itemsPerPageOptions,
    selectedVariantId,

    // Methods
    loadVariants,
    resetSort,
    getRowProps,

    // Column filters (pass through)
    ...columnFilterState,

    // Annotations (pass through)
    ...annotationMethods,
    loadAnnotationsBatch,
    clearAnnotationCache
  }
}
