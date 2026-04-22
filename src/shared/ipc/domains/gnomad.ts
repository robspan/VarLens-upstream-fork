import type { GnomadFetchResult, ClinVarFetchResult, ProteinApiError } from '../../types/protein'
import type { IpcResult } from '../../types/errors'

export interface GnomadDomainContract {
  getVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<IpcResult<GnomadFetchResult | ProteinApiError>>
  getClinVarVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<IpcResult<ClinVarFetchResult | ProteinApiError>>
}
