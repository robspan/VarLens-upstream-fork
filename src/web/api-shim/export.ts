import type { ExportDomainContract } from '../../shared/ipc/domains/export'
import { httpInvoke } from './http-invoke'

export const createExportApi = (): ExportDomainContract => ({
  variants: (caseId, filters, caseName) =>
    httpInvoke('/api/export/variants', [caseId, filters, caseName]),
  cohort: (params) => httpInvoke('/api/export/cohort', [params])
})
