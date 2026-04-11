import { describe, it, expect } from 'vitest'
import { scoreSnv } from '../../../../src/main/services/scoring/score-snv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreSnv()', () => {
  it('snapshots components for a rare pathogenic SNV', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: 32,
      gnomad_af: 0.0002,
      clinvar: 'Pathogenic'
    })
    expect(scoreSnv(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 1,
        "impact": 1,
        "pathogenicity": 0.8,
        "phenotype": 0,
        "rarity": 0.98,
      }
    `)
  })

  it('handles NULL cadd -> pathogenicity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: null,
      gnomad_af: 0.001,
      clinvar: null
    })
    expect(scoreSnv(row).pathogenicity).toBe(0)
  })

  it('handles NULL gnomad_af -> rarity 1', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: 20,
      gnomad_af: null,
      clinvar: null
    })
    expect(scoreSnv(row).rarity).toBe(1)
  })

  it('common variant (AF >= 0.01) -> rarity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'LOW',
      cadd: 10,
      gnomad_af: 0.05,
      clinvar: null
    })
    expect(scoreSnv(row).rarity).toBe(0)
  })

  it('applies to indel variants too', () => {
    const row = buildShortlistCandidate({
      variant_type: 'indel',
      consequence: 'HIGH',
      cadd: 30,
      gnomad_af: 0.001,
      clinvar: null
    })
    expect(scoreSnv(row).impact).toBe(1)
  })

  it('MODERATE consequence maps to 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'MODERATE',
      cadd: 20,
      gnomad_af: 0.001,
      clinvar: null
    })
    expect(scoreSnv(row).impact).toBeCloseTo(0.66)
  })

  it('LOW consequence maps to 0.33', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'LOW',
      cadd: 10,
      gnomad_af: 0.001,
      clinvar: null
    })
    expect(scoreSnv(row).impact).toBeCloseTo(0.33)
  })

  it('CADD saturates at 40', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: 80,
      gnomad_af: null,
      clinvar: null
    })
    expect(scoreSnv(row).pathogenicity).toBe(1)
  })

  it('ClinVar Likely_pathogenic -> 0.9', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: 20,
      gnomad_af: null,
      clinvar: 'Likely_pathogenic'
    })
    expect(scoreSnv(row).clinvar).toBeCloseTo(0.9)
  })

  it('NULL consequence -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: null,
      cadd: 20,
      gnomad_af: null,
      clinvar: null
    })
    expect(scoreSnv(row).impact).toBe(0)
  })

  it('hpo_sim_score flows through to phenotype', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      hpo_sim_score: 0.75
    })
    expect(scoreSnv(row).phenotype).toBe(0.75)
  })
})
