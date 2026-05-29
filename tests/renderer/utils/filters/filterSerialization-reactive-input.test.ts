import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'
import {
  buildFilterIpcParams,
  buildVariantFilterFromState,
  buildIpcParams
} from '../../../../src/renderer/src/utils/filters/filterSerialization'

describe('filterSerialization — reactive input handling (Pass-9 #4)', () => {
  const baseState = {
    columnFilters: { gnomad_af: { max: 0.01 }, cadd: { min: 20 } },
    searchQuery: 'BRCA1'
  }

  it('buildFilterIpcParams handles reactive input and produces identical output to plain', () => {
    const reactiveState = reactive({ ...baseState, columnFilters: reactive(baseState.columnFilters) })
    const fromReactive = buildFilterIpcParams(reactiveState)
    const fromPlain = buildFilterIpcParams(baseState)
    expect(fromReactive).toEqual(fromPlain)
    expect(() => JSON.stringify(fromReactive)).not.toThrow()
  })

  it('buildVariantFilterFromState handles reactive input', () => {
    const reactiveState = reactive({ ...baseState, columnFilters: reactive(baseState.columnFilters) })
    const fromReactive = buildVariantFilterFromState(reactiveState, 'snv')
    const fromPlain = buildVariantFilterFromState(baseState, 'snv')
    expect(fromReactive).toEqual(fromPlain)
  })

  it('buildIpcParams handles reactive nested with ref()', () => {
    const reactiveState = reactive({
      ...baseState,
      columnFilters: reactive({ gnomad_af: { max: ref(0.01) } })
    })
    expect(() => buildIpcParams(reactiveState)).not.toThrow()
  })
})
