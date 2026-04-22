import { ipcRenderer } from 'electron'
import type { VariantsDomainContract } from '../../shared/ipc/domains/variants'

export function createVariantsApi(): VariantsDomainContract {
  return {
    query: (caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount) =>
      ipcRenderer.invoke(
        'variants:query',
        caseId,
        filters,
        offset,
        limit,
        sortBy,
        skipCount,
        includeUnfilteredCount
      ),
    getFilterOptions: (caseId) => ipcRenderer.invoke('variants:filterOptions', caseId),
    search: (caseId, query, limit) => ipcRenderer.invoke('variants:search', caseId, query, limit),
    geneSymbols: (caseId, query, limit) =>
      ipcRenderer.invoke('variants:geneSymbols', caseId, query, limit),
    typeCounts: (caseId) => ipcRenderer.invoke('variants:typeCounts', caseId),
    columnMeta: (payload) => ipcRenderer.invoke('variants:columnMeta', payload),
    typesPresent: (payload) => ipcRenderer.invoke('variants:typesPresent', payload)
  }
}
