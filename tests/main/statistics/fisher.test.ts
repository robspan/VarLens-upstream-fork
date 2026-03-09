import { describe, it, expect } from 'vitest'
import { fisherExactTest } from '../../../src/main/statistics/fisher'
import goldenRef from '../../fixtures/golden/fisher-reference.json'

describe('fisherExactTest', () => {
  for (const [i, ref] of goldenRef.entries()) {
    it(`matches golden reference case ${i}: table=${JSON.stringify(ref.table)}`, () => {
      const [[a, b], [c, d]] = ref.table
      const result = fisherExactTest(a, b, c, d)

      if (ref.p_value !== null) {
        expect(result.p_value).toBeCloseTo(ref.p_value, 8)
      }
      if (ref.odds_ratio !== null) {
        expect(result.odds_ratio).toBeCloseTo(ref.odds_ratio, 8)
      }
    })
  }

  it('returns null for empty table (all zeros)', () => {
    const result = fisherExactTest(0, 0, 0, 0)
    expect(result.p_value).toBeNull()
    expect(result.odds_ratio).toBeNull()
  })

  it('handles Haldane-Anscombe correction for zero cells', () => {
    const result = fisherExactTest(5, 0, 0, 5)
    expect(result.p_value).toBeDefined()
    expect(result.ci_lower).toBeDefined()
    expect(result.ci_upper).toBeDefined()
  })
})
