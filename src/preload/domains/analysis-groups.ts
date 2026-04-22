import { ipcRenderer } from 'electron'
import type { AnalysisGroupsDomainContract } from '../../shared/ipc/domains/analysis-groups'

export function createAnalysisGroupsApi(): AnalysisGroupsDomainContract {
  return {
    list: () => ipcRenderer.invoke('analysisGroups:list'),
    get: (id) => ipcRenderer.invoke('analysisGroups:get', id),
    create: (params) => ipcRenderer.invoke('analysisGroups:create', params),
    update: (id, params) => ipcRenderer.invoke('analysisGroups:update', id, params),
    delete: (id) => ipcRenderer.invoke('analysisGroups:delete', id),
    addMember: (params) => ipcRenderer.invoke('analysisGroups:addMember', params),
    removeMember: (groupId, caseId) =>
      ipcRenderer.invoke('analysisGroups:removeMember', groupId, caseId),
    getForCase: (caseId) => ipcRenderer.invoke('analysisGroups:getForCase', caseId)
  }
}
