import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'
import { cloneForIpc } from '@renderer/utils/cloneForIpc'
import { stripVueProxies } from '../../../src/renderer/src/utils/stripVueProxies'

// Sprint A A2: the renderer cloneForIpc shim points at stripVueProxies, NOT
// the shared structuredClone-backed helper. Renderer callers (Save Preset in
// FilterToolbar/CohortFilterBar, useVariantData, useCohortData) pass Vue
// reactive()/ref() proxies in — structuredClone throws DataCloneError on those,
// so the shim MUST strip proxies. These behavioral assertions fail loudly if
// the shim is ever repointed back at the raw structuredClone helper.
describe('cloneForIpc (renderer shim)', () => {
  it('is the proxy-stripping helper, not the raw structuredClone shared helper', () => {
    expect(cloneForIpc).toBe(stripVueProxies)
  })

  it('returns a plain object from a plain object', () => {
    const input = { a: 1, b: 'two' }
    const result = cloneForIpc(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input) // new object
  })

  it('handles null values', () => {
    const input = { a: null }
    const result = cloneForIpc(input)
    expect(result.a).toBeNull()
  })

  it('handles empty objects', () => {
    expect(cloneForIpc({})).toEqual({})
  })

  it('deep-clones nested arrays and objects', () => {
    const input = { items: [1, 2, 3], nested: { x: 1 } }
    const result = cloneForIpc(input)
    expect(result).toEqual({ items: [1, 2, 3], nested: { x: 1 } })
    expect(result.items).not.toBe(input.items)
    expect(result.nested).not.toBe(input.nested)
  })

  // Regression coverage for the Save Preset / column-filter IPC paths: callers
  // pass `filters.value` (a Vue ref-backed reactive proxy) into cloneForIpc.
  // structuredClone would throw DataCloneError here; the shim must not.
  it('strips a Vue ref proxy (Save Preset filters.value shape)', () => {
    const filters = ref({ gene: 'BRCA1', impacts: ['HIGH', 'MODERATE'], min_af: 0.01 })
    expect(() => cloneForIpc(filters.value)).not.toThrow()
    const result = cloneForIpc(filters.value)
    expect(result).toEqual({ gene: 'BRCA1', impacts: ['HIGH', 'MODERATE'], min_af: 0.01 })
  })

  it('strips a reactive proxy with nested reactive values', () => {
    const filters = reactive({ outer: reactive({ inner: ref([1, 2]) }) })
    expect(() => cloneForIpc(filters)).not.toThrow()
    expect(cloneForIpc(filters)).toEqual({ outer: { inner: [1, 2] } })
  })

  it('strips a top-level reactive array (column_filters shape)', () => {
    const columnFilters = reactive([{ key: 'gene', value: 'BRCA1' }])
    const result = cloneForIpc(columnFilters)
    expect(result).toEqual([{ key: 'gene', value: 'BRCA1' }])
    expect(result).not.toBe(columnFilters)
  })
})
