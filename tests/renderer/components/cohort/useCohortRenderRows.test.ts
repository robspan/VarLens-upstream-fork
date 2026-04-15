import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  buildCohortRenderRows,
  useCohortRenderRows
} from '../../../../src/renderer/src/components/cohort/useCohortRenderRows'
import type { CohortVariant } from '../../../../src/shared/types/cohort'

function makeVariant(overrides: Partial<CohortVariant> = {}): CohortVariant {
  return {
    variant_key: '1:100:A:T',
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'BRCA1',
    clinvar: 'Pathogenic',
    ...overrides
  } as CohortVariant
}

describe('buildCohortRenderRows', () => {
  it('precomputes per-row link values by column key', () => {
    const rows = buildCohortRenderRows([makeVariant()], {
      chr: (item) => `https://example.test/${item.chr}:${item.pos}`,
      gene_symbol: (item) => `https://example.test/gene/${item.gene_symbol}`,
      clinvar: () => 'https://example.test/clinvar'
    })

    expect(rows[0].render.links).toEqual({
      chr: 'https://example.test/1:100',
      gene_symbol: 'https://example.test/gene/BRCA1',
      clinvar: 'https://example.test/clinvar'
    })
  })

  it('returns an empty link map when no link config exists', () => {
    const [row] = buildCohortRenderRows([makeVariant()], {})
    expect(row.render.links).toEqual({})
  })
})

describe('useCohortRenderRows', () => {
  it('reacts to link-config changes', () => {
    const variants = ref([makeVariant()])
    const linkConfig = ref<Record<string, (item: CohortVariant) => string | null>>({})

    const { renderRows } = useCohortRenderRows(
      variants,
      computed(() => linkConfig.value)
    )

    expect(renderRows.value[0].render.links).toEqual({})

    linkConfig.value = {
      chr: (item) => `https://example.test/${item.chr}:${item.pos}`
    }

    expect(renderRows.value[0].render.links.chr).toBe('https://example.test/1:100')
  })
})
