import { ipcRenderer } from 'electron'
import type { ProteinDomainContract } from '../../shared/ipc/domains/protein'

export function createProteinApi(): ProteinDomainContract {
  return {
    getMapping: (geneSymbol) => ipcRenderer.invoke('protein:mapping', geneSymbol),
    getDomains: (uniprotAccession) => ipcRenderer.invoke('protein:domains', uniprotAccession),
    getStructure: (uniprotAccession) => ipcRenderer.invoke('protein:structure', uniprotAccession),
    getGeneStructure: (geneSymbol) => ipcRenderer.invoke('protein:gene-structure', geneSymbol)
  }
}
