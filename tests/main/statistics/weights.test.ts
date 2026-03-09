import { describe, it, expect } from 'vitest'
import { computeWeight } from '../../../src/main/statistics/weights'
import goldenRef from '../../fixtures/golden/weights-reference.json'

describe('computeWeight', () => {
  describe('beta_maf', () => {
    for (const ref of goldenRef) {
      it(`Beta(${ref.maf}; 1, 25) matches golden reference`, () => {
        const w = computeWeight('beta_maf', ref.maf, null)
        expect(w).toBeCloseTo(ref.beta_1_25_weight, 8)
      })
    }
  })

  describe('uniform', () => {
    it('returns 1.0 for any MAF', () => {
      expect(computeWeight('uniform', 0.01, null)).toBe(1.0)
      expect(computeWeight('uniform', 0.5, null)).toBe(1.0)
    })
  })

  describe('beta_maf_cadd', () => {
    it('multiplies Beta(MAF) by min(CADD/40, 1)', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withCadd = computeWeight('beta_maf_cadd', 0.01, 20)
      expect(withCadd).toBeCloseTo(betaOnly * (20 / 40), 8)
    })

    it('caps CADD contribution at 1.0', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withCadd = computeWeight('beta_maf_cadd', 0.01, 50)
      expect(withCadd).toBeCloseTo(betaOnly, 8)
    })

    it('uses Beta(MAF) only when CADD is null', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withNull = computeWeight('beta_maf_cadd', 0.01, null)
      expect(withNull).toBeCloseTo(betaOnly, 8)
    })
  })
})
