import { ipcRenderer } from 'electron'
import type { CaseCommentsDomainContract } from '../../shared/ipc/domains/case-comments'

export function createCaseCommentsApi(): CaseCommentsDomainContract {
  return {
    list: (caseId) => ipcRenderer.invoke('case-comments:list', caseId),
    create: (caseId, category, content) =>
      ipcRenderer.invoke('case-comments:create', caseId, category, content),
    update: (commentId, content) => ipcRenderer.invoke('case-comments:update', commentId, content),
    delete: (commentId) => ipcRenderer.invoke('case-comments:delete', commentId)
  }
}
