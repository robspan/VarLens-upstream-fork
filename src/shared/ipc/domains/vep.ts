import type { IpcResult } from '../../types/errors'
import type { VepFetchResult, CacheSizeInfo } from '../../types/api-enrichment'

export interface VepDomainContract {
  fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<IpcResult<VepFetchResult>>
  cancel: () => Promise<IpcResult<void>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
  getCacheStats: () => Promise<IpcResult<CacheSizeInfo>>
}
