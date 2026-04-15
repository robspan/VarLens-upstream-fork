import { describe, expect, it } from 'vitest'
import { createAppState } from '../../../src/renderer/src/composables/useAppState'

describe('createAppState', () => {
  it('resets case-scoped shell state together', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.selectedCaseName.value = 'Case 7'
    state.selectedVariantCount.value = 12
    state.selectedCreatedAt.value = 123
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.filteredCount.value = 5
    state.totalCount.value = 20
    state.hasSort.value = true

    state.resetCaseContext()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.selectedCaseName.value).toBe('')
    expect(state.selectedVariantCount.value).toBe(0)
    expect(state.selectedCreatedAt.value).toBe(0)
    expect(state.currentFilters.value).toEqual({})
    expect(state.filteredCount.value).toBe(0)
    expect(state.totalCount.value).toBe(0)
    expect(state.hasSort.value).toBe(false)
  })
})
