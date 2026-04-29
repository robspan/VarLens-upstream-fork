import type { SortItem, VariantFilter } from '../../shared/types/database'
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
  | { type: 'variants:typeCounts'; params: [caseId: number] }
  | {
      type: 'variants:typesPresent'
      params: [scope: { caseId: number } | { caseIds: number[] }]
    }
  | { type: 'variants:geneSymbols'; params: [caseId: number, query: string, limit: number] }
  | {
      type: 'variants:query'
      params: [
        filter: VariantFilter,
        limit: number,
        offset: number,
        sortBy: SortItem[] | undefined,
        skipCount: boolean,
        includeUnfilteredCount: boolean
      ]
    }
  | { type: 'variants:filterOptions'; params: [caseId: number] }
  | {
      type: 'variants:columnMeta'
      params: [scope: { caseId: number } | { caseIds: number[] }, columnKey: string]
    }
  | { type: 'database:overview'; params: [] }
  | { type: 'export:variants'; params: [filter: VariantFilter] }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
