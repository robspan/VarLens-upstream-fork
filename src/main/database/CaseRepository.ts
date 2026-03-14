import { BaseRepository } from './BaseRepository'
import type { Case } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'
import { createFTSTriggers } from './schema'
import { mainLogger } from '../services/MainLogger'

export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.execRun(
        this.kysely.insertInto('cases').values({
          name,
          file_path: filePath,
          file_size: fileSize,
          variant_count: 0,
          created_at: Date.now()
        })
      )
      return Number(result.lastInsertRowid)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  getCase(id: number): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('id', '=', id)
    )
    if (!result) throw new NotFoundError('Case', id)
    return result
  }

  getCaseByName(name: string): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('name', '=', name)
    )
    if (!result) throw new NotFoundError('Case', name)
    return result
  }

  getAllCases(): Case[] {
    return this.execAll<Case>(
      this.kysely.selectFrom('cases').selectAll().orderBy('created_at', 'desc')
    )
  }

  updateCaseVariantCount(id: number, count: number): void {
    const result = this.execRun(
      this.kysely.updateTable('cases').set({ variant_count: count }).where('id', '=', id)
    )
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteCase(id: number): void {
    const result = this.execRun(this.kysely.deleteFrom('cases').where('id', '=', id))
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteAllCases(): number {
    // Drop FTS triggers before bulk delete to avoid per-row FTS updates
    // which cause severe blocking on large databases.
    // Concurrency note: better-sqlite3 is synchronous and single-threaded
    // per connection. The import worker uses its own separate connection,
    // but imports and deleteAll should not run concurrently by design
    // (the UI prevents this).
    this.dropFtsTriggers()

    try {
      const changes = this.runTransaction(() => {
        return this.execRun(this.kysely.deleteFrom('cases')).changes
      })

      this.rebuildFtsAndRestoreTriggers()
      return changes
    } catch (error) {
      this.restoreFtsTriggersSafe()
      throw error
    }
  }

  deleteCasesBatch(ids: number[]): number {
    if (ids.length === 0) return 0

    // For small batches, let FTS triggers handle per-row updates normally.
    // The trigger-drop optimization is only worthwhile for larger deletes
    // where per-row FTS overhead dominates.
    const useOptimization = ids.length > 5
    if (useOptimization) {
      this.dropFtsTriggers()
    }

    try {
      const changes = this.runTransaction(() => {
        return this.execRun(this.kysely.deleteFrom('cases').where('id', 'in', ids)).changes
      })

      if (useOptimization) {
        this.rebuildFtsAndRestoreTriggers()
      }
      return changes
    } catch (error) {
      if (useOptimization) {
        this.restoreFtsTriggersSafe()
      }
      throw error
    }
  }

  private dropFtsTriggers(): void {
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ai')
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_ad')
    this.db.exec('DROP TRIGGER IF EXISTS variants_fts_au')
  }

  private rebuildFtsAndRestoreTriggers(): void {
    try {
      this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
    } catch (error) {
      mainLogger.error(`Failed to rebuild FTS index: ${error}`, 'CaseRepository')
    }
    try {
      this.db.exec(createFTSTriggers)
    } catch (error) {
      mainLogger.error(`Failed to recreate FTS triggers: ${error}`, 'CaseRepository')
    }
  }

  private restoreFtsTriggersSafe(): void {
    try {
      this.db.exec(createFTSTriggers)
    } catch (error) {
      mainLogger.error(`Failed to restore FTS triggers after error: ${error}`, 'CaseRepository')
    }
  }
}
