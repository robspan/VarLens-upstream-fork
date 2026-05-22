import {
  ProteinInvokeBodySchemas,
  ProteinUnknownResponseSchema
} from '../../../../shared/api/schemas/protein'
import type { OpenApiPathItem } from '../openapi-utils'
import { referenceFixtureOperation } from './operation'

export function buildProteinOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/protein/getMapping': referenceFixtureOperation({
      tag: 'protein',
      summary: 'Return protein mappings for a gene',
      body: ProteinInvokeBodySchemas.gene,
      response: ProteinUnknownResponseSchema
    }),
    '/api/protein/getDomains': referenceFixtureOperation({
      tag: 'protein',
      summary: 'Return protein domains for an accession',
      body: ProteinInvokeBodySchemas.accession,
      response: ProteinUnknownResponseSchema
    }),
    '/api/protein/getStructure': referenceFixtureOperation({
      tag: 'protein',
      summary: 'Return protein structure metadata for an accession',
      body: ProteinInvokeBodySchemas.accession,
      response: ProteinUnknownResponseSchema
    }),
    '/api/protein/getGeneStructure': referenceFixtureOperation({
      tag: 'protein',
      summary: 'Return protein structure metadata for a gene',
      body: ProteinInvokeBodySchemas.gene,
      response: ProteinUnknownResponseSchema
    })
  }
}
