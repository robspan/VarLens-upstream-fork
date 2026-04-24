import { describe, expect, it, vi } from 'vitest'

import { PostgresReadExecutor } from '../../../src/main/storage/postgres/PostgresReadExecutor'

describe('PostgresReadExecutor', () => {
  it('dispatches cases:query to the postgres cases query repository', async () => {
    const expected = { data: [], total_count: 0 }
    const casesQuery = {
      queryCases: vi.fn().mockResolvedValue(expected)
    }
    const availableBuilds = {
      getAvailableGenomeBuilds: vi.fn()
    }
    const params = {
      limit: 25,
      offset: 0,
      sort_by: 'created_at' as const,
      sort_order: 'desc' as const
    }
    const executor = new PostgresReadExecutor({
      casesQuery,
      availableBuilds,
      caseMetadata: {} as never
    })

    await expect(executor.execute({ type: 'cases:query', params })).resolves.toBe(expected)
    expect(casesQuery.queryCases).toHaveBeenCalledWith(params)
    expect(availableBuilds.getAvailableGenomeBuilds).not.toHaveBeenCalled()
  })

  it('dispatches cases:availableBuilds to the postgres available-builds repository', async () => {
    const expected = [{ build: 'GRCh38', caseCount: 2 }]
    const casesQuery = {
      queryCases: vi.fn()
    }
    const availableBuilds = {
      getAvailableGenomeBuilds: vi.fn().mockResolvedValue(expected)
    }
    const executor = new PostgresReadExecutor({
      casesQuery,
      availableBuilds,
      caseMetadata: {} as never
    })

    await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
      expected
    )
    expect(availableBuilds.getAvailableGenomeBuilds).toHaveBeenCalledWith()
    expect(casesQuery.queryCases).not.toHaveBeenCalled()
  })

  it('routes case metadata read tasks to the postgres repository', async () => {
    const caseMetadata = {
      getCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
      listCohortGroups: vi.fn().mockResolvedValue([]),
      getFullCaseMetadata: vi.fn().mockResolvedValue({
        metadata: null,
        cohorts: [],
        hpoTerms: [],
        comments: [],
        metrics: [],
        dataInfo: null,
        externalIds: []
      })
    }
    const executor = new PostgresReadExecutor({
      casesQuery: {} as never,
      availableBuilds: {} as never,
      caseMetadata: caseMetadata as never
    })

    await executor.execute({ type: 'case-metadata:get', params: [1] })
    await executor.execute({ type: 'case-metadata:listCohorts', params: [] })
    await executor.execute({ type: 'case-metadata:getFullMetadata', params: [1] })

    expect(caseMetadata.getCaseMetadata).toHaveBeenCalledWith(1)
    expect(caseMetadata.listCohortGroups).toHaveBeenCalledWith()
    expect(caseMetadata.getFullCaseMetadata).toHaveBeenCalledWith(1)
  })

  it('dispatches variant small reads to the postgres variant repository', async () => {
    const variants = {
      getVariantTypeCounts: vi.fn().mockResolvedValue({ snv: 2 }),
      getVariantTypesPresent: vi.fn().mockResolvedValue(['snv']),
      getGeneSymbols: vi.fn().mockResolvedValue(['BRCA1'])
    }
    const casesQuery = { queryCases: vi.fn() }
    const availableBuilds = { getAvailableGenomeBuilds: vi.fn() }
    const caseMetadata = {
      getCaseMetadata: vi.fn(),
      listCohortGroups: vi.fn(),
      getCohortGroupByName: vi.fn(),
      getCaseCohorts: vi.fn(),
      getCaseHpoTerms: vi.fn(),
      getCaseDataInfo: vi.fn(),
      listCaseExternalIds: vi.fn(),
      getDistinctHpoTerms: vi.fn(),
      getDistinctPlatforms: vi.fn(),
      getDistinctExternalIdTypes: vi.fn(),
      getFullCaseMetadata: vi.fn()
    }
    const executor = new PostgresReadExecutor({
      casesQuery,
      availableBuilds,
      caseMetadata,
      variants
    } as never)

    await expect(
      executor.execute({ type: 'variants:typeCounts', params: [1] })
    ).resolves.toStrictEqual({ snv: 2 })
    await expect(
      executor.execute({ type: 'variants:typesPresent', params: [{ caseId: 1 }] })
    ).resolves.toStrictEqual(['snv'])
    await expect(
      executor.execute({ type: 'variants:geneSymbols', params: [1, 'BR', 20] })
    ).resolves.toStrictEqual(['BRCA1'])
  })

  it('dispatches variant query reads to the postgres variant repository', async () => {
    const variants = {
      getVariantTypeCounts: vi.fn(),
      getVariantTypesPresent: vi.fn(),
      getGeneSymbols: vi.fn(),
      queryVariants: vi.fn().mockResolvedValue({ data: [], total_count: 0 })
    }
    const executor = new PostgresReadExecutor({
      casesQuery: {} as never,
      availableBuilds: {} as never,
      caseMetadata: {} as never,
      variants
    } as never)

    await expect(
      executor.execute({
        type: 'variants:query',
        params: [{ case_id: 1 }, 25, 0, undefined, false, true]
      })
    ).resolves.toStrictEqual({ data: [], total_count: 0 })
    expect(variants.queryVariants).toHaveBeenCalledWith(
      { case_id: 1 },
      25,
      0,
      undefined,
      false,
      true
    )
  })
})
