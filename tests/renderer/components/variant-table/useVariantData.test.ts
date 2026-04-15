import { computed, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withSetup } from '../../../utils/test-helpers'
import type { Variant } from '../../../../src/shared/types/api'

const mockVariants = ref<Variant[]>([])
const loadAnnotationsBatchSpy = vi.fn()
const invalidateAnnotationGenerationSpy = vi.fn()
const clearAnnotationCacheSpy = vi.fn()

vi.mock('../../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      variants: {
        query: vi.fn().mockResolvedValue({
          data: [],
          total_count: 0,
          unfiltered_count: 0
        })
      }
    }
  })
}))

vi.mock('../../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => ({
    loadAnnotationsBatch: loadAnnotationsBatchSpy,
    invalidateAnnotationGeneration: invalidateAnnotationGenerationSpy,
    clearCache: clearAnnotationCacheSpy
  })
}))

vi.mock('../../../../src/renderer/src/composables/useColumnFilters', () => ({
  useColumnFilters: () => ({
    columnFilters: ref({}),
    getColumnFiltersParam: () => undefined,
    clearAllColumnFilters: vi.fn()
  })
}))

vi.mock('../../../../src/renderer/src/composables/useDebounce', () => ({
  useDebounce: <T extends (...args: never[]) => unknown>(fn: T) => ({
    debouncedFn: fn
  })
}))

vi.mock('../../../../src/renderer/src/composables/useOffsetPagination', () => ({
  useOffsetPagination: () => ({
    page: ref(1),
    itemsPerPage: ref(10),
    sortBy: ref([]),
    itemsPerPageOptions: [10, 25, 50],
    items: mockVariants,
    totalCount: ref(0),
    loading: ref(false),
    loadPage: vi.fn(),
    invalidateAndReload: vi.fn(),
    resetSort: vi.fn(),
    resetState: vi.fn()
  })
}))

import { useVariantData } from '../../../../src/renderer/src/components/variant-table/useVariantData'

function makeVariant(id: number): Variant {
  return {
    id,
    chr: '1',
    pos: 100 + id,
    ref: 'A',
    alt: 'T'
  } as Variant
}

describe('useVariantData hidden-work gating', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    mockVariants.value = []
    loadAnnotationsBatchSpy.mockReset()
    invalidateAnnotationGenerationSpy.mockReset()
    clearAnnotationCacheSpy.mockReset()
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
  })

  it('skips annotation hydration while inactive', async () => {
    const active = ref(false)
    const [, appInstance] = withSetup(() =>
      useVariantData({
        caseId: ref(1),
        filters: ref({}),
        active: computed(() => active.value),
        onCountsUpdate: vi.fn(),
        onSortUpdate: vi.fn()
      })
    )
    app = appInstance

    mockVariants.value = [makeVariant(1)]
    await nextTick()

    expect(loadAnnotationsBatchSpy).not.toHaveBeenCalled()
  })

  it('hydrates current variants once the table becomes active again', async () => {
    const active = ref(false)
    const [, appInstance] = withSetup(() =>
      useVariantData({
        caseId: ref(1),
        filters: ref({}),
        active: computed(() => active.value),
        onCountsUpdate: vi.fn(),
        onSortUpdate: vi.fn()
      })
    )
    app = appInstance

    mockVariants.value = [makeVariant(2)]
    await nextTick()
    active.value = true
    await nextTick()

    expect(loadAnnotationsBatchSpy).toHaveBeenCalledTimes(1)
    expect(loadAnnotationsBatchSpy).toHaveBeenCalledWith(1, [makeVariant(2)])
  })
})
