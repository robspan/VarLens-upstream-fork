import { describe, it, expect } from 'vitest'
import {
  calculatePoints,
  classifyFromPoints,
  calculateClassification
} from '../../../../src/renderer/src/utils/acmg/acmg-calculator'
import type { AcmgEvidenceCode } from '../../../../src/renderer/src/utils/acmg/types'

function makeCode(code: string, strength: string): AcmgEvidenceCode {
  return {
    code: code as AcmgEvidenceCode['code'],
    strength: strength as AcmgEvidenceCode['strength'],
    auto_suggested: false,
    confirmed: true
  }
}

describe('calculatePoints', () => {
  it('returns 0 for empty evidence arrays', () => {
    expect(calculatePoints([], [])).toEqual({
      pathogenicPoints: 0,
      benignPoints: 0,
      netPoints: 0
    })
  })

  it('calculates PVS1 as +8 points', () => {
    const pathogenic = [makeCode('PVS1', 'very_strong')]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 8,
      benignPoints: 0,
      netPoints: 8
    })
  })

  it('calculates PS + PM as +4 + +2 = +6 points', () => {
    const pathogenic = [makeCode('PS1', 'strong'), makeCode('PM2', 'moderate')]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 6,
      benignPoints: 0,
      netPoints: 6
    })
  })

  it('calculates benign evidence as negative points', () => {
    const benign = [makeCode('BA1', 'stand_alone')]
    expect(calculatePoints([], benign)).toEqual({
      pathogenicPoints: 0,
      benignPoints: 8,
      netPoints: -8
    })
  })

  it('calculates net points from mixed evidence', () => {
    const pathogenic = [makeCode('PVS1', 'very_strong'), makeCode('PM2', 'moderate')]
    const benign = [makeCode('BP4', 'supporting')]
    expect(calculatePoints(pathogenic, benign)).toEqual({
      pathogenicPoints: 10,
      benignPoints: 1,
      netPoints: 9
    })
  })

  it('only counts confirmed codes', () => {
    const pathogenic: AcmgEvidenceCode[] = [
      { code: 'PVS1', strength: 'very_strong', auto_suggested: false, confirmed: true },
      { code: 'PS1', strength: 'strong', auto_suggested: true, confirmed: false }
    ]
    expect(calculatePoints(pathogenic, [])).toEqual({
      pathogenicPoints: 8,
      benignPoints: 0,
      netPoints: 8
    })
  })
})

describe('classifyFromPoints', () => {
  it('classifies >= 10 as Pathogenic', () => {
    expect(classifyFromPoints(10)).toBe('Pathogenic')
    expect(classifyFromPoints(15)).toBe('Pathogenic')
  })

  it('classifies 6-9 as Likely Pathogenic', () => {
    expect(classifyFromPoints(6)).toBe('Likely Pathogenic')
    expect(classifyFromPoints(9)).toBe('Likely Pathogenic')
  })

  it('classifies 0-5 as VUS', () => {
    expect(classifyFromPoints(0)).toBe('VUS')
    expect(classifyFromPoints(5)).toBe('VUS')
  })

  it('classifies -1 to -6 as Likely Benign', () => {
    expect(classifyFromPoints(-1)).toBe('Likely Benign')
    expect(classifyFromPoints(-6)).toBe('Likely Benign')
  })

  it('classifies <= -7 as Benign', () => {
    expect(classifyFromPoints(-7)).toBe('Benign')
    expect(classifyFromPoints(-10)).toBe('Benign')
  })
})

describe('calculateClassification', () => {
  it('returns null for empty evidence', () => {
    expect(calculateClassification([], [])).toEqual({
      classification: null,
      pathogenicPoints: 0,
      benignPoints: 0,
      netPoints: 0
    })
  })

  it('calculates Pathogenic from PVS1 + PM2 + PP3', () => {
    const pathogenic = [
      makeCode('PVS1', 'very_strong'),
      makeCode('PM2', 'moderate'),
      makeCode('PP3', 'supporting')
    ]
    const result = calculateClassification(pathogenic, [])
    expect(result.classification).toBe('Pathogenic')
    expect(result.netPoints).toBe(11)
  })

  it('calculates Benign from BA1', () => {
    const benign = [makeCode('BA1', 'stand_alone')]
    const result = calculateClassification([], benign)
    expect(result.classification).toBe('Benign')
    expect(result.netPoints).toBe(-8)
  })
})
