import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export type StorageReadTask = {
  type: 'cases:query'
  params: ValidatedCaseSearchParams
}

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
