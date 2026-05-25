import {
  ExportInvokeBodySchemas,
  ExportUnknownResponseSchema
} from '../../../../shared/api/schemas/export'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildExportOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/export/variants': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export variants for a case',
      body: ExportInvokeBodySchemas.variants,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    }),
    '/api/export/cohort': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export cohort variants',
      body: ExportInvokeBodySchemas.cohort,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    })
  }
}
