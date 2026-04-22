import type { RegionFile } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface RegionFilesDomainContract {
  list: () => Promise<IpcResult<RegionFile[]>>
  create: (name: string, description: string | null) => Promise<IpcResult<RegionFile>>
  delete: (id: number) => Promise<IpcResult<void>>
  importBed: (fileId: number, filePath: string) => Promise<IpcResult<RegionFile>>
}
