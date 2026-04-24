import { describe, expect, it, vi } from 'vitest'

import { PostgresWriteExecutor } from '../../../src/main/storage/postgres/PostgresWriteExecutor'

describe('PostgresWriteExecutor', () => {
  it('routes case metadata write tasks to the postgres repository', async () => {
    const repository = {
      upsertCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
      setCaseCohorts: vi.fn().mockResolvedValue(undefined),
      deleteCaseExternalId: vi.fn().mockResolvedValue(undefined)
    }
    const executor = new PostgresWriteExecutor(repository as never)

    await executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
    await executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
    await executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })

    expect(repository.upsertCaseMetadata).toHaveBeenCalledWith(1, { sex: 'female' })
    expect(repository.setCaseCohorts).toHaveBeenCalledWith(1, [2, 3])
    expect(repository.deleteCaseExternalId).toHaveBeenCalledWith(1, 'MRN')
  })
})
