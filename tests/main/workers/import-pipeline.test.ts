import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { prepareStatements } from '../../../src/main/workers/import-pipeline'

describe('prepareStatements', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('returns all required statement handles', () => {
    const stmts = prepareStatements(db)
    expect(stmts.insertCase).toBeDefined()
    expect(stmts.deleteCase).toBeDefined()
    expect(stmts.getCaseByName).toBeDefined()
    expect(stmts.insertBatch).toBeDefined()
    expect(stmts.beginBulkInsert).toBeDefined()
    expect(stmts.finishBulkInsert).toBeDefined()
    expect(stmts.insertDataInfo).toBeDefined()
    expect(stmts.updateVariantCount).toBeDefined()
  })

  it('insertCase creates a case record', () => {
    const stmts = prepareStatements(db)
    const result = stmts.insertCase.run('test-case', '/path/to/file', 1024, Date.now(), 'GRCh38')
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0)
  })

  it('getCaseByName finds existing case', () => {
    const stmts = prepareStatements(db)
    stmts.insertCase.run('test-case', '/path', 100, Date.now(), 'GRCh38')
    const found = stmts.getCaseByName.get('test-case') as { id: number } | undefined
    expect(found).toBeDefined()
    expect(found!.id).toBeGreaterThan(0)
  })

  it('getCaseByName returns undefined for missing case', () => {
    const stmts = prepareStatements(db)
    const found = stmts.getCaseByName.get('nonexistent')
    expect(found).toBeUndefined()
  })

  it('insertBatch inserts variants for a case', () => {
    const stmts = prepareStatements(db)
    const caseResult = stmts.insertCase.run('test', '/path', 100, Date.now(), 'GRCh38')
    const caseId = Number(caseResult.lastInsertRowid)

    stmts.insertBatch(caseId, [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'TEST' }])

    const count = db
      .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
      .get(caseId) as { c: number }
    expect(count.c).toBe(1)
  })

  it('insertBatch handles multiple variants', () => {
    const stmts = prepareStatements(db)
    const caseResult = stmts.insertCase.run('test', '/path', 100, Date.now(), 'GRCh38')
    const caseId = Number(caseResult.lastInsertRowid)

    stmts.insertBatch(caseId, [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'T' },
      { chr: 'chr1', pos: 200, ref: 'G', alt: 'C' },
      { chr: 'chr2', pos: 300, ref: 'T', alt: 'A' }
    ])

    const count = db
      .prepare('SELECT COUNT(*) as c FROM variants WHERE case_id = ?')
      .get(caseId) as { c: number }
    expect(count.c).toBe(3)
  })

  it('finishBulkInsert updates variant count', () => {
    const stmts = prepareStatements(db)
    const caseResult = stmts.insertCase.run('test', '/path', 100, Date.now(), 'GRCh38')
    const caseId = Number(caseResult.lastInsertRowid)

    stmts.finishBulkInsert(caseId, 42)

    const row = db.prepare('SELECT variant_count FROM cases WHERE id = ?').get(caseId) as {
      variant_count: number
    }
    expect(row.variant_count).toBe(42)
  })
})
