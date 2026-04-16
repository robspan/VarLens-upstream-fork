import type { MetricDefinition, CaseMetricWithDefinition, CaseMetric } from '../../types/database'
import type { MetricValue } from '../../types/api'
import type { IpcResult } from '../../types/errors'

export interface CaseMetricsDomainContract {
  listDefinitions: () => Promise<IpcResult<MetricDefinition[]>>
  createDefinition: (
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ) => Promise<IpcResult<MetricDefinition>>
  listForCase: (caseId: number) => Promise<IpcResult<CaseMetricWithDefinition[]>>
  upsert: (caseId: number, metricId: number, value: MetricValue) => Promise<IpcResult<CaseMetric>>
  delete: (caseId: number, metricId: number) => Promise<IpcResult<void>>
}
