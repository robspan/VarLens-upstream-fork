/**
 * Pure business logic for tags IPC handlers.
 *
 * All functions take explicit dependencies (db, pool) as parameters
 * and never touch IPC/Electron APIs directly.
 */
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'

// ============================================================
// Tag CRUD
// ============================================================

/**
 * List all tags. Uses pool if available.
 */
export async function listTags(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'tags:list' as const, params: [] })
  }
  const db = getDb()
  return db.tags.listTags()
}

/**
 * Create a new tag.
 */
export function createTag(name: string, color: string, getDb: () => DatabaseService): unknown {
  const db = getDb()
  return db.tags.createTag(name, color)
}

/**
 * Update a tag.
 */
export function updateTag(
  id: number,
  updates: { name?: string; color?: string },
  getDb: () => DatabaseService
): unknown {
  const db = getDb()
  return db.tags.updateTag(id, updates)
}

/**
 * Delete a tag.
 */
export function deleteTag(id: number, getDb: () => DatabaseService): void {
  const db = getDb()
  db.tags.deleteTag(id)
}

/**
 * Get tag usage count. Uses pool if available.
 */
export async function getUsageCount(
  tagId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'tags:getUsageCount' as const, params: [tagId] })
  }
  const db = getDb()
  return db.tags.getTagUsageCount(tagId)
}

// ============================================================
// Variant Tag Assignments
// ============================================================

/**
 * Get all tags for a case-variant pair. Uses pool if available.
 */
export async function getVariantTags(
  caseId: number,
  variantId: number,
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({
      type: 'tags:getVariantTags' as const,
      params: [caseId, variantId]
    })
  }
  const db = getDb()
  return db.tags.getVariantTags(caseId, variantId)
}

/**
 * Assign a tag to a case-variant pair.
 */
export function assignVariantTag(
  caseId: number,
  variantId: number,
  tagId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.tags.assignVariantTag(caseId, variantId, tagId)
}

/**
 * Remove a tag from a case-variant pair.
 */
export function removeVariantTag(
  caseId: number,
  variantId: number,
  tagId: number,
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.tags.removeVariantTag(caseId, variantId, tagId)
}

/**
 * Replace all tag assignments for a case-variant pair.
 */
export function setVariantTags(
  caseId: number,
  variantId: number,
  tagIds: number[],
  getDb: () => DatabaseService
): void {
  const db = getDb()
  db.tags.setVariantTags(caseId, variantId, tagIds)
}
