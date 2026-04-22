import { ipcRenderer } from 'electron'
import type { CaseMetricsDomainContract } from '../../shared/ipc/domains/case-metrics'

export function createCaseMetricsApi(): CaseMetricsDomainContract {
  return {
    listDefinitions: () => ipcRenderer.invoke('case-metrics:listDefinitions'),
    createDefinition: (name, valueType, unit, category) =>
      ipcRenderer.invoke('case-metrics:createDefinition', name, valueType, unit, category),
    listForCase: (caseId) => ipcRenderer.invoke('case-metrics:listForCase', caseId),
    upsert: (caseId, metricId, value) =>
      ipcRenderer.invoke('case-metrics:upsert', caseId, metricId, value),
    delete: (caseId, metricId) => ipcRenderer.invoke('case-metrics:delete', caseId, metricId)
  }
}
