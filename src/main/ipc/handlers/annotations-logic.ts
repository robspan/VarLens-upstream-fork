/**
 * Pure business logic for annotations IPC handlers.
 *
 * All functions take explicit dependencies (db, pool) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { VariantAnnotation, CaseVariantAnnotation, AcmgClassification } from '../../database/types'

/** Validated variant coordinates. */
export interface VariantCoords {
  chr: string
  pos: number
  ref: string
  alt: string
}

/** Validated global annotation updates (after Zod parsing). */
export interface GlobalAnnotationUpdates {
  user_name?: string | null
  global_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
}

/** Validated per-case annotation updates (after Zod parsing). */
export interface PerCaseAnnotationUpdates {
  user_name?: string | null
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
}

/** Variant key for batch operations. */
export interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

/**
 * Get global annotation for a variant.
 */
export async function getGlobalAnnotation(
  coords: VariantCoords,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getGlobal',
      params: [coords.chr, coords.pos, coords.ref, coords.alt]
    })
  }

  const db = getDb()
  return db.annotations.getGlobalAnnotation(coords.chr, coords.pos, coords.ref, coords.alt)
}

/**
 * Upsert global annotation for a variant.
 * Handles state comparison and audit trail creation.
 */
export function upsertGlobalAnnotation(
  coords: VariantCoords,
  updates: GlobalAnnotationUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  const { chr: vChr, pos: vPos, ref: vRef, alt: vAlt } = coords

  // Extract user_name before building db updates
  const { user_name, ...annotationUpdates } = updates

  // Read current state before upsert for audit trail
  const oldAnnotation = db.annotations.getGlobalAnnotation(vChr, vPos, vRef, vAlt)

  // Build dbUpdates only with keys actually provided
  const dbUpdates: Partial<
    Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>
  > = {}

  if ('global_comment' in annotationUpdates) {
    dbUpdates.global_comment = annotationUpdates.global_comment
  }
  if ('acmg_classification' in annotationUpdates) {
    dbUpdates.acmg_classification = annotationUpdates.acmg_classification
  }
  if ('acmg_evidence' in annotationUpdates) {
    dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
  }
  if (annotationUpdates.starred !== undefined) {
    dbUpdates.starred = annotationUpdates.starred ? 1 : 0
  }

  const result = db.annotations.upsertGlobalAnnotation(vChr, vPos, vRef, vAlt, dbUpdates)

  // Audit logging
  const entityKey = `${vChr}:${vPos}:${vRef}:${vAlt}`
  if (annotationUpdates.acmg_classification !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
        : null,
      new_value: JSON.stringify({
        acmg_classification: annotationUpdates.acmg_classification
      }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.acmg_evidence !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
        : null,
      new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.starred !== undefined) {
    db.auditLog.appendEntry({
      action_type: annotationUpdates.starred ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
      new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
      user_name: user_name ?? null
    })
  }

  return result
}

/**
 * Delete global annotation for a variant.
 */
export function deleteGlobalAnnotation(
  coords: VariantCoords,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.annotations.deleteGlobalAnnotation(coords.chr, coords.pos, coords.ref, coords.alt)
}

/**
 * Get per-case annotation for a variant.
 */
export async function getPerCaseAnnotation(
  caseId: number,
  variantId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getPerCase',
      params: [caseId, variantId]
    })
  }

  const db = getDb()
  return db.annotations.getPerCaseAnnotation(caseId, variantId)
}

/**
 * Upsert per-case annotation for a variant.
 * Handles state comparison and audit trail creation.
 */
export function upsertPerCaseAnnotation(
  caseId: number,
  variantId: number,
  updates: PerCaseAnnotationUpdates,
  getDb: () => DatabaseService
): unknown {
  const db = getDb()

  // Extract user_name before building db updates
  const { user_name, ...annotationUpdates } = updates

  // Read current state before upsert for audit trail
  const oldAnnotation = db.annotations.getPerCaseAnnotation(caseId, variantId)

  // Build dbUpdates only with keys actually provided
  const dbUpdates: Partial<
    Pick<
      CaseVariantAnnotation,
      'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
    >
  > = {}

  if ('per_case_comment' in annotationUpdates) {
    dbUpdates.per_case_comment = annotationUpdates.per_case_comment
  }
  if ('acmg_classification' in annotationUpdates) {
    dbUpdates.acmg_classification = annotationUpdates.acmg_classification
  }
  if ('acmg_evidence' in annotationUpdates) {
    dbUpdates.acmg_evidence = annotationUpdates.acmg_evidence
  }
  if (annotationUpdates.starred !== undefined) {
    dbUpdates.starred = annotationUpdates.starred ? 1 : 0
  }

  const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, dbUpdates)

  // Audit logging
  const entityKey = `case:${caseId}:variant:${variantId}`
  if (annotationUpdates.acmg_classification !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_classify',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification })
        : null,
      new_value: JSON.stringify({
        acmg_classification: annotationUpdates.acmg_classification
      }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.acmg_evidence !== undefined) {
    db.auditLog.appendEntry({
      action_type: 'acmg_evidence_update',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation
        ? JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence })
        : null,
      new_value: JSON.stringify({ acmg_evidence: annotationUpdates.acmg_evidence }),
      user_name: user_name ?? null
    })
  }
  if (annotationUpdates.starred !== undefined) {
    db.auditLog.appendEntry({
      action_type: annotationUpdates.starred ? 'star' : 'unstar',
      entity_type: 'case_variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation ? JSON.stringify({ starred: oldAnnotation.starred }) : null,
      new_value: JSON.stringify({ starred: annotationUpdates.starred ? 1 : 0 }),
      user_name: user_name ?? null
    })
  }

  return result
}

/**
 * Delete per-case annotation for a variant.
 */
export function deletePerCaseAnnotation(
  caseId: number,
  variantId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.annotations.deletePerCaseAnnotation(caseId, variantId)
}

/**
 * Get all annotations for a variant (global + per-case).
 */
export async function getAnnotationsForVariant(
  caseId: number,
  coords: VariantCoords,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:getForVariant',
      params: [caseId, coords.chr, coords.pos, coords.ref, coords.alt]
    })
  }

  const db = getDb()
  return db.annotations.getAnnotationsForVariant(
    caseId,
    coords.chr,
    coords.pos,
    coords.ref,
    coords.alt
  )
}

/**
 * Batch read annotations -- single round-trip for N variants (pool-dispatched).
 */
export async function batchGetAnnotations(
  caseId: number | null,
  variantKeys: VariantKey[],
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'annotations:batchGet' as const,
      params: [caseId, variantKeys]
    })
  }
  const db = getDb()
  return db.annotations.getBatch(caseId, variantKeys)
}
