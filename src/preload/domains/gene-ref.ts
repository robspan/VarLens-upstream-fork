import { ipcRenderer } from 'electron'
import type { GeneRefDomainContract } from '../../shared/ipc/domains/gene-ref'

export function createGeneRefApi(): GeneRefDomainContract {
  return {
    info: () => ipcRenderer.invoke('gene-ref:info'),
    assemblies: () => ipcRenderer.invoke('gene-ref:assemblies'),
    checkUpdates: () => ipcRenderer.invoke('gene-ref:check-updates'),
    update: () => ipcRenderer.invoke('gene-ref:update')
  }
}
