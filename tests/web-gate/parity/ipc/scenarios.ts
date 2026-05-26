import { analysisGroupsScenario } from './analysis-groups'
import { annotationsScenario } from './annotations'
import { auditScenario } from './audit'
import { batchImportScenario } from './batch-import'
import { caseCommentsScenario } from './case-comments'
import { caseMetadataScenario } from './case-metadata'
import { caseMetricsScenario } from './case-metrics'
import { casesScenario } from './cases'
import { cohortScenario } from './cohort'
import { databaseScenario } from './database'
import { exportScenario } from './export'
import { geneListsScenario } from './gene-lists'
import { geneRefScenario } from './gene-ref'
import { hpoScenario } from './hpo'
import { importScenario } from './import'
import { panelsScenario } from './panels'
import { presetsScenario } from './presets'
import { proteinScenario } from './protein'
import { regionFilesScenario } from './region-files'
import { tagsScenario } from './tags'
import { transcriptsScenario } from './transcripts'
import { variantsScenario } from './variants'
import { vepScenario } from './vep'
import type { IpcScenario } from './shared'

export const REQUIRED_IPC_AREAS = [
  'analysis-groups',
  'annotations',
  'audit',
  'batch-import',
  'case-comments',
  'case-metadata',
  'case-metrics',
  'cases',
  'cohort',
  'database',
  'export',
  'presets',
  'gene-lists',
  'gene-ref',
  'hpo',
  'import',
  'panels',
  'protein',
  'region-files',
  'tags',
  'transcripts',
  'variants',
  'vep'
] as const

export const IPC_SCENARIOS: IpcScenario[] = [
  analysisGroupsScenario,
  annotationsScenario,
  auditScenario,
  batchImportScenario,
  caseCommentsScenario,
  caseMetadataScenario,
  caseMetricsScenario,
  casesScenario,
  cohortScenario,
  databaseScenario,
  exportScenario,
  presetsScenario,
  geneListsScenario,
  geneRefScenario,
  hpoScenario,
  importScenario,
  panelsScenario,
  proteinScenario,
  regionFilesScenario,
  tagsScenario,
  transcriptsScenario,
  variantsScenario,
  vepScenario
]
