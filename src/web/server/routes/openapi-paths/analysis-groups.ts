import {
  AnalysisGroupInvokeBodySchemas,
  AnalysisGroupUnknownResponseSchema
} from '../../../../shared/api/schemas/analysis-groups'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildAnalysisGroupOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/analysis-groups/create': dispatcherMethodOperation({
      tag: 'analysis-groups',
      summary: 'Create an analysis group',
      body: AnalysisGroupInvokeBodySchemas.create,
      response: AnalysisGroupUnknownResponseSchema
    }),
    '/api/analysis-groups/addMember': dispatcherMethodOperation({
      tag: 'analysis-groups',
      summary: 'Add a case to an analysis group',
      body: AnalysisGroupInvokeBodySchemas.addMember,
      response: AnalysisGroupUnknownResponseSchema
    })
  }
}
