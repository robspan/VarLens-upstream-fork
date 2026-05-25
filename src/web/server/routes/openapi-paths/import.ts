import {
  ImportInvokeBodySchemas,
  ImportUnknownResponseSchema
} from '../../../../shared/api/schemas/import'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildImportOpenApiPaths(): Record<string, OpenApiPathItem> {
  const forbiddenDescription = 'Forbidden or server-path import disabled'

  return {
    '/api/import/start': dispatcherMethodOperation({
      tag: 'import',
      summary: 'Import one server-side variant file',
      body: ImportInvokeBodySchemas.start,
      response: ImportUnknownResponseSchema,
      forbiddenDescription
    }),
    '/api/import/startMultiFile': dispatcherMethodOperation({
      tag: 'import',
      summary: 'Import multiple server-side variant files',
      body: ImportInvokeBodySchemas.startMultiFile,
      response: ImportUnknownResponseSchema,
      forbiddenDescription
    })
  }
}
