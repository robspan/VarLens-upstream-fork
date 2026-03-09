import { describe, it, expect } from 'vitest'
import { logisticBurdenTest } from '../../../src/main/statistics/burden'
import type { SampleBurdenData } from '../../../src/main/statistics/types'

function makeSample(group: 0 | 1, dosages: number[], mafs: number[]): SampleBurdenData {
  return {
    group,
    dosages,
    variant_mafs: mafs,
    variant_cadds: dosages.map(() => null),
    covariate_values: []
  }
}

describe('logisticBurdenTest', () => {
  it('returns NO_SAMPLES warning for empty input', () => {
    const result = logisticBurdenTest([], 'uniform')
    expect(result.warning).toBe('NO_SAMPLES')
    expect(result.p_value).toBeNull()
  })

  it('returns ZERO_BURDEN when no variants qualify', () => {
    const samples: SampleBurdenData[] = [
      makeSample(1, [0, 0], [0.01, 0.02]),
      makeSample(0, [0, 0], [0.01, 0.02])
    ]
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.warning).toBe('ZERO_BURDEN')
  })

  it('runs standard logistic regression for well-behaved data', () => {
    const samples: SampleBurdenData[] = []
    // Group A: higher burden
    for (let i = 0; i < 20; i++) {
      samples.push(makeSample(1, [i % 3 === 0 ? 1 : 0, i % 2 === 0 ? 1 : 0], [0.01, 0.02]))
    }
    // Group B: lower burden
    for (let i = 0; i < 20; i++) {
      samples.push(makeSample(0, [i % 5 === 0 ? 1 : 0, 0], [0.01, 0.02]))
    }
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.used_firth).toBe(false)
    expect(result.p_value).toBeDefined()
    expect(result.beta).toBeDefined()
  })

  it('falls back to Firth for perfect separation', () => {
    const samples: SampleBurdenData[] = [
      makeSample(1, [2], [0.01]),
      makeSample(1, [1], [0.01]),
      makeSample(1, [3], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01])
    ]
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.used_firth).toBe(true)
    expect(result.p_value).toBeDefined()
    expect(result.p_value).not.toBeNull()
  })
})
