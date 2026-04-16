import type { CaseComment, CommentCategory } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface CaseCommentsDomainContract {
  list: (caseId: number) => Promise<IpcResult<CaseComment[]>>
  create: (
    caseId: number,
    category: CommentCategory,
    content: string
  ) => Promise<IpcResult<CaseComment>>
  update: (commentId: number, content: string) => Promise<IpcResult<CaseComment>>
  delete: (commentId: number) => Promise<IpcResult<void>>
}
