import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export type { AvailableBuild } from '../../shared/types/database'

export type StorageReadTask =
  | {
      type: 'cases:query'
      params: ValidatedCaseSearchParams
    }
  | {
      type: 'cases:availableBuilds'
      params: []
    }
  | { type: 'case-metadata:get'; params: [caseId: number] }
  | { type: 'case-metadata:listCohorts'; params: [] }
  | { type: 'case-metadata:getCohortByName'; params: [name: string] }
  | { type: 'case-metadata:getCaseCohorts'; params: [caseId: number] }
  | { type: 'case-metadata:getHpoTerms'; params: [caseId: number] }
  | { type: 'case-metadata:getDataInfo'; params: [caseId: number] }
  | { type: 'case-metadata:listExternalIds'; params: [caseId: number] }
  | { type: 'case-metadata:distinctHpoTerms'; params: [] }
  | { type: 'case-metadata:distinctPlatforms'; params: [] }
  | { type: 'case-metadata:distinctExternalIdTypes'; params: [] }
  | { type: 'case-metadata:getFullMetadata'; params: [caseId: number] }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
