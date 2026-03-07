import { describe, it, expect } from 'vitest'
import { useColumnFilters } from '../../../src/renderer/src/composables/useColumnFilters'

describe('useColumnFilters', () => {
  it('starts with no active filters', () => {
    const { hasActiveFilters, activeFilterCount, getColumnFiltersParam } = useColumnFilters()
    expect(hasActiveFilters.value).toBe(false)
    expect(activeFilterCount.value).toBe(0)
    expect(getColumnFiltersParam()).toBeUndefined()
  })

  it('setColumnFilter adds a filter', () => {
    const { setColumnFilter, hasFilter, hasActiveFilters, activeFilterCount, columnFilters } =
      useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    expect(hasFilter('gene_symbol')).toBe(true)
    expect(hasActiveFilters.value).toBe(true)
    expect(activeFilterCount.value).toBe(1)
    expect(columnFilters.value.gene_symbol).toBe('BRCA')
  })

  it('setColumnFilter with null or empty string removes the filter', () => {
    const { setColumnFilter, hasFilter, hasActiveFilters } = useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    expect(hasFilter('gene_symbol')).toBe(true)

    setColumnFilter('gene_symbol', null)
    expect(hasFilter('gene_symbol')).toBe(false)
    expect(hasActiveFilters.value).toBe(false)
  })

  it('setColumnFilter with whitespace-only removes the filter', () => {
    const { setColumnFilter, hasFilter } = useColumnFilters()

    setColumnFilter('chr', '  ')
    expect(hasFilter('chr')).toBe(false)
  })

  it('clearColumnFilter removes a specific filter', () => {
    const { setColumnFilter, clearColumnFilter, hasFilter, activeFilterCount } = useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    setColumnFilter('chr', '1')
    expect(activeFilterCount.value).toBe(2)

    clearColumnFilter('gene_symbol')
    expect(hasFilter('gene_symbol')).toBe(false)
    expect(hasFilter('chr')).toBe(true)
    expect(activeFilterCount.value).toBe(1)
  })

  it('clearAllColumnFilters removes all filters', () => {
    const { setColumnFilter, clearAllColumnFilters, hasActiveFilters, activeFilterCount } =
      useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    setColumnFilter('chr', '1')
    setColumnFilter('clinvar', 'Pathogenic')
    expect(activeFilterCount.value).toBe(3)

    clearAllColumnFilters()
    expect(hasActiveFilters.value).toBe(false)
    expect(activeFilterCount.value).toBe(0)
  })

  it('getColumnFiltersParam returns undefined when no active filters', () => {
    const { getColumnFiltersParam } = useColumnFilters()
    expect(getColumnFiltersParam()).toBeUndefined()
  })

  it('getColumnFiltersParam returns only non-empty filters', () => {
    const { setColumnFilter, getColumnFiltersParam, columnFilters } = useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    setColumnFilter('chr', '1')
    // Manually set an empty value to test filtering
    columnFilters.value = { ...columnFilters.value, empty_col: '' }

    const result = getColumnFiltersParam()
    expect(result).toEqual({ gene_symbol: 'BRCA', chr: '1' })
    expect(result).not.toHaveProperty('empty_col')
  })

  it('hasFilter returns false for unknown columns', () => {
    const { hasFilter } = useColumnFilters()
    expect(hasFilter('nonexistent')).toBe(false)
  })

  it('multiple setColumnFilter calls update correctly', () => {
    const { setColumnFilter, columnFilters } = useColumnFilters()

    setColumnFilter('gene_symbol', 'BRCA')
    setColumnFilter('gene_symbol', 'TP53')
    expect(columnFilters.value.gene_symbol).toBe('TP53')
  })
})
