import { ipcRenderer } from 'electron'
import type { VepDomainContract } from '../../shared/ipc/domains/vep'

export function createVepApi(): VepDomainContract {
  return {
    fetch: (chr, pos, ref, alt) => ipcRenderer.invoke('vep:fetch', chr, pos, ref, alt),
    cancel: () => ipcRenderer.invoke('vep:cancel'),
    clearCache: () => ipcRenderer.invoke('vep:clearCache'),
    getCacheStats: () => ipcRenderer.invoke('vep:getCacheStats')
  }
}
