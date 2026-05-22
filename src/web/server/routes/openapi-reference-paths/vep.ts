import { VepInvokeBodySchemas, VepUnknownResponseSchema } from '../../../../shared/api/schemas/vep'
import type { OpenApiPathItem } from '../openapi-utils'
import { referenceFixtureOperation } from './operation'

export function buildVepOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/vep/fetch': referenceFixtureOperation({
      tag: 'vep',
      summary: 'Fetch VEP annotations for a variant',
      body: VepInvokeBodySchemas.fetch,
      response: VepUnknownResponseSchema
    }),
    '/api/vep/getCacheStats': referenceFixtureOperation({
      tag: 'vep',
      summary: 'Return VEP cache statistics',
      body: VepInvokeBodySchemas.empty,
      response: VepUnknownResponseSchema
    }),
    '/api/vep/clearCache': referenceFixtureOperation({
      tag: 'vep',
      summary: 'Clear VEP cache',
      body: VepInvokeBodySchemas.empty,
      response: VepUnknownResponseSchema
    }),
    '/api/vep/cancel': referenceFixtureOperation({
      tag: 'vep',
      summary: 'Cancel an active VEP request',
      body: VepInvokeBodySchemas.empty,
      response: VepUnknownResponseSchema
    })
  }
}
