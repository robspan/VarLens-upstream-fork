import type { DatabaseOverview } from '../../types/database-overview'
import type { IpcResult } from '../../types/errors'

export interface DatabaseInfo {
  path: string
  name: string
  encrypted: boolean
}

export interface DatabaseOpenResult {
  success: boolean
  needsPassword?: boolean
  error?: string
  info?: DatabaseInfo
}

export interface RecentDatabase {
  path: string
  name: string
  lastOpened: number
}

export interface DatabaseActionResult {
  success: boolean
}

export interface DatabaseDomainContract {
  selectFile: () => Promise<string | null>
  selectSaveLocation: (defaultName: string) => Promise<string | null>
  open: (path: string, password?: string) => Promise<IpcResult<DatabaseOpenResult>>
  create: (path: string, password?: string) => Promise<IpcResult<DatabaseOpenResult>>
  rekey: (newPassword: string) => Promise<IpcResult<DatabaseActionResult>>
  info: () => Promise<IpcResult<DatabaseInfo | null>>
  recentList: () => Promise<IpcResult<RecentDatabase[]>>
  getOverview: () => Promise<IpcResult<DatabaseOverview>>
  removeRecent: (path: string) => Promise<IpcResult<DatabaseActionResult>>
  deleteFile: (path: string) => Promise<IpcResult<DatabaseActionResult>>
  showInFolder: (path: string) => Promise<IpcResult<DatabaseActionResult>>
}
