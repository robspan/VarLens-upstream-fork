import type { MyVariantFetchResult } from '../../types/api-enrichment'
import type { IpcResult } from '../../types/errors'

export interface MyvariantDomainContract {
  fetch: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<MyVariantFetchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
}
