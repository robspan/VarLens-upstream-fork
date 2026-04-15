import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  buildVariantRenderRows,
  useVariantRenderRows
} from '../../../../src/renderer/src/components/variant-table/useVariantRenderRows'
import type { RowViewModel } from '../../../../src/renderer/src/components/variant-table/useVariantRowViewModel'
import type { Variant } from '../../../../src/shared/types/api'

function makeVariant(chr: string, pos: number, refAllele: string, altAllele: string): Variant {
  return {
    id: pos,
    chr,
    pos,
    ref: refAllele,
    alt: altAllele,
    gene_symbol: 'BRCA1',
    clinvar: 'Pathogenic'
  } as Variant
}

function makeViewModel(overrides: Partial<RowViewModel> = {}): RowViewModel {
  return {
    links: {
      chr: 'https://example.test/chr',
      pos: 'https://example.test/pos',
      _link_panel: 'https://example.test/panel'
    },
    isStarred: true,
    isGlobalStarred: false,
    acmgClassification: 'LP',
    globalAcmgClassification: null,
    hasComment: true,
    hasGlobalComment: false,
    ...overrides
  }
}

describe('buildVariantRenderRows', () => {
  it('attaches precomputed render state to each row', () => {
    const variant = makeVariant('1', 100, 'A', 'T')
    const rows = buildVariantRenderRows([variant], new Map([['1:100:A:T', makeViewModel()]]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      chr: '1',
      pos: 100,
      render: {
        isStarred: true,
        hasComment: true
      }
    })
    expect(rows[0].render.links._link_panel).toBe('https://example.test/panel')
  })

  it('supplies a stable empty render model when no precomputed state exists', () => {
    const [row] = buildVariantRenderRows([makeVariant('2', 200, 'G', 'C')], new Map())

    expect(row.render).toMatchObject({
      isStarred: false,
      isGlobalStarred: false,
      acmgClassification: null,
      globalAcmgClassification: null,
      hasComment: false,
      hasGlobalComment: false
    })
    expect(row.render.links).toEqual({})
  })
})

describe('useVariantRenderRows', () => {
  it('recomputes rows when the row-view-model map changes', () => {
    const variants = ref([makeVariant('3', 300, 'C', 'A')])
    const rowViewModels = ref(new Map<string, RowViewModel>())

    const { renderRows } = useVariantRenderRows(
      variants,
      computed(() => rowViewModels.value)
    )

    expect(renderRows.value[0].render.isStarred).toBe(false)

    rowViewModels.value = new Map([['3:300:C:A', makeViewModel({ isStarred: true })]])

    expect(renderRows.value[0].render.isStarred).toBe(true)
  })

  it('preserves row object identity when only render state changes', () => {
    const variants = ref([makeVariant('4', 400, 'T', 'G')])
    const rowViewModels = ref(
      new Map<string, RowViewModel>([['4:400:T:G', makeViewModel({ isStarred: false })]])
    )

    const { renderRows } = useVariantRenderRows(
      variants,
      computed(() => rowViewModels.value)
    )

    const firstRow = renderRows.value[0]

    rowViewModels.value = new Map([['4:400:T:G', makeViewModel({ isStarred: true })]])

    expect(renderRows.value[0]).toBe(firstRow)
    expect(renderRows.value[0].render.isStarred).toBe(true)
  })
})
