/**
 * Unit tests for useGeneAutocomplete composable
 *
 * Tests gene symbol suggestion loading, short query handling,
 * API error handling, and clear functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { withSetup } from '../../utils/test-helpers'
import { useGeneAutocomplete } from '@renderer/composables/useGeneAutocomplete'
import type { WindowAPI } from '../../../src/shared/types/api'
import type { FilterState } from '../../../src/shared/types/filters'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

function makeFilters(): FilterState {
  return {
    searchQuery: '',
    geneSymbol: 'BRCA1',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    maxInternalAf: null,
    minCarriers: null,
    tagIds: [],
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    annotationScope: 'case',
    activePanelIds: [],
    panelPaddingBp: 5000,
    inheritanceModes: [],
    analysisGroupId: null,
    considerPhasing: false,
    columnFilters: {}
  }
}

function makeMockApi(geneSymbolsFn?: (...args: unknown[]) => Promise<string[]>): WindowAPI {
  return {
    variants: {
      geneSymbols: geneSymbolsFn ?? vi.fn().mockResolvedValue(['BRCA1', 'BRCA2']),
      query: vi.fn(),
      getFilterOptions: vi.fn(),
      search: vi.fn()
    }
  } as unknown as WindowAPI
}

describe('useGeneAutocomplete', () => {
  let app: { unmount: () => void }

  afterEach(() => {
    if (app) app.unmount()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty suggestions for short queries (< 2 chars)', async () => {
    const api = makeMockApi()
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    await result.searchGeneSymbols('A')

    expect(result.geneSymbolSuggestions.value).toEqual([])
    expect(api.variants.geneSymbols).not.toHaveBeenCalled()
  })

  it('returns empty suggestions for empty query', async () => {
    const api = makeMockApi()
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    await result.searchGeneSymbols('')

    expect(result.geneSymbolSuggestions.value).toEqual([])
  })

  it('calls API for valid queries (>= 2 chars)', async () => {
    const geneSymbolsFn = vi.fn().mockResolvedValue(['BRCA1', 'BRCA2'])
    const api = makeMockApi(geneSymbolsFn)
    const caseIdRef = ref(42)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    await result.searchGeneSymbols('BRC')

    expect(geneSymbolsFn).toHaveBeenCalledWith(42, 'BRC', 50)
    expect(result.geneSymbolSuggestions.value).toEqual(['BRCA1', 'BRCA2'])
  })

  it('sets loadingSuggestions during API call', async () => {
    let resolveFn: (value: string[]) => void
    const pendingPromise = new Promise<string[]>((resolve) => {
      resolveFn = resolve
    })
    const api = makeMockApi(() => pendingPromise)
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    const searchPromise = result.searchGeneSymbols('BRC')
    expect(result.loadingSuggestions.value).toBe(true)

    resolveFn!([])
    await searchPromise

    expect(result.loadingSuggestions.value).toBe(false)
  })

  it('handles API errors gracefully', async () => {
    const { logService } = await import('../../../src/renderer/src/services/LogService')
    const api = makeMockApi(() => Promise.reject(new Error('Network error')))
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    await result.searchGeneSymbols('BRC')

    expect(result.geneSymbolSuggestions.value).toEqual([])
    expect(result.loadingSuggestions.value).toBe(false)
    expect(logService.warn).toHaveBeenCalledWith(
      expect.stringContaining('Network error'),
      'filters'
    )
  })

  it('handles undefined API gracefully (throws but caught is fine)', async () => {
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() =>
      useGeneAutocomplete(undefined as unknown as WindowAPI, caseIdRef, filters)
    )
    app = appInstance

    // With undefined API, accessing api!.variants.geneSymbols will throw
    // The catch block should handle it
    await result.searchGeneSymbols('BRC')

    expect(result.geneSymbolSuggestions.value).toEqual([])
    expect(result.loadingSuggestions.value).toBe(false)
  })

  it('handleGeneClear clears gene symbol and suggestions', () => {
    const api = makeMockApi()
    const caseIdRef = ref(1)
    const filters = ref(makeFilters())

    const [result, appInstance] = withSetup(() => useGeneAutocomplete(api, caseIdRef, filters))
    app = appInstance

    // Pre-populate
    result.geneSymbolSuggestions.value = ['BRCA1', 'BRCA2']

    result.handleGeneClear()

    expect(filters.value.geneSymbol).toBe('')
    expect(result.geneSymbolSuggestions.value).toEqual([])
  })
})
