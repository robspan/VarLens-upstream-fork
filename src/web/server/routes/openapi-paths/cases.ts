import {
  CaseInvokeBodySchemas,
  CaseUnknownResponseSchema
} from '../../../../shared/api/schemas/cases'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildCaseOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/cases/list': dispatcherMethodOperation({
      tag: 'cases',
      summary: 'List cases available in the current workspace',
      body: CaseInvokeBodySchemas.list,
      response: CaseUnknownResponseSchema
    })
  }
}
