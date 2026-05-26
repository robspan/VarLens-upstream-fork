import type { OpenApiDocument } from './openapi-utils'
import { buildAnalysisGroupOpenApiPaths } from './openapi-paths/analysis-groups'
import { buildAnnotationOpenApiPaths } from './openapi-paths/annotations'
import { buildAuthOpenApiPaths } from './openapi-paths/auth'
import { buildBatchImportOpenApiPaths } from './openapi-paths/batch-import'
import { buildCaseCommentOpenApiPaths } from './openapi-paths/case-comments'
import { buildCaseMetadataOpenApiPaths } from './openapi-paths/case-metadata'
import { buildCaseMetricOpenApiPaths } from './openapi-paths/case-metrics'
import { buildCaseOpenApiPaths } from './openapi-paths/cases'
import { buildCohortOpenApiPaths } from './openapi-paths/cohort'
import { buildDatabaseOpenApiPaths } from './openapi-paths/database'
import { buildExecutorAutorouteOpenApiPaths } from './openapi-paths/executor'
import { buildExportOpenApiPaths } from './openapi-paths/export'
import { buildGeneListOpenApiPaths } from './openapi-paths/gene-lists'
import { buildImportOpenApiPaths } from './openapi-paths/import'
import { buildRegionFileOpenApiPaths } from './openapi-paths/region-files'
import { buildTagsOpenApiPaths } from './openapi-paths/tags'
import { buildTranscriptOpenApiPaths } from './openapi-paths/transcripts'
import { buildVariantOpenApiPaths } from './openapi-paths/variants'
import { buildReferenceOpenApiPaths } from './openapi-reference-paths'

export function appendDocumentedDispatcherPaths(document: OpenApiDocument): OpenApiDocument {
  return {
    ...document,
    paths: {
      ...document.paths,
      ...buildExecutorAutorouteOpenApiPaths(),
      ...buildAuthOpenApiPaths(),
      ...buildAnnotationOpenApiPaths(),
      ...buildAnalysisGroupOpenApiPaths(),
      ...buildBatchImportOpenApiPaths(),
      ...buildCaseOpenApiPaths(),
      ...buildCaseCommentOpenApiPaths(),
      ...buildCaseMetadataOpenApiPaths(),
      ...buildCaseMetricOpenApiPaths(),
      ...buildCohortOpenApiPaths(),
      ...buildDatabaseOpenApiPaths(),
      ...buildExportOpenApiPaths(),
      ...buildGeneListOpenApiPaths(),
      ...buildImportOpenApiPaths(),
      ...buildReferenceOpenApiPaths(),
      ...buildRegionFileOpenApiPaths(),
      ...buildTagsOpenApiPaths(),
      ...buildTranscriptOpenApiPaths(),
      ...buildVariantOpenApiPaths()
    }
  }
}

export function buildDocumentedDispatcherPathSet(): Set<string> {
  return new Set(Object.keys(appendDocumentedDispatcherPaths({ paths: {} }).paths ?? {}))
}
