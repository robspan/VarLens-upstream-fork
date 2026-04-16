import type { SpliceAIFetchResult } from '../../types/api-enrichment'
import type { IpcResult } from '../../types/errors'

export interface SpliceaiDomainContract {
  fetch: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<SpliceAIFetchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
}
