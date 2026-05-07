import type { TagsDomainContract } from '../../shared/ipc/domains/tags'
import { httpInvoke } from './http-invoke'

export const createTagsApi = (): TagsDomainContract => ({
  list: () => httpInvoke('/api/tags/list', []),
  create: (name, color) => httpInvoke('/api/tags/create', [name, color]),
  update: (id, updates) => httpInvoke('/api/tags/update', [id, updates]),
  delete: (id) => httpInvoke('/api/tags/delete', [id]),
  getUsageCount: (tagId) => httpInvoke('/api/tags/getUsageCount', [tagId]),
  getVariantTags: (caseId, variantId) =>
    httpInvoke('/api/tags/getVariantTags', [caseId, variantId]),
  assignVariantTag: (caseId, variantId, tagId) =>
    httpInvoke('/api/tags/assignVariantTag', [caseId, variantId, tagId]),
  removeVariantTag: (caseId, variantId, tagId) =>
    httpInvoke('/api/tags/removeVariantTag', [caseId, variantId, tagId]),
  setVariantTags: (caseId, variantId, tagIds) =>
    httpInvoke('/api/tags/setVariantTags', [caseId, variantId, tagIds])
})
