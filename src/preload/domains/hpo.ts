import { ipcRenderer } from 'electron'
import type { HpoDomainContract } from '../../shared/ipc/domains/hpo'

export function createHpoApi(): HpoDomainContract {
  return {
    search: (query, maxResults) => ipcRenderer.invoke('hpo:search', query, maxResults),
    clearCache: () => ipcRenderer.invoke('hpo:clearCache')
  }
}
