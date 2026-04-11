import { describe, it, expect } from 'vitest'
import {
  ShortlistConfigSchema,
  RankConfigSchema,
  RankWeightsSchema,
  GetShortlistParamsSchema
} from '../../../src/shared/types/ipc-schemas'

describe('RankConfigSchema', () => {
  it('accepts valid weights with optional pinning flags', () => {
    expect(
      RankConfigSchema.safeParse({
        weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
        clinvarPinTop: true,
        pinStarredTop: false
      }).success
    ).toBe(true)
  })

  it('rejects missing weights block', () => {
    expect(RankConfigSchema.safeParse({}).success).toBe(false)
  })
})

describe('RankWeightsSchema', () => {
  it('accepts valid weights', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: 0.25,
        pathogenicity: 0.25,
        rarity: 0.25,
        clinvar: 0.25,
        phenotype: 0
      }).success
    ).toBe(true)
  })

  it('rejects negative weights', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: -0.1,
        pathogenicity: 0,
        rarity: 0,
        clinvar: 0,
        phenotype: 0
      }).success
    ).toBe(false)
  })

  it('rejects weights above 100', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: 101,
        pathogenicity: 0,
        rarity: 0,
        clinvar: 0,
        phenotype: 0
      }).success
    ).toBe(false)
  })
})

describe('ShortlistConfigSchema', () => {
  const baseConfig = {
    baseFilters: {},
    topN: 50,
    rankConfig: {
      weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
    }
  }

  it('accepts a minimal valid config', () => {
    expect(ShortlistConfigSchema.safeParse(baseConfig).success).toBe(true)
  })

  it('rejects topN > 500 (hard cap)', () => {
    expect(ShortlistConfigSchema.safeParse({ ...baseConfig, topN: 501 }).success).toBe(false)
  })

  it('rejects topN < 1', () => {
    expect(ShortlistConfigSchema.safeParse({ ...baseConfig, topN: 0 }).success).toBe(false)
  })

  it('accepts variantTypeScope with valid enum values', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str']
      }).success
    ).toBe(true)
  })

  it('rejects unknown variant type', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        variantTypeScope: ['mnv']
      }).success
    ).toBe(false)
  })

  it('rejects tieBreakers longer than 10', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        tieBreakers: new Array(11).fill({ key: 'cadd', order: 'desc' })
      }).success
    ).toBe(false)
  })
})

describe('GetShortlistParamsSchema (discriminated union)', () => {
  it('accepts presetId branch', () => {
    expect(GetShortlistParamsSchema.safeParse({ caseId: 1, presetId: 42 }).success).toBe(true)
  })

  it('accepts adHocConfig branch', () => {
    expect(
      GetShortlistParamsSchema.safeParse({
        caseId: 1,
        adHocConfig: {
          baseFilters: {},
          topN: 10,
          rankConfig: {
            weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
          }
        }
      }).success
    ).toBe(true)
  })

  it('rejects caseId = 0', () => {
    expect(GetShortlistParamsSchema.safeParse({ caseId: 0, presetId: 1 }).success).toBe(false)
  })

  it('rejects branch with neither presetId nor adHocConfig', () => {
    expect(GetShortlistParamsSchema.safeParse({ caseId: 1 }).success).toBe(false)
  })
})
