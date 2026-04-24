import { describe, expect, it, vi } from 'vitest'

import {
  PostgresVariantReadRepository,
  toPrefixTsQueryForTest
} from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('PostgresVariantReadRepository', () => {
  it('returns variant type counts with bigint strings normalized', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { variant_type: 'snv', count: '2' },
          { variant_type: 'sv', count: '1' }
        ]
      })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypeCounts(1)).resolves.toStrictEqual({ snv: 2, sv: 1 })
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/\bvariants\b/), [1])
  })

  it('returns distinct variant types for a case scope', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ variant_type: 'snv' }, { variant_type: 'str' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypesPresent({ caseId: 1 })).resolves.toStrictEqual([
      'snv',
      'str'
    ])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('case_id = $1'), [1])
  })

  it('returns gene symbols by prefix case-insensitively', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ gene_symbol: 'BRCA1' }] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getGeneSymbols(1, 'br', 20)).resolves.toStrictEqual(['BRCA1'])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), [1, 'br%', 20])
  })

  it.each([
    ['tag_ids', { tag_ids: [1] }],
    ['starred_only', { starred_only: true }],
    ['has_comment', { has_comment: true }],
    ['acmg_classifications', { acmg_classifications: ['Pathogenic'] }],
    ['annotation_scope', { annotation_scope: 'all' }],
    ['active_panel_ids', { active_panel_ids: [1] }],
    ['panel_intervals', { panel_intervals: [{ chr: '1', start: 1, end: 2 }] }],
    ['inheritance_modes', { inheritance_modes: ['de_novo'] }]
  ])('rejects unsupported postgres variant filter %s', async (_name, filter) => {
    const repository = new PostgresVariantReadRepository({ query: vi.fn() } as never, 'public')

    await expect(
      repository.queryVariants({ case_id: 1, ...filter }, 25, 0, undefined, false, false)
    ).rejects.toThrow('Unsupported PostgreSQL variant filter')
  })

  it('queries variants with supported filters, sorting, counts, and unfiltered count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              case_id: '1',
              chr: '1',
              pos: '1000',
              ref: 'A',
              alt: 'G',
              gene_symbol: 'BRCA1',
              variant_type: 'snv',
              internal_af: 0.5
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(
      repository.queryVariants(
        {
          case_id: 1,
          variant_type: 'snv',
          gene_symbol: 'BRC',
          consequences: ['HIGH'],
          funcs: ['missense_variant'],
          clinvars: ['Pathogenic'],
          gnomad_af_max: 0.01,
          cadd_min: 20,
          max_internal_af: 0.6,
          search_query: 'BRCA1',
          column_filters: {
            consequence: { operator: 'in', value: ['HIGH'] },
            gene_symbol: { operator: 'like', value: 'BRC' }
          }
        },
        25,
        0,
        [{ key: 'pos', order: 'asc' }],
        false,
        true
      )
    ).resolves.toStrictEqual({
      data: [
        expect.objectContaining({
          id: 1,
          case_id: 1,
          pos: 1000,
          gene_symbol: 'BRCA1',
          variant_type: 'snv',
          internal_af: 0.5
        })
      ],
      total_count: 2,
      unfiltered_count: 5
    })

    const countSql = pool.query.mock.calls[0][0] as string
    const dataSql = pool.query.mock.calls[1][0] as string
    expect(countSql).toContain('COUNT(*)::int AS count')
    expect(dataSql).toContain('to_tsquery')
    expect(dataSql).toContain('LEFT JOIN "public"."variant_frequency"')
    expect(dataSql).toContain('COUNT(*) FROM "public"."cases"')
    expect(dataSql).toContain('EXISTS')
    expect(dataSql).toContain('"public"."variant_sv"')
    expect(dataSql).toContain('"public"."variant_str"')
    expect(dataSql).toContain('search_document @@')
    expect(dataSql).toContain('v.consequence IN')
    expect(dataSql).toContain('v.gene_symbol ILIKE')
    expect(dataSql).toContain("variant_type IN ('snv', 'indel')")
  })

  it('sanitizes postgres tsquery search tokens before appending prefix operators', async () => {
    expect(toPrefixTsQueryForTest('BRCA1')).toBe('BRCA1:*')
    expect(toPrefixTsQueryForTest('chr1:1000 A>G')).toBe('chr11000:* & AG:*')
    expect(toPrefixTsQueryForTest('***')).toBe('')
  })

  it('adds STR extension projections for str variant queries', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '5',
              case_id: '1',
              chr: '4',
              pos: '4000',
              ref: 'CAG',
              alt: '<STR>',
              variant_type: 'str',
              _str_repeat_id: 'HTT'
            }
          ]
        })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await repository.queryVariants(
      { case_id: 1, variant_type: 'str' },
      25,
      0,
      undefined,
      false,
      false
    )

    expect(pool.query.mock.calls[1][0]).toContain('variant_str')
    expect(pool.query.mock.calls[1][0]).toContain('_str_repeat_id')
  })

  it('fails filter metadata reads with explicit Phase 7 deferral errors', async () => {
    const repository = new PostgresVariantReadRepository({ query: vi.fn() } as never, 'public')

    await expect(repository.getFilterOptions(1)).rejects.toThrow(
      'PostgreSQL variants:filterOptions is deferred from Phase 7'
    )
    await expect(repository.getColumnMeta({ caseId: 1 }, 'cadd')).rejects.toThrow(
      'PostgreSQL variants:columnMeta is deferred from Phase 7'
    )
  })
})
