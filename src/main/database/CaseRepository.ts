import { BaseRepository } from './BaseRepository'
import type { Case } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.stmt(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
      ).run(name, filePath, fileSize, Date.now())
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
    const result = this.stmt('SELECT * FROM cases WHERE id = ?').get(id) as Case | undefined
    if (!result) throw new NotFoundError('Case', id)
    return result
  }

  getCaseByName(name: string): Case {
    const result = this.stmt('SELECT * FROM cases WHERE name = ?').get(name) as Case | undefined
    if (!result) throw new NotFoundError('Case', name)
    return result
  }

  getAllCases(): Case[] {
    return this.stmt('SELECT * FROM cases ORDER BY created_at DESC').all() as Case[]
  }

  updateCaseVariantCount(id: number, count: number): void {
    const result = this.stmt('UPDATE cases SET variant_count = ? WHERE id = ?').run(count, id)
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteCase(id: number): void {
    const result = this.stmt('DELETE FROM cases WHERE id = ?').run(id)
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteAllCases(): number {
    return this.stmt('DELETE FROM cases').run().changes
  }

  deleteCasesBatch(ids: number[]): number {
    if (ids.length === 0) return 0
    return this.runTransaction(() => {
      const placeholders = ids.map(() => '?').join(',')
      const result = this.db.prepare(`DELETE FROM cases WHERE id IN (${placeholders})`).run(...ids)
      return result.changes
    })
  }
}
