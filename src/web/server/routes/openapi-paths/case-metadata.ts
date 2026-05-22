import {
  CaseMetadataInvokeBodySchemas,
  CaseMetadataUnknownResponseSchema
} from '../../../../shared/api/schemas/case-metadata'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildCaseMetadataOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/case-metadata/createCohort': dispatcherMethodOperation({
      tag: 'case-metadata',
      summary: 'Create a cohort label',
      body: CaseMetadataInvokeBodySchemas.createCohort,
      response: CaseMetadataUnknownResponseSchema
    })
  }
}
