import { ipcRenderer } from 'electron'
import type { SpliceaiDomainContract } from '../../shared/ipc/domains/spliceai'

export function createSpliceaiApi(): SpliceaiDomainContract {
  return {
    fetch: (chr, pos, ref, alt) => ipcRenderer.invoke('spliceai:fetch', chr, pos, ref, alt),
    clearCache: () => ipcRenderer.invoke('spliceai:clearCache')
  }
}
