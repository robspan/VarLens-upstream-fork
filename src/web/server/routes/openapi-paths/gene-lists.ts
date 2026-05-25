import {
  GeneListInvokeBodySchemas,
  GeneListUnknownResponseSchema
} from '../../../../shared/api/schemas/gene-lists'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildGeneListOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/gene-lists/setGenes': dispatcherMethodOperation({
      tag: 'gene-lists',
      summary: 'Replace genes in a gene list',
      body: GeneListInvokeBodySchemas.setGenes,
      response: GeneListUnknownResponseSchema
    })
  }
}
