import { ipcRenderer } from 'electron'
import type { GnomadDomainContract } from '../../shared/ipc/domains/gnomad'

export function createGnomadApi(): GnomadDomainContract {
  return {
    getVariants: (geneSymbol, dataset) =>
      ipcRenderer.invoke('gnomad:variants', geneSymbol, dataset),
    getClinVarVariants: (geneSymbol, dataset) =>
      ipcRenderer.invoke('gnomad:clinvar', geneSymbol, dataset)
  }
}
