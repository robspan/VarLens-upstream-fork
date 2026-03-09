import { describe, it, expect } from 'vitest'
import { logisticRegression } from '../../../src/main/statistics/logistic'
import goldenRef from '../../fixtures/golden/logistic-reference.json'

describe('logisticRegression (standard)', () => {
  for (const ref of goldenRef) {
    it(`matches golden reference: ${ref.name}`, () => {
      const covariates = ref.covariates
        ? ref.burden.map((_: number, i: number) => [(ref.covariates as number[])[i]])
        : undefined
      const result = logisticRegression(ref.burden, ref.y, covariates)

      expect(result.converged).toBe(ref.converged)
      expect(result.beta).toBeCloseTo(ref.beta, 3)
      expect(result.se).toBeCloseTo(ref.se, 2)
      expect(result.p_value).toBeCloseTo(ref.p_value, 3)
      expect(result.ci_lower).toBeCloseTo(ref.ci_lower, 1)
      expect(result.ci_upper).toBeCloseTo(ref.ci_upper, 1)
    })
  }
})
