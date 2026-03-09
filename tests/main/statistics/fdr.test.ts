import { describe, it, expect } from 'vitest'
import { benjaminiHochberg } from '../../../src/main/statistics/fdr'
import goldenRef from '../../fixtures/golden/fdr-reference.json'

describe('benjaminiHochberg', () => {
  for (const [i, ref] of goldenRef.entries()) {
    it(`matches golden reference case ${i}`, () => {
      const qValues = benjaminiHochberg(ref.p_values)
      for (let j = 0; j < ref.q_values.length; j++) {
        expect(qValues[j]).toBeCloseTo(ref.q_values[j], 10)
      }
    })
  }

  it('handles null p-values by passing through null', () => {
    const result = benjaminiHochberg([0.01, null, 0.05])
    expect(result[1]).toBeNull()
    expect(result[0]).toBeDefined()
    expect(result[2]).toBeDefined()
  })

  it('returns empty array for empty input', () => {
    expect(benjaminiHochberg([])).toEqual([])
  })
})
