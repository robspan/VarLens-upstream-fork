import type { Tag } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface TagsDomainContract {
  // Tag CRUD
  list: () => Promise<IpcResult<Tag[]>>
  create: (name: string, color: string) => Promise<IpcResult<Tag>>
  update: (id: number, updates: { name?: string; color?: string }) => Promise<IpcResult<Tag>>
  delete: (id: number) => Promise<IpcResult<void>>
  getUsageCount: (tagId: number) => Promise<IpcResult<number>>

  // Variant tag assignments
  getVariantTags: (caseId: number, variantId: number) => Promise<IpcResult<Tag[]>>
  assignVariantTag: (
    caseId: number,
    variantId: number,
    tagId: number
  ) => Promise<IpcResult<void>>
  removeVariantTag: (
    caseId: number,
    variantId: number,
    tagId: number
  ) => Promise<IpcResult<void>>
  setVariantTags: (caseId: number, variantId: number, tagIds: number[]) => Promise<IpcResult<void>>
}
