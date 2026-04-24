import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'

function deferredVariantReadTask(taskType: string): never {
  throw new Error(`${taskType} is not implemented by this storage executor yet`)
}

interface PostgresReadExecutorRepositories {
  casesQuery: Pick<PostgresCasesQueryRepository, 'queryCases'>
  availableBuilds: Pick<PostgresAvailableBuildsRepository, 'getAvailableGenomeBuilds'>
  caseMetadata: Pick<
    PostgresCaseMetadataRepository,
    | 'getCaseMetadata'
    | 'listCohortGroups'
    | 'getCohortGroupByName'
    | 'getCaseCohorts'
    | 'getCaseHpoTerms'
    | 'getCaseDataInfo'
    | 'listCaseExternalIds'
    | 'getDistinctHpoTerms'
    | 'getDistinctPlatforms'
    | 'getDistinctExternalIdTypes'
    | 'getFullCaseMetadata'
  >
}

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(private readonly repositories: PostgresReadExecutorRepositories) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.repositories.casesQuery.queryCases(task.params)

      case 'cases:availableBuilds':
        return await this.repositories.availableBuilds.getAvailableGenomeBuilds()

      case 'case-metadata:get':
        return await this.repositories.caseMetadata.getCaseMetadata(task.params[0])

      case 'case-metadata:listCohorts':
        return await this.repositories.caseMetadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        return await this.repositories.caseMetadata.getCohortGroupByName(task.params[0])

      case 'case-metadata:getCaseCohorts':
        return await this.repositories.caseMetadata.getCaseCohorts(task.params[0])

      case 'case-metadata:getHpoTerms':
        return await this.repositories.caseMetadata.getCaseHpoTerms(task.params[0])

      case 'case-metadata:getDataInfo':
        return await this.repositories.caseMetadata.getCaseDataInfo(task.params[0])

      case 'case-metadata:listExternalIds':
        return await this.repositories.caseMetadata.listCaseExternalIds(task.params[0])

      case 'case-metadata:distinctHpoTerms':
        return await this.repositories.caseMetadata.getDistinctHpoTerms()

      case 'case-metadata:distinctPlatforms':
        return await this.repositories.caseMetadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        return await this.repositories.caseMetadata.getDistinctExternalIdTypes()

      case 'case-metadata:getFullMetadata':
        return await this.repositories.caseMetadata.getFullCaseMetadata(task.params[0])

      case 'variants:typeCounts':
      case 'variants:typesPresent':
      case 'variants:geneSymbols':
      case 'variants:query':
      case 'variants:filterOptions':
      case 'variants:columnMeta':
        return deferredVariantReadTask(task.type)
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }
}
