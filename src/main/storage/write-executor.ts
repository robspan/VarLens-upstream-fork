import type {
  CohortCreateParams,
  CohortUpdateParams,
  DataInfoUpdates,
  MetadataUpdates
} from './case-metadata-types'

export type StorageWriteTask =
  | { type: 'cases:delete'; params: [caseId: number] }
  | { type: 'case-metadata:upsert'; params: [caseId: number, updates: MetadataUpdates] }
  | { type: 'case-metadata:createCohort'; params: [params: CohortCreateParams] }
  | {
      type: 'case-metadata:updateCohort'
      params: [cohortId: number, updates: CohortUpdateParams]
    }
  | { type: 'case-metadata:deleteCohort'; params: [cohortId: number] }
  | { type: 'case-metadata:assignCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:removeCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:setCohorts'; params: [caseId: number, cohortIds: number[]] }
  | {
      type: 'case-metadata:assignHpoTerm'
      params: [caseId: number, hpoId: string, hpoLabel: string]
    }
  | { type: 'case-metadata:removeHpoTerm'; params: [caseId: number, hpoId: string] }
  | { type: 'case-metadata:upsertDataInfo'; params: [caseId: number, updates: DataInfoUpdates] }
  | {
      type: 'case-metadata:upsertExternalId'
      params: [caseId: number, idType: string, idValue: string]
    }
  | { type: 'case-metadata:deleteExternalId'; params: [caseId: number, idType: string] }

export interface StorageWriteExecutor {
  execute(task: StorageWriteTask): Promise<unknown>
}
