import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  StorageWriteExecutor,
  StorageWriteTask
} from '../../../src/main/storage/write-executor'

describe('StorageWriteExecutor contract', () => {
  it('supports case metadata write tasks', () => {
    const tasks = [
      {
        type: 'case-metadata:upsert',
        params: [1, { affected_status: 'affected', age: 42, date_of_birth: '1984-01-02' }]
      },
      { type: 'case-metadata:createCohort', params: [{ name: 'research', description: null }] },
      { type: 'case-metadata:updateCohort', params: [2, { name: 'updated' }] },
      { type: 'case-metadata:deleteCohort', params: [2] },
      { type: 'case-metadata:assignCohort', params: [1, 2] },
      { type: 'case-metadata:removeCohort', params: [1, 2] },
      { type: 'case-metadata:setCohorts', params: [1, [2, 3]] },
      { type: 'case-metadata:assignHpoTerm', params: [1, 'HP:0001250', 'Seizure'] },
      { type: 'case-metadata:removeHpoTerm', params: [1, 'HP:0001250'] },
      { type: 'case-metadata:upsertDataInfo', params: [1, { platform: 'WGS' }] },
      { type: 'case-metadata:upsertExternalId', params: [1, 'MRN', '12345'] },
      { type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] }
    ] satisfies StorageWriteTask[]

    expect(tasks).toHaveLength(12)
    expectTypeOf<StorageWriteExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })
})
