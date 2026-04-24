import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'
import type { PostgresVariantReadRepository } from './PostgresVariantReadRepository'

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
  variants: Pick<
    PostgresVariantReadRepository,
    | 'getVariantTypeCounts'
    | 'getVariantTypesPresent'
    | 'getGeneSymbols'
    | 'queryVariants'
    | 'getFilterOptions'
    | 'getColumnMeta'
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
        return await this.repositories.variants.getVariantTypeCounts(task.params[0])

      case 'variants:typesPresent':
        return await this.repositories.variants.getVariantTypesPresent(task.params[0])

      case 'variants:geneSymbols':
        return await this.repositories.variants.getGeneSymbols(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'variants:query':
        return await this.repositories.variants.queryVariants(...task.params)

      case 'variants:filterOptions':
        return await this.repositories.variants.getFilterOptions(task.params[0])

      case 'variants:columnMeta':
        return await this.repositories.variants.getColumnMeta(task.params[0], task.params[1])
    }

    const _exhaustive: never = task
    throw new Error(`Unhandled read task: ${JSON.stringify(_exhaustive)}`)
  }
}
