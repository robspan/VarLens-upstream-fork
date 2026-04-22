import { ipcRenderer } from 'electron'
import type { CohortDomainContract } from '../../shared/ipc/domains/cohort'

export function createCohortApi(): CohortDomainContract {
  return {
    getVariants: (params) => ipcRenderer.invoke('cohort:variants', params),
    getColumnMeta: () => ipcRenderer.invoke('cohort:columnMeta'),
    getSummary: () => ipcRenderer.invoke('cohort:summary'),
    getCarriers: (chr, pos, ref, alt) => ipcRenderer.invoke('cohort:carriers', chr, pos, ref, alt),
    getGeneBurden: () => ipcRenderer.invoke('cohort:geneBurden'),
    getSummaryStatus: () => ipcRenderer.invoke('cohort:summaryStatus'),
    rebuildSummary: () => ipcRenderer.invoke('cohort:rebuildSummary'),
    runAssociation: (config) => ipcRenderer.invoke('cohort:geneBurdenCompare', config),
    cancelAssociation: () => ipcRenderer.invoke('cohort:geneBurdenCancel')
  }
}
