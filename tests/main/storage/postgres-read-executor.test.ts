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
})
