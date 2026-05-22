import {
  CaseMetricInvokeBodySchemas,
  CaseMetricSchema,
  CaseMetricWithDefinitionListResponseSchema,
  MetricDefinitionListResponseSchema,
  MetricDefinitionSchema
} from '../../../../shared/api/schemas/case-metrics'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildCaseMetricOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/case-metrics/listDefinitions': dispatcherMethodOperation({
      tag: 'case-metrics',
      summary: 'List metric definitions',
      body: CaseMetricInvokeBodySchemas.empty,
      response: MetricDefinitionListResponseSchema
    }),
    '/api/case-metrics/createDefinition': dispatcherMethodOperation({
      tag: 'case-metrics',
      summary: 'Create a metric definition',
      body: CaseMetricInvokeBodySchemas.createDefinition,
      response: MetricDefinitionSchema
    }),
    '/api/case-metrics/listForCase': dispatcherMethodOperation({
      tag: 'case-metrics',
      summary: 'List metric values for a case',
      body: CaseMetricInvokeBodySchemas.listForCase,
      response: CaseMetricWithDefinitionListResponseSchema
    }),
    '/api/case-metrics/upsert': dispatcherMethodOperation({
      tag: 'case-metrics',
      summary: 'Create or update a case metric value',
      body: CaseMetricInvokeBodySchemas.upsert,
      response: CaseMetricSchema
    }),
    '/api/case-metrics/delete': dispatcherMethodOperation({
      tag: 'case-metrics',
      summary: 'Delete a case metric value',
      body: CaseMetricInvokeBodySchemas.delete
    })
  }
}
