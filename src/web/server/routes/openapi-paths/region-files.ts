import {
  RegionFileInvokeBodySchemas,
  RegionFileUnknownResponseSchema
} from '../../../../shared/api/schemas/region-files'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildRegionFileOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/region-files/importBed': dispatcherMethodOperation({
      tag: 'region-files',
      summary: 'Import a BED file from browser upload or enabled server path',
      body: RegionFileInvokeBodySchemas.importBed,
      response: RegionFileUnknownResponseSchema,
      forbiddenDescription: 'Forbidden or server-path import disabled'
    })
  }
}
