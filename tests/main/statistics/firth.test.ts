import { describe, it, expect } from 'vitest'
import { firthLogisticRegression } from '../../../src/main/statistics/logistic'
import goldenRef from '../../fixtures/golden/firth-reference.json'

describe('firthLogisticRegression', () => {
  for (const ref of goldenRef) {
    it(`handles ${ref.name}`, () => {
      const result = firthLogisticRegression(ref.burden, ref.y, undefined)
      expect(result.converged).toBe(true)
      expect(result.beta).toBeDefined()
      expect(result.se).toBeDefined()
      expect(result.p_value).toBeDefined()
      expect(result.p_value).toBeLessThan(1)
      expect(result.p_value).toBeGreaterThanOrEqual(0)
    })
  }
})
