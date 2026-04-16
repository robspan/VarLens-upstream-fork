import { ipcRenderer } from 'electron'
import type { TagsDomainContract } from '../../shared/ipc/domains/tags'

export function createTagsApi(): TagsDomainContract {
  return {
    list: () => ipcRenderer.invoke('tags:list'),
    create: (name, color) => ipcRenderer.invoke('tags:create', name, color),
    update: (id, updates) => ipcRenderer.invoke('tags:update', id, updates),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
    getUsageCount: (tagId) => ipcRenderer.invoke('tags:getUsageCount', tagId),
    getVariantTags: (caseId, variantId) => ipcRenderer.invoke('tags:getVariantTags', caseId, variantId),
    assignVariantTag: (caseId, variantId, tagId) =>
      ipcRenderer.invoke('tags:assignVariantTag', caseId, variantId, tagId),
    removeVariantTag: (caseId, variantId, tagId) =>
      ipcRenderer.invoke('tags:removeVariantTag', caseId, variantId, tagId),
    setVariantTags: (caseId, variantId, tagIds) =>
      ipcRenderer.invoke('tags:setVariantTags', caseId, variantId, tagIds)
  }
}
