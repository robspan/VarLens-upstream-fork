import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'

function deferredVariantReadTask(taskType: string): never {
  throw new Error(`${taskType} is not implemented by this storage executor yet`)
}

export class SqliteReadExecutor implements StorageReadExecutor {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly dbPool: DbPool | null
  ) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:query',
            params: [task.params]
          })
        }

        return this.databaseService.cases.queryCases(task.params)

      case 'cases:availableBuilds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:availableBuilds',
            params: []
          })
        }

        return this.databaseService.cases.getAvailableGenomeBuilds()

      case 'case-metadata:get':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:get', params: task.params })
        }

        return this.databaseService.metadata.getCaseMetadata(task.params[0])

      case 'case-metadata:listCohorts':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:listCohorts', params: task.params })
        }

        return this.databaseService.metadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getCohortByName',
            params: task.params
          })
        }

        return this.databaseService.metadata.getCohortGroupByName(task.params[0])

      case 'case-metadata:getCaseCohorts':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getCaseCohorts',
            params: task.params
          })
        }

        return this.databaseService.metadata.getCaseCohorts(task.params[0])

      case 'case-metadata:getHpoTerms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:getHpoTerms', params: task.params })
        }

        return this.databaseService.metadata.getCaseHpoTerms(task.params[0])

      case 'case-metadata:getDataInfo':
        if (this.dbPool !== null) {
          return await this.dbPool.run({ type: 'case-metadata:getDataInfo', params: task.params })
        }

        return this.databaseService.metadata.getCaseDataInfo(task.params[0])

      case 'case-metadata:listExternalIds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:listExternalIds',
            params: task.params
          })
        }

        return this.databaseService.metadata.listCaseExternalIds(task.params[0])

      case 'case-metadata:distinctHpoTerms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctHpoTerms',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctHpoTerms()

      case 'case-metadata:distinctPlatforms':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctPlatforms',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:distinctExternalIdTypes',
            params: task.params
          })
        }

        return this.databaseService.metadata.getDistinctExternalIdTypes()

      case 'case-metadata:getFullMetadata':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'case-metadata:getFullMetadata',
            params: task.params
          })
        }

        return this.databaseService.metadata.getFullCaseMetadata(task.params[0])

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
