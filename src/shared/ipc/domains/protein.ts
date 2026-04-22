import type { IpcResult } from '../../types/errors'
import type {
  ProteinMappingResult,
  ProteinDomainResult,
  ProteinStructureResult,
  GeneStructureResult,
  ProteinApiError
} from '../../types/protein'

export interface ProteinDomainContract {
  getMapping: (geneSymbol: string) => Promise<IpcResult<ProteinMappingResult | ProteinApiError>>
  getDomains: (
    uniprotAccession: string
  ) => Promise<IpcResult<ProteinDomainResult | ProteinApiError>>
  getStructure: (
    uniprotAccession: string
  ) => Promise<IpcResult<ProteinStructureResult | ProteinApiError>>
  getGeneStructure: (
    geneSymbol: string
  ) => Promise<IpcResult<GeneStructureResult | ProteinApiError>>
}
