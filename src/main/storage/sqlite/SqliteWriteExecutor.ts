import type { DatabaseService } from '../../database/DatabaseService'
import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'

export class SqliteWriteExecutor implements StorageWriteExecutor {
  constructor(private readonly databaseService: DatabaseService) {}

  async execute(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:delete':
        this.databaseService.cases.deleteCase(task.params[0])
        return undefined

      case 'case-metadata:upsert':
        return this.databaseService.metadata.upsertCaseMetadata(task.params[0], task.params[1])

      case 'case-metadata:createCohort':
        return this.databaseService.metadata.createCohortGroup(
          task.params[0].name,
          task.params[0].description
        )

      case 'case-metadata:updateCohort':
        return this.databaseService.metadata.updateCohortGroup(task.params[0], task.params[1])

      case 'case-metadata:deleteCohort':
        this.databaseService.metadata.deleteCohortGroup(task.params[0])
        return undefined

      case 'case-metadata:assignCohort':
        this.databaseService.metadata.assignCaseCohort(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:removeCohort':
        this.databaseService.metadata.removeCaseCohort(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:setCohorts':
        this.databaseService.metadata.setCaseCohorts(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:assignHpoTerm':
        return this.databaseService.metadata.assignCaseHpoTerm(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:removeHpoTerm':
        this.databaseService.metadata.removeCaseHpoTerm(task.params[0], task.params[1])
        return undefined

      case 'case-metadata:upsertDataInfo':
        return this.databaseService.metadata.upsertCaseDataInfo(task.params[0], task.params[1])

      case 'case-metadata:upsertExternalId':
        return this.databaseService.metadata.upsertCaseExternalId(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:deleteExternalId':
        this.databaseService.metadata.deleteCaseExternalId(task.params[0], task.params[1])
        return undefined
    }

    const exhaustive: never = task
    throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
  }
}
