import { describe, expect, it, vi } from 'vitest'

import { PostgresCasesQueryRepository } from '../../../src/main/storage/postgres/PostgresCasesQueryRepository'

describe('PostgresCasesQueryRepository', () => {
  it('queries cases with cohorts, metadata, pagination, and total count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '3',
              name: 'Newest Case',
              file_path: '/data/newest.vcf.gz',
              file_size: '4096',
              variant_count: '42',
              created_at: '1714060802000',
              genome_build: 'GRCh38',
              affected_status: 'affected',
              sex: 'female',
              cohort_names: ['rare disease'],
              cohort_ids: ['7']
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [{ total_count: 12 }]
        })
    }
    const repository = new PostgresCasesQueryRepository(pool as never, 'phase4_cases')

    const result = await repository.queryCases({
      limit: 10,
      offset: 20,
      search_term: 'new',
      sort_by: 'name',
      sort_order: 'asc'
    })

    expect(result).toStrictEqual({
      data: [
        {
          id: 3,
          name: 'Newest Case',
          file_path: '/data/newest.vcf.gz',
          file_size: 4096,
          variant_count: 42,
          created_at: 1714060802000,
          genome_build: 'GRCh38',
          affected_status: 'affected',
          sex: 'female',
          cohort_names: ['rare disease'],
          cohort_ids: [7]
        }
      ],
      total_count: 12
    })
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM "phase4_cases"."cases" c'),
      ['%new%', 10, 20]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('COUNT(*)::int AS total_count'),
      ['%new%']
    )
  })

  it('rejects unsupported cohort filtering explicitly', async () => {
    const repository = new PostgresCasesQueryRepository({ query: vi.fn() } as never, 'public')

    await expect(
      repository.queryCases({
        limit: 25,
        offset: 0,
        cohort_ids: [1]
      })
    ).rejects.toThrow('cohort_ids filtering is not implemented for postgres sessions in Phase 4')
  })

  it('rejects unsupported HPO filtering explicitly', async () => {
    const repository = new PostgresCasesQueryRepository({ query: vi.fn() } as never, 'public')

    await expect(
      repository.queryCases({
        limit: 25,
        offset: 0,
        hpo_ids: ['HP:0001250']
      })
    ).rejects.toThrow('hpo_ids filtering is not implemented for postgres sessions in Phase 4')
  })
})
