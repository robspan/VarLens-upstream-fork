import { describe, it, expect } from 'vitest'
import { scoreStr } from '../../../../src/main/services/scoring/score-str'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreStr()', () => {
  it('pathologic status with known disease -> all boosts', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pathologic',
      str_disease: "Huntington's disease"
    })
    expect(scoreStr(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 0.9,
        "impact": 1,
        "pathogenicity": 1,
        "phenotype": 0,
        "rarity": 1,
      }
    `)
  })

  it('intermediate status -> impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'intermediate',
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0.66)
  })

  it('unknown locus -> pathogenicity 0.5', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pathologic',
      str_disease: null
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('empty-string disease treated as unknown', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pathologic',
      str_disease: '   '
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('normal status -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'normal',
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0)
  })

  it('null status -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: null,
      str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0)
  })

  it('unknown locus falls back to mapClinvarBoost', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'intermediate',
      str_disease: null,
      clinvar: 'Pathogenic'
    })
    expect(scoreStr(row).clinvar).toBe(1)
  })

  it('known locus short-circuits to 0.9 regardless of clinvar column', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pathologic',
      str_disease: 'Friedreich ataxia',
      clinvar: null
    })
    expect(scoreStr(row).clinvar).toBe(0.9)
  })

  it('rarity is always 1.0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str',
      str_status: 'pathologic',
      str_disease: 'Fragile X syndrome'
    })
    expect(scoreStr(row).rarity).toBe(1)
  })
})
