import { ipcRenderer } from 'electron'
import { unwrapIpcResult } from '../../shared/types/errors'
import type { CasesAPI, Case, CaseSearchParams, CaseWithCohorts } from '../../shared/types/api'
import type { IpcResult } from '../../shared/types/errors'

function invokeCases<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
}

export function createCasesApi(): Pick<CasesAPI, 'list' | 'query' | 'delete' | 'deleteAll'> {
  return {
    list: async (): Promise<Case[]> => unwrapIpcResult(await invokeCases<Case[]>('cases:list')),
    query: async (
      params: CaseSearchParams
    ): Promise<{ data: CaseWithCohorts[]; total_count: number }> =>
      unwrapIpcResult(
        await invokeCases<{ data: CaseWithCohorts[]; total_count: number }>('cases:query', params)
      ),
    delete: async (id: number): Promise<void> =>
      unwrapIpcResult(await invokeCases<void>('cases:delete', id)),
    deleteAll: async (): Promise<number> =>
      unwrapIpcResult(await invokeCases<number>('cases:deleteAll'))
  }
}
