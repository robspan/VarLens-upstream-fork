import type { GeneRefInfo, AssemblyInfo, GeneRefCheckUpdatesResult, GeneRefUpdateResult } from '../../types/api'
import type { IpcResult } from '../../types/errors'

export interface GeneRefDomainContract {
  info: () => Promise<IpcResult<GeneRefInfo>>
  assemblies: () => Promise<IpcResult<AssemblyInfo[]>>
  checkUpdates: () => Promise<IpcResult<GeneRefCheckUpdatesResult>>
  update: () => Promise<IpcResult<GeneRefUpdateResult>>
}
