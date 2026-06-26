import {
  ImportInvokeBodySchemas,
  ImportUnknownResponseSchema
} from '../../../../shared/api/schemas/import'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildImportOpenApiPaths(): Record<string, OpenApiPathItem> {
  const forbiddenDescription = 'Forbidden or server-path import disabled'

  return {
    '/api/import/upload': {
      post: {
        tags: ['import'],
        summary: 'Upload one browser-selected import file',
        requestBody: {
          required: true,
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' }
            }
          }
        },
        parameters: [
          {
            name: 'X-VarLens-File-Name',
            in: 'header',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Uploaded file staged for import',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'ref', 'fileName', 'size'],
                  properties: {
                    id: { type: 'string' },
                    ref: { type: 'string' },
                    fileName: { type: 'string' },
                    size: { type: 'number' }
                  }
                }
              }
            }
          },
          400: { description: 'Invalid upload' },
          413: { description: 'Upload exceeds configured byte limit' },
          401: { description: 'Authentication required' },
          403: { description: 'Forbidden' }
        }
      }
    },
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
