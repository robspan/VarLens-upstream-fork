import { describe, expect, it, vi } from 'vitest'

import { PostgresReadExecutor } from '../../../src/main/storage/postgres/PostgresReadExecutor'

function workflowRepositories() {
  return {
    tags: {} as never,
    annotations: {} as never,
    commentsMetrics: {} as never,
    panels: {} as never,
    filterPresets: {} as never,
    analysisGroups: {} as never
  }
}

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
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
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
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
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
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
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
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
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
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
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

  it('dispatches variant metadata reads to explicit postgres deferral methods', async () => {
    const variants = {
      getVariantTypeCounts: vi.fn(),
      getVariantTypesPresent: vi.fn(),
      getGeneSymbols: vi.fn(),
      queryVariants: vi.fn(),
      getFilterOptions: vi
        .fn()
        .mockRejectedValue(new Error('PostgreSQL variants:filterOptions is deferred from Phase 7')),
      getColumnMeta: vi
        .fn()
        .mockRejectedValue(new Error('PostgreSQL variants:columnMeta is deferred from Phase 7'))
    }
    const executor = new PostgresReadExecutor({
      casesQuery: {} as never,
      availableBuilds: {} as never,
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
      caseMetadata: {} as never,
      variants
    } as never)

    await expect(executor.execute({ type: 'variants:filterOptions', params: [1] })).rejects.toThrow(
      'PostgreSQL variants:filterOptions is deferred from Phase 7'
    )
    await expect(
      executor.execute({ type: 'variants:columnMeta', params: [{ caseId: 1 }, 'cadd'] })
    ).rejects.toThrow('PostgreSQL variants:columnMeta is deferred from Phase 7')
    expect(variants.getFilterOptions).toHaveBeenCalledWith(1)
    expect(variants.getColumnMeta).toHaveBeenCalledWith({ caseId: 1 }, 'cadd')
  })

  it('dispatches database overview and export reads to postgres repositories', async () => {
    const overview = {
      getOverview: vi.fn().mockResolvedValue({ summary: { total_cases: 0 }, cases: [] })
    }
    const exportedRows = (async function* () {
      yield { id: 1 }
    })()
    const exportRepository = {
      streamVariantRows: vi.fn().mockReturnValue(exportedRows)
    }
    const executor = new PostgresReadExecutor({
      casesQuery: {} as never,
      availableBuilds: {} as never,
      overview,
      export: exportRepository,
      ...workflowRepositories(),
      caseMetadata: {} as never,
      variants: {} as never
    })

    await expect(executor.execute({ type: 'database:overview', params: [] })).resolves.toEqual({
      summary: { total_cases: 0 },
      cases: []
    })
    await expect(
      executor.execute({ type: 'export:variants', params: [{ case_id: 5 }] })
    ).resolves.toBe(exportedRows)

    expect(overview.getOverview).toHaveBeenCalledWith()
    expect(exportRepository.streamVariantRows).toHaveBeenCalledWith({ case_id: 5 })
  })

  it('dispatches workflow reads to postgres workflow repositories', async () => {
    const tags = { listTags: vi.fn().mockResolvedValue([{ id: 1 }]) }
    const panels = { listGeneLists: vi.fn().mockResolvedValue([{ id: 2 }]) }
    const filterPresets = { listPresets: vi.fn().mockResolvedValue([{ id: 3 }]) }
    const executor = new PostgresReadExecutor({
      casesQuery: {} as never,
      availableBuilds: {} as never,
      overview: {} as never,
      export: {} as never,
      ...workflowRepositories(),
      tags,
      panels: panels as never,
      filterPresets,
      caseMetadata: {} as never,
      variants: {} as never
    })

    await expect(executor.execute({ type: 'tags:list', params: [] })).resolves.toEqual([{ id: 1 }])
    await expect(executor.execute({ type: 'gene-lists:list', params: [] })).resolves.toEqual([
      { id: 2 }
    ])
    await expect(executor.execute({ type: 'presets:list', params: [] })).resolves.toEqual([
      { id: 3 }
    ])
  })
})
