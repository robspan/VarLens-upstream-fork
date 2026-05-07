/**
 * Browser-side `window.api` factory.
 *
 * Composes per-domain factories into the same shape `src/preload/index.ts`
 * builds via `contextBridge` for Electron. The renderer's components
 * call `window.api.cases.list()` regardless of which factory installed
 * the object — this is the entire point of the feature-flag boundary
 * (`import.meta.env.MODE === 'web'`).
 *
 * Phase 3 covers the 12 domains that have a corresponding `*-logic.ts`
 * module on the desktop side (cases, auth, variants, annotations,
 * batch-import, case-metadata, cohort, database, export, import,
 * panels, tags). The remaining 15 domains (analysis-groups, audit-log,
 * case-comments, case-metrics, filter-presets, gene-lists, gene-ref,
 * gnomad, hpo, myvariant, protein, region-files, spliceai, transcripts,
 * vep) require their flat IPC handlers to be refactored into a
 * `*-logic.ts` shape before they can be added here. That work is
 * Phase 3.5; until then, components touching those domains are
 * desktop-only.
 */
import { createAnnotationsApi } from './annotations'
import { createAuthApi } from './auth'
import { createBatchImportApi } from './batch-import'
import { createCaseMetadataApi } from './case-metadata'
import { createCasesApi } from './cases'
import { createCohortApi } from './cohort'
import { createDatabaseApi } from './database'
import { createExportApi } from './export'
import { createImportApi } from './import'
import { createPanelsApi } from './panels'
import { createTagsApi } from './tags'
import { createVariantsApi } from './variants'

export const createApiShim = () => ({
  annotations: createAnnotationsApi(),
  auth: createAuthApi(),
  batchImport: createBatchImportApi(),
  caseMetadata: createCaseMetadataApi(),
  cases: createCasesApi(),
  cohort: createCohortApi(),
  database: createDatabaseApi(),
  export: createExportApi(),
  import: createImportApi(),
  panels: createPanelsApi(),
  tags: createTagsApi(),
  variants: createVariantsApi()
})

export type WebApiShim = ReturnType<typeof createApiShim>
