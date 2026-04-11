import { describe, it, expect } from 'vitest'
import { scoreSv } from '../../../../src/main/services/scoring/score-sv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreSv()', () => {
  it('scores a large precise DEL', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_type: 'DEL',
      sv_length: 100000,
      sv_is_precise: 1,
      sv_vaf: 0.48
    })
    expect(scoreSv(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 0,
        "impact": 1,
        "pathogenicity": 0.48,
        "phenotype": 0,
        "rarity": 1,
      }
    `)
  })

  it('imprecise SV drops pathogenicity by 0.7x', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 2000,
      sv_is_precise: 0,
      sv_vaf: 0.5
    })
    expect(scoreSv(row).pathogenicity).toBeCloseTo(0.35)
  })

  it('small SV (<1kb) impact = 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 500,
      sv_is_precise: 1,
      sv_vaf: 0.5
    })
    expect(scoreSv(row).impact).toBe(0.66)
  })

  it('null VAF defaults to 0.5', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 1500,
      sv_is_precise: 1,
      sv_vaf: null
    })
    expect(scoreSv(row).pathogenicity).toBe(0.5)
  })

  it('rarity is always 1.0 (no gnomAD-SV source)', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 2000,
      sv_is_precise: 1,
      sv_vaf: 0.3
    })
    expect(scoreSv(row).rarity).toBe(1.0)
  })

  it('null sv_length -> small bucket (impact 0.66)', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: null,
      sv_is_precise: 1,
      sv_vaf: 0.4
    })
    expect(scoreSv(row).impact).toBe(0.66)
  })

  it('1kb boundary is inclusive (impact 1.0)', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 1000,
      sv_is_precise: 1,
      sv_vaf: 0.5
    })
    expect(scoreSv(row).impact).toBe(1.0)
  })

  it('pathogenicity caps at 1', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 5000,
      sv_is_precise: 1,
      sv_vaf: 1.5 // pathological caller value, but combined with 1.0 factor stays clamp-testable
    })
    expect(scoreSv(row).pathogenicity).toBe(1)
  })

  it('ClinVar Pathogenic boosts SV clinvar component', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv',
      sv_length: 2000,
      sv_is_precise: 1,
      sv_vaf: 0.5,
      clinvar: 'Pathogenic'
    })
    expect(scoreSv(row).clinvar).toBe(1)
  })
})
