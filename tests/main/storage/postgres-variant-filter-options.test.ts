import { describe, expect, it, vi } from 'vitest'

import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

// getColumnMeta now routes through runNamedDynamic, which calls pool.query with a
// { name, text, values } spec object rather than positional (text, values). Extract
// the SQL text regardless of call shape so these branches keep matching.
function sqlTextOf(arg: unknown): string {
  if (typeof arg === 'string') return arg
  return (arg as { text?: string }).text ?? ''
}

describe('PostgresVariantReadRepository filter metadata', () => {
  it('returns SQLite-compatible filter options for a case', async () => {
    const query = vi.fn(async (arg: unknown) => {
      const sql = sqlTextOf(arg)
      if (sql.includes('COUNT(DISTINCT v.cadd)')) {
        return { rows: [{ distinct_count: '2', min: '10', max: '35' }] }
      }
      if (sql.includes('COUNT(DISTINCT v.gnomad_af)')) {
        return { rows: [{ distinct_count: '2', min: '0.01', max: '0.2' }] }
      }
      if (sql.includes('COUNT(DISTINCT')) {
        return { rows: [{ distinct_count: '1' }] }
      }
      if (sql.includes('DISTINCT v.consequence')) {
        return { rows: [{ value: 'HIGH' }] }
      }
      if (sql.includes('DISTINCT v.func')) {
        return { rows: [{ value: 'stop_gained' }] }
      }
      if (sql.includes('DISTINCT v.clinvar')) {
        return { rows: [{ value: 'Pathogenic' }] }
      }
      if (sql.includes('SELECT DISTINCT')) {
        return { rows: [{ value: 'HIGH' }] }
      }
      return { rows: [] }
    })
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    const options = await repo.getFilterOptions(1)

    expect(options.consequences).toStrictEqual(['HIGH'])
    expect(options.funcs).toStrictEqual(['stop_gained'])
    expect(options.clinvars).toStrictEqual(['Pathogenic'])
    expect(options.minCadd).toBe(10)
    expect(options.maxCadd).toBe(35)
    expect(options.minGnomadAf).toBe(0.01)
    expect(options.maxGnomadAf).toBe(0.2)
    expect(options.columnMeta.map((meta) => meta.key)).toStrictEqual([
      'chr',
      'pos',
      'gene_symbol',
      'omim_mim_number',
      'func',
      'consequence',
      'transcript',
      'cdna',
      'aa_change',
      'gt_num',
      'gnomad_af',
      'cadd',
      'qual',
      'hpo_sim_score',
      'clinvar',
      'moi',
      'variant_type',
      'end_pos',
      'sv_type',
      'sv_length',
      'caller',
      'sv.sv_is_precise',
      'sv.support',
      'sv.pe_support',
      'sv.sr_support',
      'sv.dr',
      'sv.dv',
      'sv.vaf',
      'sv.strand',
      'sv.coverage',
      'sv.cipos_left',
      'sv.cipos_right',
      'sv.ciend_left',
      'sv.ciend_right',
      'sv.stdev_len',
      'sv.stdev_pos',
      'sv.event_id',
      'sv.mate_id',
      'cnv.copy_number',
      'cnv.copy_number_quality',
      'cnv.homozygosity_ref',
      'cnv.homozygosity_alt',
      'cnv.sm',
      'cnv.bin_count',
      'str.repeat_id',
      'str.variant_catalog_id',
      'str.repeat_unit',
      'str.display_repeat_unit',
      'str.repeat_length',
      'str.ref_copies',
      'str.alt_copies',
      'str.str_status',
      'str.disease',
      'str.inheritance_mode',
      'str.source_display',
      'str.support_type',
      'str.normal_max',
      'str.pathologic_min',
      'str.locus_coverage',
      'str.rank_score',
      'str.confidence_interval'
    ])
    expect(options.columnMeta).toContainEqual({
      key: 'cadd',
      dataType: 'numeric',
      distinctCount: 2,
      min: 10,
      max: 35
    })
    expect(options.columnMeta).toContainEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 1,
      distinctValues: ['HIGH']
    })
  })

  it('returns SQLite-compatible numeric column metadata', async () => {
    const query = vi.fn(async () => ({
      rows: [{ distinct_count: '3', min: '1', max: '99' }]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 1 }, 'cadd')).resolves.toStrictEqual({
      key: 'cadd',
      dataType: 'numeric',
      distinctCount: 3,
      min: 1,
      max: 99
    })
  })

  it('returns SQLite-compatible categorical column metadata', async () => {
    const query = vi.fn(async (arg: unknown) => {
      const sql = sqlTextOf(arg)
      if (sql.includes('COUNT(DISTINCT')) return { rows: [{ distinct_count: '1' }] }
      return { rows: [{ value: 'HIGH' }] }
    })
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseId: 1 }, 'consequence')).resolves.toStrictEqual({
      key: 'consequence',
      dataType: 'text',
      distinctCount: 1,
      distinctValues: ['HIGH']
    })
  })

  it('uses extension joins for extension column metadata', async () => {
    const query = vi.fn(async () => ({
      rows: [{ distinct_count: '2', min: '4', max: '12' }]
    }))
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getColumnMeta({ caseIds: [1, 2] }, 'sv.support')).resolves.toMatchObject({
      key: 'sv.support',
      dataType: 'numeric',
      distinctCount: 2,
      min: 4,
      max: 12
    })

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('"variant_sv" sv'),
        values: [[1, 2]]
      })
    )
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('ANY($1::bigint[])'),
        values: [[1, 2]]
      })
    )
  })
})
