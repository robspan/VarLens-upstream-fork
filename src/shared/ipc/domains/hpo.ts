import type { HpoSearchResult } from '../../types/api-enrichment'
import type { IpcResult } from '../../types/errors'

export interface HpoDomainContract {
  search: (query: string, maxResults?: number) => Promise<IpcResult<HpoSearchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
}
