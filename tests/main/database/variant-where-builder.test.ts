import { describe, it, expect } from 'vitest'
import { buildBaseWhere } from '../../../src/main/database/variant-where-builder'
import type { ColumnFilter } from '../../../src/shared/types/column-filters'

describe('buildBaseWhere', () => {
  it('returns empty sql + params for empty filters', () => {
    const result = buildBaseWhere({}, { baseAlias: 'v', scope: 'case' })
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('translates gnomad_af_max with IS NULL OR branch', () => {
    const result = buildBaseWhere(
      { gnomad_af_max: 0.01 },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('IS NULL OR')
    expect(result.params).toEqual([0.01])
  })

  it('translates consequences to IN clause', () => {
    const result = buildBaseWhere(
      { consequences: ['missense_variant', 'stop_gained'] },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.consequence IN (?, ?)')
    expect(result.params).toEqual(['missense_variant', 'stop_gained'])
  })

  it('adds gene_symbol IS NOT NULL for cohort-burden scope', () => {
    const result = buildBaseWhere({}, { baseAlias: 'v', scope: 'cohort-burden' })
    expect(result.sql).toContain('gene_symbol IS NOT NULL')
    expect(result.sql).toContain("gene_symbol != ''")
  })

  it('SNV/indel collapse in cohort-listing scope for variant_type=snv', () => {
    const result = buildBaseWhere(
      { variant_type: 'snv' },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain("cvs.variant_type IN ('snv', 'indel')")
  })

  it('exact variant_type match for non-snv in cohort-listing', () => {
    const result = buildBaseWhere(
      { variant_type: 'sv' },
      { baseAlias: 'cvs', scope: 'cohort-listing' }
    )
    expect(result.sql).toContain('cvs.variant_type = ?')
    expect(result.params).toEqual(['sv'])
  })

  it('bare column_filter with range operator', () => {
    const filter: ColumnFilter = { operator: '<=', value: 0.05, includeEmpty: true }
    const result = buildBaseWhere(
      { column_filters: { gnomad_af: filter } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('IS NULL OR')
    expect(result.params).toEqual([0.05])
  })

  it('bare column_filter with includeEmpty=false skips IS NULL OR', () => {
    const filter: ColumnFilter = { operator: '>=', value: 20, includeEmpty: false }
    const result = buildBaseWhere(
      { column_filters: { cadd: filter } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).not.toContain('IS NULL OR')
    expect(result.params).toEqual([20])
  })

  it('skips dotted (extension) column_filter keys — handled per-path', () => {
    const filter: ColumnFilter = { operator: '>=', value: 3 }
    const result = buildBaseWhere(
      { column_filters: { 'cnv.copy_number': filter, gnomad_af: { operator: '<=', value: 0.01 } } },
      { baseAlias: 'v', scope: 'case' }
    )
    expect(result.sql).not.toContain('cnv.copy_number')
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.params).toEqual([0.01])
  })

  it('combines multiple conditions with AND', () => {
    const result = buildBaseWhere(
      { gnomad_af_max: 0.01, cadd_min: 20, consequences: ['missense_variant'] },
      { baseAlias: 'v', scope: 'case' }
    )
    // All three conditions present
    expect(result.sql).toContain('v.gnomad_af')
    expect(result.sql).toContain('v.cadd')
    expect(result.sql).toContain('v.consequence IN')
    expect(result.params).toEqual([0.01, 20, 'missense_variant'])
  })
})
