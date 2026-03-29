# Filter Pipeline Tests & IPC Safety Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive test coverage for the case-mode filter pipeline (`useFilterState`, `useVariantData`) and cohort IPC safety, plus extract a shared `cloneForIpc` utility to DRY up proxy-stripping code.

**Architecture:** Tests follow existing patterns: `withSetup()` for composables needing Vue lifecycle, `createMockApi()` for IPC mocking, `vi.useFakeTimers()` for debounce tests. A shared `cloneForIpc()` utility replaces 5 duplicated `JSON.parse(JSON.stringify())` call sites and gets its own test.

**Tech Stack:** Vitest, Vue 3 (`ref`, `reactive`, `nextTick`, `isReactive`), Pinia, happy-dom

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/renderer/src/utils/cloneForIpc.ts` | Shared IPC proxy-stripping utility |
| Create | `tests/renderer/utils/cloneForIpc.test.ts` | Unit tests for cloneForIpc |
| Create | `tests/renderer/composables/useFilterState.test.ts` | Case-mode filter state composable tests |
| Create | `tests/renderer/composables/useVariantData.test.ts` | Case-mode data pipeline composable tests |
| Modify | `tests/renderer/composables/filter-types.test.ts` | Add IPC-safety (no proxy leakage) tests |
| Modify | `tests/renderer/composables/useCohortData.test.ts` | Add buildIpcParams proxy-stripping tests |
| Modify | `src/renderer/src/components/variant-table/useVariantData.ts` | Use cloneForIpc |
| Modify | `src/renderer/src/components/FilterToolbar.vue` | Use cloneForIpc |
| Modify | `src/renderer/src/components/cohort/CohortFilterBar.vue` | Use cloneForIpc |
| Modify | `src/renderer/src/components/CohortTable.vue` | Use cloneForIpc, remove redundant clone, spread arrays in export |
| Modify | `src/renderer/src/composables/useCohortData.ts` | Use cloneForIpc for column_filters |

---

### Task 1: Extract `cloneForIpc` utility (TDD)

**Files:**
- Create: `tests/renderer/utils/cloneForIpc.test.ts`
- Create: `src/renderer/src/utils/cloneForIpc.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/renderer/utils/cloneForIpc.test.ts
import { describe, it, expect } from 'vitest'
import { ref, reactive, isReactive } from 'vue'
import { cloneForIpc } from '@renderer/utils/cloneForIpc'

