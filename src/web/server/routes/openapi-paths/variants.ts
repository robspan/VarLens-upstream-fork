import {
  VariantInvokeBodySchemas,
  VariantUnknownResponseSchema
} from '../../../../shared/api/schemas/variants'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildVariantOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/variants/search': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Search variants across indexed variant text within a case',
      body: VariantInvokeBodySchemas.search,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/columnMeta': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Return variant column metadata for one case or a cohort scope',
      body: VariantInvokeBodySchemas.columnMeta,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/query': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Query variants for a case',
      body: VariantInvokeBodySchemas.query,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/getFilterOptions': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Return available filter options for a case',
      body: VariantInvokeBodySchemas.getFilterOptions,
      response: VariantUnknownResponseSchema
    })
  }
}
