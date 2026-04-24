import { describe, expect, it, vi } from 'vitest'

import { PostgresReadExecutor } from '../../../src/main/storage/postgres/PostgresReadExecutor'

describe('PostgresReadExecutor', () => {
  it('dispatches cases:query to the postgres cases query repository', async () => {
    const expected = { data: [], total_count: 0 }
    const casesQuery = {
      queryCases: vi.fn().mockResolvedValue(expected)
    }
    const params = {
      limit: 25,
      offset: 0,
      sort_by: 'created_at' as const,
      sort_order: 'desc' as const
    }
    const executor = new PostgresReadExecutor(casesQuery)

    await expect(executor.execute({ type: 'cases:query', params })).resolves.toBe(expected)
    expect(casesQuery.queryCases).toHaveBeenCalledWith(params)
  })
})
