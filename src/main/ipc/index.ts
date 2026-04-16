import { ipcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../database'
import { mainLogger } from '../services/MainLogger'
import type { HandlerDependencies } from './types'
import { getDbPool } from './dbPoolManager'

import { registerCasesDomain } from './domains/cases'
import { registerDatabaseDomain } from './domains/database'
import { registerFilterPresetsDomain } from './domains/filter-presets'
import { registerVariantHandlers } from './handlers/variants'
import { registerImportHandlers } from './handlers/import'
import { registerSystemHandlers } from './handlers/system'
import { registerExportHandlers } from './handlers/export'
import { registerShellHandlers } from './handlers/shell'
import { registerBatchImportHandlers } from './handlers/batch-import'
import { registerCohortHandlers } from './handlers/cohort'
import { registerAnnotationHandlers } from './handlers/annotations'
import { registerVepHandlers } from './handlers/vep'
import { registerHpoHandlers } from './handlers/hpo'
import { registerMyVariantHandlers } from './handlers/myvariant'
import { registerSpliceAIHandlers } from './handlers/spliceai'
import { registerCaseMetadataHandlers } from './handlers/case-metadata'
import { registerCaseCommentHandlers } from './handlers/case-comments'
import { registerCaseMetricHandlers } from './handlers/case-metrics'
import { registerTagHandlers } from './handlers/tags'
import { registerTranscriptHandlers } from './handlers/transcripts'
import { registerUpdaterHandlers } from './handlers/updater'
import { registerAuditLogHandlers } from './handlers/audit-log'
import { registerGeneListHandlers } from './handlers/gene-lists'
import { registerAuthHandlers } from './handlers/auth'
import { registerPanelHandlers } from './handlers/panels'
import { registerGeneRefHandlers } from './handlers/gene-ref'
import { registerAnalysisGroupHandlers } from './handlers/analysis-groups'
import { registerProteinHandlers } from './handlers/protein'
import { registerGnomadHandlers } from './handlers/gnomad'
import { registerShortlistHandlers } from './handlers/shortlist'

// Re-export pool lifecycle for external callers (e.g. app shutdown)
export { initDbPool, destroyDbPool } from './dbPoolManager'

/**
 * Register all IPC handlers.
 * Called once during app initialization.
 *
 * Creates shared dependencies and passes them to each handler module's
 * register function, replacing the previous side-effect import pattern.
 */
export function registerIpcHandlers(): void {
  const deps: HandlerDependencies = {
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager,
    getDbPool
  }

  registerCasesDomain(ipcMain)
  registerVariantHandlers(deps)
  registerImportHandlers(deps)
  registerSystemHandlers(deps)
  registerExportHandlers(deps)
  registerShellHandlers(deps)
  registerDatabaseDomain(ipcMain)
  registerBatchImportHandlers(deps)
  registerCohortHandlers(deps)
  registerAnnotationHandlers(deps)
  registerVepHandlers(deps)
  registerHpoHandlers(deps)
  registerMyVariantHandlers(deps)
  registerSpliceAIHandlers(deps)
  registerCaseMetadataHandlers(deps)
  registerCaseCommentHandlers(deps)
  registerCaseMetricHandlers(deps)
  registerTagHandlers(deps)
  registerTranscriptHandlers(deps)
  registerUpdaterHandlers(deps)
  registerAuditLogHandlers(deps)
  registerGeneListHandlers(deps)
  registerAuthHandlers(deps)
  registerFilterPresetsDomain(ipcMain)
  registerPanelHandlers(deps)
  registerGeneRefHandlers(deps)
  registerAnalysisGroupHandlers(deps)
  registerProteinHandlers(deps)
  registerGnomadHandlers(deps)
  registerShortlistHandlers(deps)

  mainLogger.info('IPC handlers registered', 'ipc')
}
