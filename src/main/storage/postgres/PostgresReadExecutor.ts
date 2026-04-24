import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(private readonly casesQuery: Pick<PostgresCasesQueryRepository, 'queryCases'>) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.casesQuery.queryCases(task.params)
    }
  }
}
