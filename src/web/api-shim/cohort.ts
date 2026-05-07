import type { CohortDomainContract } from '../../shared/ipc/domains/cohort'
import { httpInvoke } from './http-invoke'

export const createCohortApi = (): CohortDomainContract => ({
  getVariants: (params) => httpInvoke('/api/cohort/getVariants', [params]),
  getColumnMeta: () => httpInvoke('/api/cohort/getColumnMeta', []),
  getSummary: () => httpInvoke('/api/cohort/getSummary', []),
  getCarriers: (chr, pos, ref, alt) =>
    httpInvoke('/api/cohort/getCarriers', [chr, pos, ref, alt]),
  getGeneBurden: () => httpInvoke('/api/cohort/getGeneBurden', []),
  getSummaryStatus: () => httpInvoke('/api/cohort/getSummaryStatus', []),
  rebuildSummary: () => httpInvoke('/api/cohort/rebuildSummary', []),
  runAssociation: (config) => httpInvoke('/api/cohort/runAssociation', [config]),
  cancelAssociation: () => httpInvoke('/api/cohort/cancelAssociation', [])
})
