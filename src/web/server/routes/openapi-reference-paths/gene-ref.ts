import {
  GeneRefInvokeBodySchemas,
  GeneRefUnknownResponseSchema
} from '../../../../shared/api/schemas/gene-ref'
import type { OpenApiPathItem } from '../openapi-utils'
import { referenceFixtureOperation } from './operation'

export function buildGeneRefOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/gene-ref/info': referenceFixtureOperation({
      tag: 'gene-ref',
      summary: 'Return gene reference database information',
      body: GeneRefInvokeBodySchemas.empty,
      response: GeneRefUnknownResponseSchema
    }),
    '/api/gene-ref/assemblies': referenceFixtureOperation({
      tag: 'gene-ref',
      summary: 'List available gene reference assemblies',
      body: GeneRefInvokeBodySchemas.empty,
      response: GeneRefUnknownResponseSchema
    })
  }
}
