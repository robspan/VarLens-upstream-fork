import { describe, expect, it, vi } from 'vitest'

import { PostgresWriteExecutor } from '../../../src/main/storage/postgres/PostgresWriteExecutor'

describe('PostgresWriteExecutor', () => {
  it('routes case metadata write tasks to the postgres repository', async () => {
    const repository = {
      upsertCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
      createCohortGroup: vi.fn(),
      updateCohortGroup: vi.fn(),
      deleteCohortGroup: vi.fn(),
      assignCaseCohort: vi.fn(),
      removeCaseCohort: vi.fn(),
      setCaseCohorts: vi.fn().mockResolvedValue(undefined),
      assignCaseHpoTerm: vi.fn(),
      removeCaseHpoTerm: vi.fn(),
      upsertCaseDataInfo: vi.fn(),
      upsertCaseExternalId: vi.fn(),
      deleteCaseExternalId: vi.fn().mockResolvedValue(undefined)
    }
    const caseLifecycle = {
      deleteCase: vi.fn()
    }
    const executor = new PostgresWriteExecutor(repository, caseLifecycle)

    await executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
    await executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
    await executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })

    expect(repository.upsertCaseMetadata).toHaveBeenCalledWith(1, { sex: 'female' })
    expect(repository.setCaseCohorts).toHaveBeenCalledWith(1, [2, 3])
    expect(repository.deleteCaseExternalId).toHaveBeenCalledWith(1, 'MRN')
  })

  it('routes cases:delete to the postgres case lifecycle repository', async () => {
    const caseMetadata = {
      upsertCaseMetadata: vi.fn(),
      createCohortGroup: vi.fn(),
      updateCohortGroup: vi.fn(),
      deleteCohortGroup: vi.fn(),
      assignCaseCohort: vi.fn(),
      removeCaseCohort: vi.fn(),
      setCaseCohorts: vi.fn(),
      assignCaseHpoTerm: vi.fn(),
      removeCaseHpoTerm: vi.fn(),
      upsertCaseDataInfo: vi.fn(),
      upsertCaseExternalId: vi.fn(),
      deleteCaseExternalId: vi.fn()
    }
    const caseLifecycle = {
      deleteCase: vi.fn().mockResolvedValue(undefined)
    }
    const executor = new PostgresWriteExecutor(caseMetadata, caseLifecycle)

    await executor.execute({ type: 'cases:delete', params: [7] })

    expect(caseLifecycle.deleteCase).toHaveBeenCalledWith(7)
  })
})
