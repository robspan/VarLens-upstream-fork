import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sqlPlaceholders } from '../database/sql-utils'

/**
 * Delete operations extracted from delete-worker for testability.
 * Accept an opened DB connection — caller manages lifecycle.
 */

/** Delete all cases (transaction wraps the delete). */
export function deleteAllCases(db: DatabaseType): number {
  const deleteAll = db.transaction(() => {
    return db.prepare('DELETE FROM cases').run().changes
  })
  return deleteAll()
}

/** Delete specific cases by ID. Returns 0 for empty array. */
export function deleteCaseBatch(db: DatabaseType, caseIds: number[]): number {
  if (caseIds.length === 0) return 0
  const placeholders = sqlPlaceholders(caseIds.length)
  const deleteBatch = db.transaction(() => {
    return db.prepare(`DELETE FROM cases WHERE id IN (${placeholders})`).run(...caseIds).changes
  })
  return deleteBatch()
}
