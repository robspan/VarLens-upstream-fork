import { describe, expect, it } from 'vitest'
import { createAppState } from '../../../src/renderer/src/composables/useAppState'

describe('createAppState', () => {
  it('selects a case through an explicit shell action', () => {
    const state = createAppState()

    state.activeTab.value = 'cohort'

    state.selectCase({
      caseId: 7,
      caseName: 'Case 7',
      variantCount: 12,
      createdAt: 123
    })

    expect(state.selectedCaseId.value).toBe(7)
    expect(state.selectedCaseName.value).toBe('Case 7')
    expect(state.selectedVariantCount.value).toBe(12)
    expect(state.selectedCreatedAt.value).toBe(123)
    expect(state.activeTab.value).toBe('case')
  })

  it('clears case selection and case filters through explicit shell actions', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.hasSort.value = true

    state.clearSelectedCase()
    state.resetCaseFilters()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.currentFilters.value).toEqual({})
    expect(state.hasSort.value).toBe(false)
  })

  it('closes the sidebar through an explicit shell action', () => {
    const state = createAppState()

    state.sidebarOpen.value = true

    state.closeSidebar()

    expect(state.sidebarOpen.value).toBe(false)
  })

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

  it('resets shell-owned state for a database switch in one call', () => {
    const state = createAppState()

    state.selectedCaseId.value = 7
    state.selectedCaseName.value = 'Case 7'
    state.selectedVariantCount.value = 12
    state.selectedCreatedAt.value = 123
    state.currentFilters.value = { gene_symbol: 'BRCA1' }
    state.filteredCount.value = 5
    state.totalCount.value = 20
    state.hasSort.value = true
    state.activeTab.value = 'cohort'
    state.panelOpen.value = true
    state.selectedPanelVariant.value = { id: 'variant-1' } as never

    state.resetForDatabaseSwitch()

    expect(state.selectedCaseId.value).toBeNull()
    expect(state.selectedCaseName.value).toBe('')
    expect(state.selectedVariantCount.value).toBe(0)
    expect(state.selectedCreatedAt.value).toBe(0)
    expect(state.currentFilters.value).toEqual({})
    expect(state.filteredCount.value).toBe(0)
    expect(state.totalCount.value).toBe(0)
    expect(state.hasSort.value).toBe(false)
    expect(state.activeTab.value).toBe('case')
    expect(state.panelOpen.value).toBe(false)
    expect(state.selectedPanelVariant.value).toBeNull()
  })
})
