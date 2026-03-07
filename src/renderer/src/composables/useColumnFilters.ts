import { ref, computed } from 'vue'

/**
 * Composable for per-column text filtering in data tables.
 * Provides reactive filter state with methods to set/clear filters.
 * Filter values are passed to the backend as column_filters in the query params.
 */
export function useColumnFilters() {
  const columnFilters = ref<Record<string, string>>({})

  const hasActiveFilters = computed(() =>
    Object.values(columnFilters.value).some((f) => f.trim() !== '')
  )

  const activeFilterCount = computed(
    () => Object.values(columnFilters.value).filter((f) => f.trim() !== '').length
  )

  function setColumnFilter(columnKey: string, value: string | null): void {
    if (value !== null && value.trim() !== '') {
      columnFilters.value = { ...columnFilters.value, [columnKey]: value }
    } else {
      const next = { ...columnFilters.value }
      delete next[columnKey]
      columnFilters.value = next
    }
  }

  function clearColumnFilter(columnKey: string): void {
    const next = { ...columnFilters.value }
    delete next[columnKey]
    columnFilters.value = next
  }

  function clearAllColumnFilters(): void {
    columnFilters.value = {}
  }

  function hasFilter(columnKey: string): boolean {
    const v = columnFilters.value[columnKey]
    return v !== undefined && v.trim() !== ''
  }

  /** Get non-empty filters as a plain object for IPC */
  function getColumnFiltersParam(): Record<string, string> | undefined {
    const entries = Object.entries(columnFilters.value).filter(([, v]) => v.trim() !== '')
    if (entries.length === 0) return undefined
    return Object.fromEntries(entries)
  }

  return {
    columnFilters,
    hasActiveFilters,
    activeFilterCount,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters,
    hasFilter,
    getColumnFiltersParam
  }
}
