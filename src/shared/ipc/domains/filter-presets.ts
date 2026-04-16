import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetUpdate
} from '../../types/filter-presets'
import type { IpcResult } from '../../types/errors'

export interface FilterPresetReorderItem {
  id: number
  sortOrder: number
}

export interface FilterPresetsDomainContract {
  list: () => Promise<IpcResult<FilterPreset[]>>
  create: (params: FilterPresetCreate) => Promise<IpcResult<FilterPreset>>
  update: (id: number, updates: FilterPresetUpdate) => Promise<IpcResult<FilterPreset>>
  delete: (id: number) => Promise<IpcResult<void>>
  reorder: (items: FilterPresetReorderItem[]) => Promise<IpcResult<void>>
}
