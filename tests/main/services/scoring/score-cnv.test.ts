import { describe, it, expect } from 'vitest'
import { scoreCnv } from '../../../../src/main/services/scoring/score-cnv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreCnv()', () => {
  it('homozygous deletion CN=0 -> impact 1.0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 0,
      cnv_copy_number_quality: 95
    })
    expect(scoreCnv(row).impact).toBe(1.0)
  })

  it('heterozygous deletion CN=1 -> impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 1,
      cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0.66)
  })

  it('duplication CN=3 -> impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 3,
      cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0.66)
  })

  it('high-level amplification CN=6 -> impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 6,
      cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0.66)
  })

  it('neutral CN=2 -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 2,
      cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0)
  })

  it('null CN -> impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: null,
      cnv_copy_number_quality: null
    })
    expect(scoreCnv(row).impact).toBe(0)
  })

  it('null quality -> pathogenicity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 0,
      cnv_copy_number_quality: null
    })
    expect(scoreCnv(row).pathogenicity).toBe(0)
  })

  it('quality normalized to [0,1] with 100 cap', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 0,
      cnv_copy_number_quality: 50
    })
    expect(scoreCnv(row).pathogenicity).toBe(0.5)
  })

  it('quality > 100 clamps to 1', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 0,
      cnv_copy_number_quality: 250
    })
    expect(scoreCnv(row).pathogenicity).toBe(1)
  })

  it('rarity is fixed at 1.0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv',
      cnv_copy_number: 0,
      cnv_copy_number_quality: 90
    })
    expect(scoreCnv(row).rarity).toBe(1.0)
  })
})