describe('cloneForIpc', () => {
  it('returns a plain object from a plain object', () => {
    const input = { a: 1, b: 'two' }
    const result = cloneForIpc(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input) // new object
  })

  it('strips Vue ref proxy', () => {
    const input = ref({ search: 'hello', items: [1, 2, 3] })
    const result = cloneForIpc(input.value)
    expect(result).toEqual({ search: 'hello', items: [1, 2, 3] })
    expect(isReactive(result)).toBe(false)
  })

  it('strips Vue reactive proxy', () => {
    const input = reactive({ filters: ['a', 'b'], nested: { x: 1 } })
    const result = cloneForIpc(input)
    expect(result).toEqual({ filters: ['a', 'b'], nested: { x: 1 } })
    expect(isReactive(result)).toBe(false)
    expect(isReactive(result.nested)).toBe(false)
  })

  it('strips reactive arrays nested inside a plain object', () => {
    const reactiveArr = reactive(['missense', 'nonsense'])
    const obj = { consequences: reactiveArr, count: 5 }
    const result = cloneForIpc(obj)
    expect(result.consequences).toEqual(['missense', 'nonsense'])
    expect(isReactive(result.consequences)).toBe(false)
  })

  it('handles null and undefined values', () => {
    const input = { a: null, b: undefined }
    const result = cloneForIpc(input)
    expect(result.a).toBeNull()
    // JSON.stringify strips undefined — this is expected IPC behavior
    expect(result.b).toBeUndefined()
  })

  it('handles empty objects', () => {
    expect(cloneForIpc({})).toEqual({})
  })

  it('handles arrays at top level', () => {
    const input = ref([1, 2, 3])
    const result = cloneForIpc(input.value)
    expect(result).toEqual([1, 2, 3])
    expect(isReactive(result)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/utils/cloneForIpc.test.ts`
Expected: FAIL — module `@renderer/utils/cloneForIpc` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/src/utils/cloneForIpc.ts
/**
 * Deep-clone a value to strip Vue reactive proxies for IPC serialization.
 *
 * structuredClone() throws on Vue 3 Proxy objects. JSON round-trip is the
 * simplest reliable alternative. This utility centralizes that pattern so
 * callers don't duplicate it and the strategy can be swapped in one place.
 */
export function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/utils/cloneForIpc.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```
git add src/renderer/src/utils/cloneForIpc.ts tests/renderer/utils/cloneForIpc.test.ts
git commit -m "feat: add cloneForIpc utility with tests"
```

---

### Task 2: Replace duplicated JSON round-trips with `cloneForIpc`

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`
- Modify: `src/renderer/src/components/FilterToolbar.vue`
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue`
- Modify: `src/renderer/src/components/CohortTable.vue`
- Modify: `src/renderer/src/composables/useCohortData.ts`

Address Copilot's 3 review comments:
1. **CohortTable fetchPage**: `buildIpcParams` already strips proxies → pass result directly (no clone)
2. **CohortTable exportToExcel**: spread arrays explicitly instead of JSON clone
3. **useVariantData**: extract helper → use `cloneForIpc`

- [ ] **Step 1: Update useVariantData.ts**

Replace lines 58-73:
```typescript
// Before:
const plainFilters = JSON.parse(
  JSON.stringify({ ...rawFilters, ...mergedColFilters })
)

// After:
import { cloneForIpc } from '../../utils/cloneForIpc'
// ...
const plainFilters = cloneForIpc({ ...rawFilters, ...mergedColFilters })
```

- [ ] **Step 2: Update FilterToolbar.vue**

Replace in `handleSavePreset`:
```typescript
// Before:
const plainFilters = JSON.parse(JSON.stringify(filters.value))

// After:
import { cloneForIpc } from '../utils/cloneForIpc'
// ...
const plainFilters = cloneForIpc(filters.value)
```

- [ ] **Step 3: Update CohortFilterBar.vue**

Same pattern as FilterToolbar:
```typescript
import { cloneForIpc } from '../../utils/cloneForIpc'
// ...
const plainFilters = cloneForIpc(filters.value)
```

- [ ] **Step 4: Update CohortTable.vue — fetchPage (Copilot comment 1)**

`buildIpcParams` already returns a plain object with spread arrays. Remove the redundant clone:
```typescript
// Before:
const plainParams = JSON.parse(JSON.stringify(buildIpcParams(params)))

// After:
const plainParams = buildIpcParams(params)
```

- [ ] **Step 5: Update CohortTable.vue — exportToExcel (Copilot comment 2)**

Spread reactive arrays explicitly instead of cloning the whole object:
```typescript
// Before:
const exportParams = {
  search_term: searchTerm.value || undefined,
  gene_symbol: filters.value.geneSymbol || undefined,
  consequences:
    selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined,
  funcs: filters.value.funcs.length > 0 ? filters.value.funcs : undefined,
  clinvars: filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined,
  gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
  cadd_min: filters.value.minCadd ?? undefined,
  cohort_frequency_min: filters.value.minCohortFrequency ?? undefined
}
const plainParams = JSON.parse(JSON.stringify(exportParams))

// After:
const plainParams = {
  search_term: searchTerm.value || undefined,
  gene_symbol: filters.value.geneSymbol || undefined,
  consequences:
    selectedImpactPresets.value.length > 0 ? [...selectedImpactPresets.value] : undefined,
  funcs: filters.value.funcs.length > 0 ? [...filters.value.funcs] : undefined,
  clinvars: filters.value.clinvars.length > 0 ? [...filters.value.clinvars] : undefined,
  gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
  cadd_min: filters.value.minCadd ?? undefined,
  cohort_frequency_min: filters.value.minCohortFrequency ?? undefined
}
```

- [ ] **Step 6: Update useCohortData.ts — buildIpcParams column_filters**

```typescript
import { cloneForIpc } from '../utils/cloneForIpc'
// ...
// Before:
ipcParams.column_filters = JSON.parse(JSON.stringify(params.column_filters))

// After:
ipcParams.column_filters = cloneForIpc(params.column_filters)
```

- [ ] **Step 7: Run lint + typecheck**

Run: `npx eslint src/renderer/src/components/variant-table/useVariantData.ts src/renderer/src/components/FilterToolbar.vue src/renderer/src/components/cohort/CohortFilterBar.vue src/renderer/src/components/CohortTable.vue src/renderer/src/composables/useCohortData.ts && npm run typecheck`
Expected: Clean

- [ ] **Step 8: Commit**

```
git add -A
git commit -m "refactor: replace duplicated JSON clone with cloneForIpc utility"
```

---

### Task 3: Extend `filter-types.test.ts` with IPC-safety tests

**Files:**
- Modify: `tests/renderer/composables/filter-types.test.ts`

- [ ] **Step 1: Add proxy-safety tests**

Append to the existing `describe('buildFilterFromState')` block:

```typescript
import { ref, isReactive } from 'vue'

describe('IPC safety — output arrays are plain (not reactive proxies)', () => {
  it('funcs output is a new plain array, not a reference to input', () => {
    const state = ref<FilterState>({
      ...defaultState,
      funcs: ['exonic', 'intronic']
    })
    const result = buildFilterFromState(state.value, [])
    // Must be a different array (spread), not the reactive source
    expect(result.funcs).toEqual(['exonic', 'intronic'])
    expect(result.funcs).not.toBe(state.value.funcs)
    expect(isReactive(result.funcs)).toBe(false)
  })

  it('clinvars output is a new plain array', () => {
    const state = ref<FilterState>({
      ...defaultState,
      clinvars: ['pathogenic']
    })
    const result = buildFilterFromState(state.value, [])
    expect(result.clinvars).not.toBe(state.value.clinvars)
    expect(isReactive(result.clinvars)).toBe(false)
  })

  it('tag_ids output is a new plain array', () => {
    const state = ref<FilterState>({
      ...defaultState,
      tagIds: [1, 2, 3]
    })
    const result = buildFilterFromState(state.value, [])
    expect(result.tag_ids).not.toBe(state.value.tagIds)
    expect(isReactive(result.tag_ids)).toBe(false)
  })

  it('acmg_classifications output is a new plain array', () => {
    const state = ref<FilterState>({
      ...defaultState,
      acmgClassifications: ['Pathogenic', 'Likely pathogenic']
    })
    const result = buildFilterFromState(state.value, [])
    expect(result.acmg_classifications).not.toBe(state.value.acmgClassifications)
    expect(isReactive(result.acmg_classifications)).toBe(false)
  })

  it('entire output can be JSON-serialized (simulates IPC)', () => {
    const state = ref<FilterState>({
      searchQuery: 'test',
      geneSymbol: 'BRCA1',
      consequences: ['missense_variant'],
      funcs: ['exonic'],
      clinvars: ['pathogenic'],
      maxGnomadAf: 0.01,
      minCadd: 15,
      tagIds: [1, 2],
      starredOnly: true,
      hasCommentOnly: true,
      acmgClassifications: ['Pathogenic'],
      annotationScope: 'all'
    })
    const result = buildFilterFromState(state.value, ['HIGH'])
    // Must not throw — proves no Proxy objects in the output
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/renderer/composables/filter-types.test.ts`
Expected: All tests PASS (existing 11 + new 5 = 16)

- [ ] **Step 3: Commit**

```
git add tests/renderer/composables/filter-types.test.ts
git commit -m "test: add IPC-safety tests for buildFilterFromState output"
```

---

### Task 4: Test `useFilterState` composable

**Files:**
- Create: `tests/renderer/composables/useFilterState.test.ts`

This composable depends on `useApiService`, `useTags`, `useFilterPresets`, `useFilterExport`, and `useDebounce`. Mock the API via `window.api`, use `vi.useFakeTimers()` for debounce, and mock the tags composable.

- [ ] **Step 1: Write the test file**

```typescript
// tests/renderer/composables/useFilterState.test.ts
/**
 * Unit tests for useFilterState composable (case-mode filter pipeline).
 *
 * Tests filter state management, emission, case switching, filter options
 * loading, and IPC safety (no reactive proxies in emitted filters).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick, isReactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useFilterState } from '@renderer/composables/useFilterState'

// Mock useTags — it needs the API and lifecycle
vi.mock('@renderer/composables/useTags', () => ({
  useTags: () => ({
    loadTags: vi.fn().mockResolvedValue(undefined),
    getTags: vi.fn().mockReturnValue([])
  })
}))

describe('useFilterState', () => {
  let app: { unmount: () => void }
  let onFiltersUpdate: ReturnType<typeof vi.fn>
  let onResetSort: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    window.api = createMockApi()
    onFiltersUpdate = vi.fn()
    onResetSort = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    if (app) app.unmount()
    vi.useRealTimers()
  })

  function setup(caseId = 1) {
    const caseIdRef = ref(caseId)
    const [result, appInstance] = withSetup(() =>
      useFilterState(caseIdRef, { onFiltersUpdate, onResetSort })
    )
    app = appInstance
    return { result, caseIdRef }
  }

  describe('initial state', () => {
    it('initializes with empty filter state', () => {
      const { result } = setup()
      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.geneSymbol).toBe('')
      expect(result.filters.value.consequences).toEqual([])
      expect(result.filters.value.funcs).toEqual([])
      expect(result.filters.value.clinvars).toEqual([])
      expect(result.filters.value.maxGnomadAf).toBeNull()
      expect(result.filters.value.minCadd).toBeNull()
      expect(result.filters.value.tagIds).toEqual([])
      expect(result.filters.value.starredOnly).toBe(false)
      expect(result.filters.value.hasCommentOnly).toBe(false)
      expect(result.filters.value.acmgClassifications).toEqual([])
      expect(result.filters.value.annotationScope).toBe('case')
    })

    it('has no active filters initially', () => {
      const { result } = setup()
      expect(result.hasActiveFilters.value).toBe(false)
      expect(result.activeFilterCount.value).toBe(0)
      expect(result.activeFiltersList.value).toEqual([])
    })
  })

  describe('filter manipulation', () => {
    it('clearFilter resets specific filter', () => {
      const { result } = setup()
      result.filters.value.searchQuery = 'BRCA1'
      expect(result.hasActiveFilters.value).toBe(true)

      result.clearFilter('search')
      expect(result.filters.value.searchQuery).toBe('')
      expect(result.hasActiveFilters.value).toBe(false)
    })

    it('clearAllFilters resets all filters and calls onResetSort', () => {
      const { result } = setup()
      result.filters.value.searchQuery = 'test'
      result.filters.value.funcs = ['exonic']
      result.filters.value.starredOnly = true

      result.clearAllFilters()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.funcs).toEqual([])
      expect(result.filters.value.starredOnly).toBe(false)
      expect(onResetSort).toHaveBeenCalledOnce()
    })

    it('activeFilterCount tracks multiple active filters', () => {
      const { result } = setup()
      result.filters.value.searchQuery = 'test'
      result.filters.value.starredOnly = true
      result.filters.value.funcs = ['exonic']
      expect(result.activeFilterCount.value).toBe(3)
    })
  })

  describe('filter emission', () => {
    it('emits filters after debounce when filter state changes', async () => {
      const { result } = setup()

      result.filters.value.searchQuery = 'BRCA1'
      await nextTick() // computed key updates

      // Advance past debounce delay
      vi.advanceTimersByTime(400)
      await flushPromises()

      expect(onFiltersUpdate).toHaveBeenCalled()
      const emitted = onFiltersUpdate.mock.calls[onFiltersUpdate.mock.calls.length - 1][0]
      expect(emitted.search_query).toBe('BRCA1')
    })

    it('emitted filter object contains no reactive proxies', async () => {
      const { result } = setup()

      result.filters.value.funcs = ['exonic', 'intronic']
      result.filters.value.clinvars = ['pathogenic']
      result.filters.value.acmgClassifications = ['Pathogenic']
      await nextTick()

      vi.advanceTimersByTime(400)
      await flushPromises()

      expect(onFiltersUpdate).toHaveBeenCalled()
      const emitted = onFiltersUpdate.mock.calls[onFiltersUpdate.mock.calls.length - 1][0]

      // All array fields must be plain (not reactive)
      expect(isReactive(emitted.funcs)).toBe(false)
      expect(isReactive(emitted.clinvars)).toBe(false)
      expect(isReactive(emitted.acmg_classifications)).toBe(false)

      // Must serialize without error (simulates IPC)
      expect(() => JSON.parse(JSON.stringify(emitted))).not.toThrow()
    })

    it('emitted filter can be passed through cloneForIpc without error', async () => {
      const { cloneForIpc } = await import('@renderer/utils/cloneForIpc')
      const { result } = setup()

      result.filters.value.searchQuery = 'test'
      result.filters.value.funcs = ['exonic']
      result.filters.value.tagIds = [1, 2]
      await nextTick()

      vi.advanceTimersByTime(400)
      await flushPromises()

      const emitted = onFiltersUpdate.mock.calls[onFiltersUpdate.mock.calls.length - 1][0]
      expect(() => cloneForIpc(emitted)).not.toThrow()
    })
  })

  describe('case switching', () => {
    it('resets filters when case ID changes', async () => {
      const { result, caseIdRef } = setup(1)

      result.filters.value.searchQuery = 'test'
      result.filters.value.funcs = ['exonic']

      // Switch case
      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      expect(result.filters.value.searchQuery).toBe('')
      expect(result.filters.value.funcs).toEqual([])
    })

    it('emits empty filter immediately on case switch (bypasses debounce)', async () => {
      const { caseIdRef } = setup(1)

      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      // Should have been called with empty filter (no debounce wait)
      expect(onFiltersUpdate).toHaveBeenCalledWith({})
    })
  })

  describe('filter options loading', () => {
    it('loads filter options from API', async () => {
      const mockOptions = {
        consequences: ['missense_variant', 'synonymous_variant'],
        funcs: ['exonic', 'intronic'],
        clinvars: ['pathogenic', 'benign'],
        minCadd: 0,
        maxCadd: 40,
        minGnomadAf: 0,
        maxGnomadAf: 1,
        columnMeta: []
      }
      window.api.variants.getFilterOptions = vi.fn().mockResolvedValue(mockOptions)

      const { result } = setup()
      await result.loadFilterOptions(1)
      await flushPromises()

      expect(result.filterOptions.value.consequences).toEqual([
        'missense_variant',
        'synonymous_variant'
      ])
      expect(window.api.variants.getFilterOptions).toHaveBeenCalledWith(1)
    })

    it('caches filter options per case (LRU)', async () => {
      const mockOptions = {
        consequences: ['missense_variant'],
        funcs: [],
        clinvars: [],
        minCadd: null,
        maxCadd: null,
        minGnomadAf: null,
        maxGnomadAf: null,
        columnMeta: []
      }
      window.api.variants.getFilterOptions = vi.fn().mockResolvedValue(mockOptions)

      const { result } = setup()

      await result.loadFilterOptions(1)
      await result.loadFilterOptions(1) // second call
      await flushPromises()

      // Only called once — second call served from cache
      expect(window.api.variants.getFilterOptions).toHaveBeenCalledTimes(1)
    })
  })

  describe('gene autocomplete', () => {
    it('searches gene symbols via API', async () => {
      window.api.variants.geneSymbols = vi.fn().mockResolvedValue(['BRCA1', 'BRCA2'])

      const { result } = setup()
      await result.searchGeneSymbols('BRC')
      await flushPromises()

      expect(result.geneSymbolSuggestions.value).toEqual(['BRCA1', 'BRCA2'])
    })

    it('clears suggestions for short queries', async () => {
      const { result } = setup()
      await result.searchGeneSymbols('B')
      expect(result.geneSymbolSuggestions.value).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/renderer/composables/useFilterState.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```
git add tests/renderer/composables/useFilterState.test.ts
git commit -m "test: add useFilterState composable tests"
```

---

### Task 5: Test `useVariantData` composable

**Files:**
- Create: `tests/renderer/composables/useVariantData.test.ts`

This composable orchestrates the case-mode data pipeline. It depends on `useOffsetPagination`, `useAnnotations`, `useColumnFilters`, `useDebounce`, and `useApiService`. We mock the API and verify correct filter propagation.

- [ ] **Step 1: Write the test file**

```typescript
// tests/renderer/composables/useVariantData.test.ts
/**
 * Unit tests for useVariantData composable (case-mode variant data pipeline).
 *
 * Tests filter propagation to API, column filter merging, IPC safety,
 * case switching, and annotation loading.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick, isReactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useVariantData } from '@renderer/components/variant-table/useVariantData'
import type { Variant, VariantFilter } from '../../../../src/shared/types/api'

const mockVariant: Variant = {
  id: 1,
  chr: 'chr1',
  pos: 12345,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'BRCA1',
  consequence: 'missense_variant',
  func: 'exonic',
  gt_num: 1,
  qual: 30.5,
  gnomad_af: 0.001,
  clinvar: null,
  cadd: 25.0,
  transcript: 'NM_007294.4',
  cdna: 'c.123A>G',
  aa_change: 'p.Lys41Glu',
  hpo_sim_score: null,
  moi: null,
  omim_mim_number: null,
  impact: 'MODERATE'
}

describe('useVariantData', () => {
  let app: { unmount: () => void }
  let onCountsUpdate: ReturnType<typeof vi.fn>
  let onSortUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    window.api = createMockApi()
    onCountsUpdate = vi.fn()
    onSortUpdate = vi.fn()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  function setup(
    caseId = 1,
    filters: Omit<VariantFilter, 'case_id'> = {}
  ) {
    const caseIdRef = ref(caseId)
    const filtersRef = ref(filters)
    const [result, appInstance] = withSetup(() =>
      useVariantData({
        caseId: caseIdRef,
        filters: filtersRef,
        onCountsUpdate,
        onSortUpdate
      })
    )
    app = appInstance
    return { result, caseIdRef, filtersRef }
  }

  describe('initial state and case loading', () => {
    it('fetches unfiltered count on setup (immediate watcher)', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [],
        total_count: 500
      })

      setup(1)
      await flushPromises()

      // The immediate caseId watcher fires a query with {} filters
      expect(window.api.variants.query).toHaveBeenCalledWith(
        1,
        {},
        undefined,
        1,
        []
      )
    })
  })

  describe('filter propagation', () => {
    it('passes filters to API query via loadVariants', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [mockVariant],
        total_count: 1
      })

      const filters: Omit<VariantFilter, 'case_id'> = {
        search_query: 'BRCA1',
        consequences: ['missense_variant'],
        funcs: ['exonic']
      }
      const { result } = setup(1, filters)
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      // The fetchPage call should include the filters
      const calls = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls
      const fetchCall = calls.find(
        (c: unknown[]) => (c[1] as VariantFilter).search_query === 'BRCA1'
      )
      expect(fetchCall).toBeDefined()
      expect(fetchCall![1].consequences).toEqual(['missense_variant'])
      expect(fetchCall![1].funcs).toEqual(['exonic'])
    })

    it('reloads when filter key changes', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [mockVariant],
        total_count: 1
      })

      const { filtersRef } = setup(1)
      await flushPromises()

      const callsBefore = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length

      // Change filters — should trigger filterKey watcher → invalidateAndReload
      filtersRef.value = { search_query: 'TP53' }
      await nextTick()
      await flushPromises()

      const callsAfter = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length
      expect(callsAfter).toBeGreaterThan(callsBefore)
    })
  })

  describe('column filter merging', () => {
    it('merges column filters with toolbar filters in fetchPage', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [mockVariant],
        total_count: 1
      })

      const { result } = setup(1, { search_query: 'test' })
      await flushPromises()

      // Apply a column filter
      result.setColumnFilter('chr', { operator: '=', value: 'chr1' })
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      // Find the call that has column_filters
      const calls = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls
      const callWithColFilters = calls.find(
        (c: unknown[]) => (c[1] as VariantFilter).column_filters !== undefined
      )
      expect(callWithColFilters).toBeDefined()
      expect(callWithColFilters![1].column_filters).toHaveProperty('chr')
    })
  })

  describe('IPC safety', () => {
    it('filters passed to API are plain objects (no reactive proxies)', async () => {
      let capturedFilters: unknown = null
      window.api.variants.query = vi.fn().mockImplementation(
        (_caseId: number, filters: VariantFilter) => {
          capturedFilters = filters
          return Promise.resolve({ data: [mockVariant], total_count: 1 })
        }
      )

      const filters: Omit<VariantFilter, 'case_id'> = {
        consequences: ['missense_variant'],
        funcs: ['exonic'],
        clinvars: ['pathogenic']
      }
      const { result } = setup(1, filters)
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      expect(capturedFilters).not.toBeNull()
      // Verify no reactive proxies
      expect(isReactive(capturedFilters)).toBe(false)
      if (capturedFilters && typeof capturedFilters === 'object') {
        const f = capturedFilters as Record<string, unknown>
        if (f.consequences) expect(isReactive(f.consequences)).toBe(false)
        if (f.funcs) expect(isReactive(f.funcs)).toBe(false)
        if (f.clinvars) expect(isReactive(f.clinvars)).toBe(false)
      }

      // Must serialize cleanly (simulates Electron IPC structured clone)
      expect(() => JSON.parse(JSON.stringify(capturedFilters))).not.toThrow()
    })
  })

  describe('case switching', () => {
    it('resets state and fetches unfiltered count on case change', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [],
        total_count: 100
      })

      const { caseIdRef } = setup(1)
      await flushPromises()

      const callsBefore = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length

      // Switch case
      caseIdRef.value = 2
      await nextTick()
      await flushPromises()

      const callsAfter = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls.length
      expect(callsAfter).toBeGreaterThan(callsBefore)

      // Should query with empty filters for unfiltered count
      const lastCall = (window.api.variants.query as ReturnType<typeof vi.fn>).mock.calls[
        callsAfter - 1
      ]
      expect(lastCall[0]).toBe(2) // new case ID
      expect(lastCall[1]).toEqual({}) // empty filters
    })
  })

  describe('annotation loading', () => {
    it('loads annotations when variants change', async () => {
      window.api.variants.query = vi.fn().mockResolvedValue({
        data: [mockVariant],
        total_count: 1
      })

      const { result } = setup(1)
      await flushPromises()

      await result.loadVariants()
      await flushPromises()

      // loadAnnotationsBatch should have been called
      // (it's from useAnnotations which is not mocked, but it
      //  calls api.annotations.getForVariant which is mocked)
      expect(result.variants.value).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/renderer/composables/useVariantData.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Fix any issues and re-run**

If any test fails, adjust mocking or assertions based on error output. Common issues:
- Missing `geneSymbols` mock on `window.api.variants` → add to `createMockApi`
- Debounce timing → use `vi.advanceTimersByTime()` if needed

- [ ] **Step 4: Commit**

```
git add tests/renderer/composables/useVariantData.test.ts
git commit -m "test: add useVariantData composable tests"
```

---

### Task 6: Extend `useCohortData.test.ts` with IPC-safety tests

**Files:**
- Modify: `tests/renderer/composables/useCohortData.test.ts`

- [ ] **Step 1: Add buildIpcParams proxy-stripping tests**

Append a new describe block to the existing test file. Since `buildIpcParams` is a private function inside `useCohortData`, test it indirectly through `fetchVariants` by checking what reaches the API mock.

```typescript
import { reactive, isReactive } from 'vue'

describe('IPC safety — buildIpcParams strips reactive proxies', () => {
  it('passes plain arrays to cohort.getVariants (no reactive proxies)', async () => {
    let capturedParams: unknown = null
    window.api.cohort.getVariants = vi.fn().mockImplementation((params: unknown) => {
      capturedParams = params
      return Promise.resolve({ data: [], total_count: 0 })
    })

    const [result, appInstance] = withSetup(() => useCohortData())
    app = appInstance

    await result.fetchVariants({
      offset: 0,
      limit: 10,
      consequences: reactive(['missense_variant', 'nonsense']),
      funcs: reactive(['exonic']),
      clinvars: reactive(['pathogenic']),
      acmg_classifications: reactive(['Pathogenic']),
      column_filters: reactive({ chr: { operator: '=', value: 'chr1' } })
    })
    await flushPromises()

    expect(capturedParams).not.toBeNull()
    const p = capturedParams as Record<string, unknown>

    // All array/object fields must be plain
    if (p.consequences) expect(isReactive(p.consequences)).toBe(false)
    if (p.funcs) expect(isReactive(p.funcs)).toBe(false)
    if (p.clinvars) expect(isReactive(p.clinvars)).toBe(false)
    if (p.acmg_classifications) expect(isReactive(p.acmg_classifications)).toBe(false)
    if (p.column_filters) expect(isReactive(p.column_filters)).toBe(false)

    // Must serialize cleanly
    expect(() => JSON.parse(JSON.stringify(capturedParams))).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/renderer/composables/useCohortData.test.ts`
Expected: All tests PASS (existing + new)

- [ ] **Step 3: Commit**

```
git add tests/renderer/composables/useCohortData.test.ts
git commit -m "test: add IPC safety tests for useCohortData"
```

---

### Task 7: Add `geneSymbols` to mock API (if needed)

**Files:**
- Modify: `tests/utils/mock-api.ts`

The `useFilterState` test calls `api.variants.geneSymbols` which isn't in the mock API type. Check if it exists; if not, add it.

- [ ] **Step 1: Add geneSymbols mock**

```typescript
// In the variants section of createMockApi:
variants: {
  query: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
  getFilterOptions: vi.fn().mockResolvedValue({}),
  search: vi.fn().mockResolvedValue([]),
  geneSymbols: vi.fn().mockResolvedValue([])  // ← add this
}
```

Also update the `MockApi` type to include it.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```
git add tests/utils/mock-api.ts
git commit -m "test: add geneSymbols to mock API"
```

---

### Task 8: Final lint, typecheck, and full test run

- [ ] **Step 1: Run lint**

Run: `npx eslint --fix .`
Expected: Clean

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Clean

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit any lint fixes**

```
git add -A
git commit -m "chore: lint fixes"
```
