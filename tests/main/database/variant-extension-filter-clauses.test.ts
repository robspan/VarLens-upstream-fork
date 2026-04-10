import { describe, it, expect } from 'vitest'
import { buildExtensionJoinClauses } from '../../../src/main/database/variant-extension-registry'

describe('buildExtensionJoinClauses (direct JOIN mode)', () => {
  it('returns empty result for no column filters', () => {
    const result = buildExtensionJoinClauses({}, 'v')
    expect(result.joins).toBe('')
    expect(result.whereClause).toBe('')
    expect(result.params).toEqual([])
    expect(result.implicitTypeNarrowing).toBeNull()
    expect(result.requiredJoinAliases.size).toBe(0)
  })

  it('ignores unknown dotted keys', () => {
    const result = buildExtensionJoinClauses(
      { 'unknown.col': { operator: '>=', value: 1 } },
      'v'
    )
    expect(result.joins).toBe('')
    expect(result.whereClause).toBe('')
    expect(result.params).toEqual([])
    expect(result.requiredJoinAliases.size).toBe(0)
  })

  it('ignores bare keys (base columns handled elsewhere)', () => {
    const result = buildExtensionJoinClauses(
      { gnomad_af: { operator: '<=', value: 0.01 } },
      'v'
    )
    expect(result.joins).toBe('')
    expect(result.whereClause).toBe('')
    expect(result.params).toEqual([])
  })

  it('emits JOIN + narrowing + range for cnv.copy_number >= 3', () => {
    const result = buildExtensionJoinClauses(
      { 'cnv.copy_number': { operator: '>=', value: 3 } },
      'v'
    )
    expect(result.joins).toContain('LEFT JOIN variant_cnv cnv')
    expect(result.joins).toContain('cnv.variant_id = v.id')
    expect(result.whereClause).toContain("v.variant_type = 'cnv'")
    expect(result.whereClause).toContain('cnv.copy_number >= ?')
    expect(result.params).toEqual([3])
    expect(result.implicitTypeNarrowing).toBe('cnv')
    expect(result.requiredJoinAliases.has('cnv')).toBe(true)
  })

  it('sv.support >= 10 emits SV join and narrowing', () => {
    const result = buildExtensionJoinClauses(
      { 'sv.support': { operator: '>=', value: 10 } },
      'v'
    )
    expect(result.joins).toContain('LEFT JOIN variant_sv sv')
    expect(result.whereClause).toContain("v.variant_type = 'sv'")
    expect(result.whereClause).toContain('sv.support >= ?')
    expect(result.params).toEqual([10])
    expect(result.implicitTypeNarrowing).toBe('sv')
  })

  it('str.disease LIKE with includeEmpty=false skips IS NULL OR', () => {
    const result = buildExtensionJoinClauses(
      { 'str.disease': { operator: 'like', value: 'Huntington', includeEmpty: false } },
      'v'
    )
    expect(result.whereClause).toContain('str.disease LIKE ?')
    expect(result.whereClause).not.toContain('IS NULL OR')
    expect(result.params).toEqual(['%Huntington%'])
  })

  it('str.str_status IN enum list', () => {
    const result = buildExtensionJoinClauses(
      { 'str.str_status': { operator: 'in', value: ['full_mutation', 'premutation'] } },
      'v'
    )
    expect(result.whereClause).toContain('str.str_status IN (?, ?)')
    expect(result.params).toEqual(['full_mutation', 'premutation'])
  })

  it('str.repeat_unit LIKE with default includeEmpty trims empty strings', () => {
    const result = buildExtensionJoinClauses(
      { 'str.repeat_unit': { operator: 'like', value: '  ' } },
      'v'
    )
    // whitespace-only LIKE is dropped
    expect(result.whereClause).not.toContain('LIKE')
    expect(result.params).toEqual([])
  })

  it('numeric range with includeEmpty=true keeps IS NULL OR branch', () => {
    const result = buildExtensionJoinClauses(
      { 'sv.support': { operator: '>=', value: 5, includeEmpty: true } },
      'v'
    )
    expect(result.whereClause).toContain('sv.support IS NULL OR')
    expect(result.whereClause).toContain('sv.support >= ?')
  })

  it('numeric range defaults to includeEmpty=false (no IS NULL OR)', () => {
    const result = buildExtensionJoinClauses(
      { 'sv.support': { operator: '>=', value: 5 } },
      'v'
    )
    // Extension filters default to EXCLUDE NULLs (no extension row = variant not of that type)
    expect(result.whereClause).not.toContain('IS NULL OR')
  })

  it('empty IN array is dropped', () => {
    const result = buildExtensionJoinClauses(
      { 'str.str_status': { operator: 'in', value: [] } },
      'v'
    )
    // Join still added (type was seen) but no IN clause
    expect(result.whereClause).not.toContain('IN (')
    expect(result.params).toEqual([])
  })

  it('two filters on the same extension type share one narrowing', () => {
    const result = buildExtensionJoinClauses(
      {
        'cnv.copy_number': { operator: '>=', value: 3 },
        'cnv.copy_number_quality': { operator: '>=', value: 20 }
      },
      'v'
    )
    const narrowingMatches = (result.whereClause.match(/variant_type = 'cnv'/g) ?? []).length
    expect(narrowingMatches).toBe(1)
    expect(result.whereClause).toContain('cnv.copy_number >= ?')
    expect(result.whereClause).toContain('cnv.copy_number_quality >= ?')
    expect(result.params).toEqual([3, 20])
    expect(result.implicitTypeNarrowing).toBe('cnv')
  })

  it('two extension types → implicitTypeNarrowing=null', () => {
    const result = buildExtensionJoinClauses(
      {
        'cnv.copy_number': { operator: '>=', value: 3 },
        'sv.support': { operator: '>=', value: 10 }
      },
      'v'
    )
    expect(result.implicitTypeNarrowing).toBeNull()
    expect(result.requiredJoinAliases.size).toBe(2)
    expect(result.requiredJoinAliases.has('cnv')).toBe(true)
    expect(result.requiredJoinAliases.has('sv')).toBe(true)
    // No single-type narrowing clause when multiple extension types are in play
    expect(result.whereClause).not.toContain('variant_type =')
  })

  it('joins emitted for every distinct required alias', () => {
    const result = buildExtensionJoinClauses(
      {
        'cnv.copy_number': { operator: '>=', value: 3 },
        'sv.support': { operator: '>=', value: 10 }
      },
      'v'
    )
    expect(result.joins).toContain('LEFT JOIN variant_cnv cnv')
    expect(result.joins).toContain('LEFT JOIN variant_sv sv')
  })

  it('respects alternate base alias (e.g. variants)', () => {
    const result = buildExtensionJoinClauses(
      { 'cnv.copy_number': { operator: '>=', value: 3 } },
      'variants'
    )
    expect(result.joins).toContain('cnv.variant_id = variants.id')
    expect(result.whereClause).toContain("variants.variant_type = 'cnv'")
  })
})
