import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { deleteAllCases, deleteCaseBatch } from '../../../src/main/workers/delete-operations'

describe('delete-operations', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO cases (name) VALUES ('case1'), ('case2'), ('case3');
    `)
  })

  afterEach(() => {
    db.close()
  })

  describe('deleteAllCases', () => {
    it('removes all rows and returns count', () => {
      const deleted = deleteAllCases(db)
      expect(deleted).toBe(3)
      const remaining = db.prepare('SELECT COUNT(*) as c FROM cases').get() as { c: number }
      expect(remaining.c).toBe(0)
    })

    it('returns 0 when table is empty', () => {
      db.exec('DELETE FROM cases')
      const deleted = deleteAllCases(db)
      expect(deleted).toBe(0)
    })
  })

  describe('deleteCaseBatch', () => {
    it('removes specified IDs and returns count', () => {
      const deleted = deleteCaseBatch(db, [1, 3])
      expect(deleted).toBe(2)
      const remaining = db.prepare('SELECT name FROM cases').all() as { name: string }[]
      expect(remaining).toEqual([{ name: 'case2' }])
    })

    it('returns 0 for empty array', () => {
      const deleted = deleteCaseBatch(db, [])
      expect(deleted).toBe(0)
      const remaining = db.prepare('SELECT COUNT(*) as c FROM cases').get() as { c: number }
      expect(remaining.c).toBe(3)
    })

    it('handles non-existent IDs gracefully', () => {
      const deleted = deleteCaseBatch(db, [99, 100])
      expect(deleted).toBe(0)
    })
  })
})
