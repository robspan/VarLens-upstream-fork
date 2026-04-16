import { ipcRenderer } from 'electron'
import type { FilterPresetsDomainContract } from '../../shared/ipc/domains/filter-presets'

export function createFilterPresetsApi(): FilterPresetsDomainContract {
  return {
    list: () => ipcRenderer.invoke('presets:list'),
    create: (params) => ipcRenderer.invoke('presets:create', params),
    update: (id, updates) => ipcRenderer.invoke('presets:update', id, updates),
    delete: (id) => ipcRenderer.invoke('presets:delete', id),
    reorder: (items) => ipcRenderer.invoke('presets:reorder', items)
  }
}
