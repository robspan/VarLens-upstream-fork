import { buildGeneRefOpenApiPaths } from './openapi-reference-paths/gene-ref'
import { buildHpoOpenApiPaths } from './openapi-reference-paths/hpo'
import { buildProteinOpenApiPaths } from './openapi-reference-paths/protein'
import { buildVepOpenApiPaths } from './openapi-reference-paths/vep'
import type { OpenApiPathItem } from './openapi-utils'

export function buildReferenceOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    ...buildGeneRefOpenApiPaths(),
    ...buildHpoOpenApiPaths(),
    ...buildProteinOpenApiPaths(),
    ...buildVepOpenApiPaths()
  }
}
