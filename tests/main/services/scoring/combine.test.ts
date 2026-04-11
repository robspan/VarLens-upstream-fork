import { describe, it, expect } from 'vitest'
import { combine } from '../../../../src/main/services/scoring'
import type { RankComponents, RankWeights } from '../../../../src/shared/types/shortlist'

const UNIFORM: RankWeights = {
  impact: 0.25,
  pathogenicity: 0.25,
  rarity: 0.25,
  clinvar: 0.25,
  phenotype: 0
}
const ZERO_W: RankWeights = {
  impact: 0,
  pathogenicity: 0,
  rarity: 0,
  clinvar: 0,
  phenotype: 0
}

function components(o: Partial<RankComponents> = {}): RankComponents {
  return { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0, ...o }
}

describe('combine()', () => {
  it('returns 0 when all components are 0', () => {
    expect(combine(components(), UNIFORM)).toBe(0)
  })

  it('returns 1 when all scored components are 1 (phenotype ignored by weight)', () => {
    expect(
      combine(
        components({ impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }),
        UNIFORM
      )
    ).toBeCloseTo(1)
  })

  it('normalizes over weight sum (scale-invariant)', () => {
    const w: RankWeights = {
      impact: 10,
      pathogenicity: 10,
      rarity: 10,
      clinvar: 10,
      phenotype: 0
    }
    const c = components({ impact: 0.5, pathogenicity: 0.5, rarity: 0.5, clinvar: 0.5 })
    expect(combine(c, w)).toBeCloseTo(0.5)
  })

  it('returns 0 on all-zero weights (defensive)', () => {
    const c = components({ impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1 })
    expect(combine(c, ZERO_W)).toBe(0)
  })

  it('result is always in [0,1] regardless of weight scale', () => {
    const w: RankWeights = {
      impact: 5,
      pathogenicity: 0,
      rarity: 0,
      clinvar: 0,
      phenotype: 0
    }
    const c = components({ impact: 1 })
    const r = combine(c, w)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(1)
    expect(r).toBeCloseTo(1)
  })
})
