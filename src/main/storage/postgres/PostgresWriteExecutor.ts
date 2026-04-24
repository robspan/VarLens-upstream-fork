import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'

type PostgresCaseMetadataWriter = Pick<
  PostgresCaseMetadataRepository,
  | 'upsertCaseMetadata'
  | 'createCohortGroup'
  | 'updateCohortGroup'
  | 'deleteCohortGroup'
  | 'assignCaseCohort'
  | 'removeCaseCohort'
  | 'setCaseCohorts'
  | 'assignCaseHpoTerm'
  | 'removeCaseHpoTerm'
  | 'upsertCaseDataInfo'
  | 'upsertCaseExternalId'
  | 'deleteCaseExternalId'
>

export class PostgresWriteExecutor implements StorageWriteExecutor {
  constructor(private readonly caseMetadata: PostgresCaseMetadataWriter) {}

  async execute(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'case-metadata:upsert':
        return await this.caseMetadata.upsertCaseMetadata(task.params[0], task.params[1])

      case 'case-metadata:createCohort':
        return await this.caseMetadata.createCohortGroup(
          task.params[0].name,
          task.params[0].description
        )

      case 'case-metadata:updateCohort':
        return await this.caseMetadata.updateCohortGroup(task.params[0], task.params[1])

      case 'case-metadata:deleteCohort':
        return await this.caseMetadata.deleteCohortGroup(task.params[0])

      case 'case-metadata:assignCohort':
        return await this.caseMetadata.assignCaseCohort(task.params[0], task.params[1])

      case 'case-metadata:removeCohort':
        return await this.caseMetadata.removeCaseCohort(task.params[0], task.params[1])

      case 'case-metadata:setCohorts':
        return await this.caseMetadata.setCaseCohorts(task.params[0], task.params[1])

      case 'case-metadata:assignHpoTerm':
        return await this.caseMetadata.assignCaseHpoTerm(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:removeHpoTerm':
        return await this.caseMetadata.removeCaseHpoTerm(task.params[0], task.params[1])

      case 'case-metadata:upsertDataInfo':
        return await this.caseMetadata.upsertCaseDataInfo(task.params[0], task.params[1])

      case 'case-metadata:upsertExternalId':
        return await this.caseMetadata.upsertCaseExternalId(
          task.params[0],
          task.params[1],
          task.params[2]
        )

      case 'case-metadata:deleteExternalId':
        return await this.caseMetadata.deleteCaseExternalId(task.params[0], task.params[1])
    }

    const exhaustive: never = task
    throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
  }
}
