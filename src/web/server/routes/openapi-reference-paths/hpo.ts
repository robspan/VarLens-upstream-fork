import { HpoInvokeBodySchemas, HpoUnknownResponseSchema } from '../../../../shared/api/schemas/hpo'
import type { OpenApiPathItem } from '../openapi-utils'
import { referenceFixtureOperation } from './operation'

export function buildHpoOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/hpo/search': referenceFixtureOperation({
      tag: 'hpo',
      summary: 'Search HPO terms',
      body: HpoInvokeBodySchemas.search,
      response: HpoUnknownResponseSchema
    }),
    '/api/hpo/clearCache': referenceFixtureOperation({
      tag: 'hpo',
      summary: 'Clear HPO cache',
      body: HpoInvokeBodySchemas.empty,
      response: HpoUnknownResponseSchema
    })
  }
}
