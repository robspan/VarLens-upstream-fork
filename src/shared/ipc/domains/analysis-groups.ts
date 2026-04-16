import type { AnalysisGroup, AnalysisGroupMember } from '../../types/api'
import type { IpcResult } from '../../types/errors'

export interface AnalysisGroupsDomainContract {
  list: () => Promise<IpcResult<AnalysisGroup[]>>
  get: (id: number) => Promise<IpcResult<AnalysisGroup & { members: AnalysisGroupMember[] }>>
  create: (params: {
    name: string
    groupType?: string
    description?: string
  }) => Promise<IpcResult<AnalysisGroup>>
  update: (
    id: number,
    params: { name?: string; description?: string }
  ) => Promise<IpcResult<AnalysisGroup>>
  delete: (id: number) => Promise<IpcResult<void>>
  addMember: (params: {
    groupId: number
    caseId: number
    role: string
    affectedStatus?: string
    individualId?: string
  }) => Promise<IpcResult<AnalysisGroupMember>>
  removeMember: (groupId: number, caseId: number) => Promise<IpcResult<void>>
  getForCase: (caseId: number) => Promise<IpcResult<AnalysisGroup | null>>
}
