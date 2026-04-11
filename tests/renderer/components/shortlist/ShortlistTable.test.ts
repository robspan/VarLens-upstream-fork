/**
 * Unit tests for ShortlistTable.vue — the v-data-table specialized for
 * shortlist rows. Columns: # / Score / Type / Gene / Variant / Impact /
 * AF / ClinVar / ★ / actions.
 *
 * ShortlistTable is a pure presentational leaf — it receives
 * `rows: ShortlistRow[]` as a prop and emits `row-click`, `open-in-tab`,
 * `toggle-star`. No composable, no IPC, no window.api.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 * Plan: .planning/plans/2026-04-11-unified-shortlist-plan.md (Task 1.D)
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ShortlistTable from '../../../../src/renderer/src/components/shortlist/ShortlistTable.vue'
import type { ShortlistRow } from '../../../../src/shared/types/shortlist'

const vuetify = createVuetify({ components, directives })

function row(overrides: Partial<ShortlistRow> = {}): ShortlistRow {
  return {
    id: 1,
    case_id: 1,
    variant_type: 'snv',
    chr: '1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'BRCA1',
    consequence: 'HIGH',
    cadd: 35,
    gnomad_af: 0.0001,
    clinvar: 'Pathogenic',
    is_starred: false,
    rank: 1,
    rank_score: 0.95,
    rank_components: {
      impact: 1,
      pathogenicity: 0.87,
      rarity: 0.99,
      clinvar: 1,
      phenotype: 0
    },
    rank_clinvar_pinned: true,
    rank_starred_pinned: false,
    ...overrides
  } as ShortlistRow
}

describe('ShortlistTable', () => {
  it('renders one row per input item', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({ id: 1 }), row({ id: 2, rank: 2 })] },
      global: { plugins: [vuetify] }
    })
    // v-data-table renders each item as a <tr>
    expect(wrapper.findAll('tbody tr').length).toBe(2)
  })

  it('displays rank, gene_symbol, and score', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    const text = wrapper.text()
    expect(text).toContain('1') // rank
    expect(text).toContain('BRCA1') // gene
    expect(text).toContain('0.95') // score formatted
  })

  it('emits row-click when a row is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    await wrapper.find('tbody tr').trigger('click')
    const emitted = wrapper.emitted('row-click')
    expect(emitted).toBeTruthy()
    expect((emitted?.[0]?.[0] as ShortlistRow).id).toBe(1)
  })

  it('emits toggle-star when star icon is clicked', async () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    const star = wrapper.find('[data-testid="shortlist-star-1"]')
    await star.trigger('click')
    expect(wrapper.emitted('toggle-star')).toBeTruthy()
  })

  it('variant_notation for SNV is chr:pos ref>alt', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row()] },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('1:1000 A>T')
  })

  it('variant_notation for SV is chr:pos sv_type sv_length bp', () => {
    const wrapper = mount(ShortlistTable, {
      props: {
        rows: [
          row({
            variant_type: 'sv',
            chr: '2',
            pos: 5000,
            sv_type: 'DEL',
            sv_length: 1000
          })
        ]
      },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toContain('2:5000 DEL 1000bp')
  })
})
