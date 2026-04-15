import type { Case, CaseSearchParams, CaseWithCohorts } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface CasesDomainContract {
  list: () => Promise<IpcResult<Case[]>>
  query: (
    params: CaseSearchParams
  ) => Promise<IpcResult<{ data: CaseWithCohorts[]; total_count: number }>>
  delete: (id: number) => Promise<IpcResult<void>>
  deleteAll: () => Promise<IpcResult<number>>
}
