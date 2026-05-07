import type { VariantsDomainContract } from '../../shared/ipc/domains/variants'
import { httpInvoke } from './http-invoke'

export const createVariantsApi = (): VariantsDomainContract => ({
  query: (caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount) =>
    httpInvoke('/api/variants/query', [
      caseId,
      filters,
      offset,
      limit,
      sortBy,
      skipCount,
      includeUnfilteredCount
    ]),
  getFilterOptions: (caseId) => httpInvoke('/api/variants/getFilterOptions', [caseId]),
  search: (caseId, query, limit) => httpInvoke('/api/variants/search', [caseId, query, limit]),
  geneSymbols: (caseId, query, limit) =>
    httpInvoke('/api/variants/geneSymbols', [caseId, query, limit]),
  typeCounts: (caseId) => httpInvoke('/api/variants/typeCounts', [caseId]),
  columnMeta: (payload) => httpInvoke('/api/variants/columnMeta', [payload]),
  typesPresent: (payload) => httpInvoke('/api/variants/typesPresent', [payload])
})
