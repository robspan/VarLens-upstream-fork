/**
 * Pure business logic for case-metadata IPC handlers.
 *
 * All functions take explicit dependencies (db, pool) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'

// ============================================================
// Validated input types (after Zod parsing in handler)
// ============================================================

export interface MetadataUpdates {
  affected_status?: string | null
  sex?: string | null
  notes?: string | null
}

export interface CohortCreateParams {
  name: string
  description?: string | null
}

export interface CohortUpdateParams {
  name?: string
  description?: string | null
}

export interface DataInfoUpdates {
  platform?: string | null
  platform_details?: string | null
  af_filter?: string | null
  gene_list_filter?: string | null
  region_filter?: string | null
  quality_filter?: string | null
  data_notes?: string | null
  gene_list_id?: number | null
  region_file_id?: number | null
}

// ============================================================
// Case Metadata
// ============================================================

/**
 * Get case metadata.
 */
export async function getMetadata(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:get', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.getCaseMetadata(caseId)
}

/**
 * Upsert case metadata.
 */
export function upsertMetadata(
  caseId: number,
  updates: MetadataUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.upsertCaseMetadata(caseId, updates)
}

// ============================================================
// Cohort Groups
// ============================================================

/**
 * List all cohort groups.
 */
export async function listCohorts(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:listCohorts', params: [] })
  }
  const db = getDb()
  return db.metadata.listCohortGroups()
}

/**
 * Create a new cohort group.
 */
export function createCohort(
  params: CohortCreateParams,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.createCohortGroup(params.name, params.description)
}

/**
 * Update a cohort group.
 */
export function updateCohort(
  cohortId: number,
  updates: CohortUpdateParams,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.updateCohortGroup(cohortId, updates)
}

/**
 * Delete a cohort group.
 */
export function deleteCohort(
  cohortId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.deleteCohortGroup(cohortId)
}

/**
 * Get cohort group by name.
 */
export async function getCohortByName(
  name: string,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:getCohortByName', params: [name] })
  }
  const db = getDb()
  return db.metadata.getCohortGroupByName(name)
}

// ============================================================
// Case-Cohort Links
// ============================================================

/**
 * Get all cohorts for a case.
 */
export async function getCaseCohorts(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:getCaseCohorts', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.getCaseCohorts(caseId)
}

/**
 * Assign a case to a cohort.
 */
export function assignCohort(
  caseId: number,
  cohortId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.assignCaseCohort(caseId, cohortId)
}

/**
 * Remove a case from a cohort.
 */
export function removeCohort(
  caseId: number,
  cohortId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.removeCaseCohort(caseId, cohortId)
}

/**
 * Replace all cohort assignments for a case.
 */
export function setCohorts(
  caseId: number,
  cohortIds: number[],
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.setCaseCohorts(caseId, cohortIds)
}

// ============================================================
// HPO Terms
// ============================================================

/**
 * Get all HPO terms for a case.
 */
export async function getHpoTerms(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:getHpoTerms', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.getCaseHpoTerms(caseId)
}

/**
 * Assign HPO term to case.
 */
export function assignHpoTerm(
  caseId: number,
  hpoId: string,
  hpoLabel: string,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.assignCaseHpoTerm(caseId, hpoId, hpoLabel)
}

/**
 * Remove HPO term from case.
 */
export function removeHpoTerm(
  caseId: number,
  hpoId: string,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.removeCaseHpoTerm(caseId, hpoId)
}

// ============================================================
// Case Data Info
// ============================================================

/**
 * Get case data info (import provenance, platform, pre-filtering).
 */
export async function getDataInfo(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:getDataInfo', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.getCaseDataInfo(caseId)
}

/**
 * Upsert case data info.
 */
export function upsertDataInfo(
  caseId: number,
  updates: DataInfoUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.upsertCaseDataInfo(caseId, updates)
}

// ============================================================
// External IDs
// ============================================================

/**
 * List external IDs for a case.
 */
export async function listExternalIds(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:listExternalIds', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.listCaseExternalIds(caseId)
}

/**
 * Upsert an external ID for a case.
 */
export function upsertExternalId(
  caseId: number,
  idType: string,
  idValue: string,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.metadata.upsertCaseExternalId(caseId, idType, idValue)
}

/**
 * Delete an external ID for a case.
 */
export function deleteExternalId(
  caseId: number,
  idType: string,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.metadata.deleteCaseExternalId(caseId, idType)
}

// ============================================================
// Distinct Lookups
// ============================================================

/**
 * Get distinct HPO terms across all cases.
 */
export async function distinctHpoTerms(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:distinctHpoTerms', params: [] })
  }
  const db = getDb()
  return db.metadata.getDistinctHpoTerms()
}

/**
 * Get distinct platforms across all cases.
 */
export async function distinctPlatforms(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:distinctPlatforms', params: [] })
  }
  const db = getDb()
  return db.metadata.getDistinctPlatforms()
}

/**
 * Get distinct external ID types across all cases.
 */
export async function distinctExternalIdTypes(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:distinctExternalIdTypes', params: [] })
  }
  const db = getDb()
  return db.metadata.getDistinctExternalIdTypes()
}

// ============================================================
// Convenience
// ============================================================

/**
 * Get full metadata for a case (metadata + cohorts + HPO terms).
 */
export async function getFullMetadata(
  caseId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'case-metadata:getFullMetadata', params: [caseId] })
  }
  const db = getDb()
  return db.metadata.getFullCaseMetadata(caseId)
}
