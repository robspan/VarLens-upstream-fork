import { ipcRenderer } from 'electron'
import type { GeneListsDomainContract } from '../../shared/ipc/domains/gene-lists'

export function createGeneListsApi(): GeneListsDomainContract {
  return {
    list: () => ipcRenderer.invoke('gene-lists:list'),
    create: (name, description) => ipcRenderer.invoke('gene-lists:create', name, description),
    delete: (id) => ipcRenderer.invoke('gene-lists:delete', id),
    getGenes: (listId) => ipcRenderer.invoke('gene-lists:getGenes', listId),
    setGenes: (listId, genes) => ipcRenderer.invoke('gene-lists:setGenes', listId, genes)
  }
}
