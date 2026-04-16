import { ipcRenderer } from 'electron'
import type { MyvariantDomainContract } from '../../shared/ipc/domains/myvariant'

export function createMyvariantApi(): MyvariantDomainContract {
  return {
    fetch: (chr, pos, ref, alt) =>
      ipcRenderer.invoke('myvariant:fetch', chr, pos, ref, alt),
    clearCache: () => ipcRenderer.invoke('myvariant:clearCache')
  }
}
