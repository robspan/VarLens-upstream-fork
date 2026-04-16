import type { GeneList, GeneListWithCount } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface GeneListsDomainContract {
  list: () => Promise<IpcResult<GeneListWithCount[]>>
  create: (name: string, description?: string | null) => Promise<IpcResult<GeneList>>
  delete: (id: number) => Promise<IpcResult<void>>
  getGenes: (listId: number) => Promise<IpcResult<string[]>>
  setGenes: (listId: number, genes: string[]) => Promise<IpcResult<string[]>>
}
