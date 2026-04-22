import { ipcRenderer } from 'electron'
import type { RegionFilesDomainContract } from '../../shared/ipc/domains/region-files'

export function createRegionFilesApi(): RegionFilesDomainContract {
  return {
    list: () => ipcRenderer.invoke('region-files:list'),
    create: (name, description) => ipcRenderer.invoke('region-files:create', name, description),
    delete: (id) => ipcRenderer.invoke('region-files:delete', id),
    importBed: (fileId, filePath) => ipcRenderer.invoke('region-files:importBed', fileId, filePath)
  }
}
