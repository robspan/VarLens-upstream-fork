import { describe, expect, expectTypeOf, it } from 'vitest'

import type { AvailableBuild } from '../../../src/shared/types/database'
import type { ValidatedCaseSearchParams } from '../../../src/shared/types/ipc-schemas'
import type { StorageReadExecutor, StorageReadTask } from '../../../src/main/storage/read-executor'

describe('StorageReadExecutor contract', () => {
  it('accepts the narrow Phase 4 cases:query task union', () => {
    const params: ValidatedCaseSearchParams = {
      limit: 25,
      offset: 0,
      search_term: undefined,
      cohort_ids: undefined,
      hpo_ids: undefined,
      sort_by: 'created_at',
      sort_order: 'desc'
    }

    const queryTask = {
      type: 'cases:query',
      params
    } satisfies StorageReadTask

    expectTypeOf(queryTask).toMatchTypeOf<StorageReadTask>()
    expectTypeOf<StorageReadExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })

  it('supports cases:availableBuilds as a typed read task', () => {
    const task = {
      type: 'cases:availableBuilds',
      params: []
    } satisfies StorageReadTask

    expectTypeOf(task.params).toEqualTypeOf<[]>()
    expectTypeOf<AvailableBuild>().toEqualTypeOf<{ build: string; caseCount: number }>()
    expectTypeOf<StorageReadExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })

  it('supports case metadata read tasks', () => {
    const tasks = [
      { type: 'case-metadata:get', params: [1] },
      { type: 'case-metadata:listCohorts', params: [] },
      { type: 'case-metadata:getCohortByName', params: ['research'] },
      { type: 'case-metadata:getCaseCohorts', params: [1] },
      { type: 'case-metadata:getHpoTerms', params: [1] },
      { type: 'case-metadata:getDataInfo', params: [1] },
      { type: 'case-metadata:listExternalIds', params: [1] },
      { type: 'case-metadata:distinctHpoTerms', params: [] },
      { type: 'case-metadata:distinctPlatforms', params: [] },
      { type: 'case-metadata:distinctExternalIdTypes', params: [] },
      { type: 'case-metadata:getFullMetadata', params: [1] }
    ] satisfies StorageReadTask[]

    expect(tasks).toHaveLength(11)
  })

  it('supports phase 7 variant read tasks', () => {
    const tasks = [
      { type: 'variants:typeCounts', params: [1] },
      { type: 'variants:typesPresent', params: [{ caseId: 1 }] },
      { type: 'variants:typesPresent', params: [{ caseIds: [1, 2] }] },
      { type: 'variants:geneSymbols', params: [1, 'BR', 20] },
      {
        type: 'variants:query',
        params: [
          { case_id: 1, variant_type: 'snv' },
          25,
          0,
          [{ key: 'pos', order: 'asc' }],
          false,
          true
        ]
      },
      { type: 'variants:filterOptions', params: [1] },
      { type: 'variants:columnMeta', params: [{ caseId: 1 }, 'cadd'] }
    ] satisfies StorageReadTask[]

    expect(tasks).toHaveLength(7)
  })

  it('supports database overview and variant export read tasks', () => {
    const tasks = [
      { type: 'database:overview', params: [] },
      { type: 'export:variants', params: [{ case_id: 1 }] }
    ] satisfies StorageReadTask[]

    expect(tasks).toHaveLength(2)
  })
})
