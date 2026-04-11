import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import {
  detectPresentFtsTables,
  tearDownFtsTriggers,
  restoreFtsTriggers
} from '../../../src/main/database/fts-trigger-management'

describe('bulk-insert FTS trigger regression', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  it('teardown and restore preserves variants_fts triggers', () => {
    const before = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'variants_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()

    const snapshot = tearDownFtsTriggers(db)
    restoreFtsTriggers(db, snapshot)

    const after = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'variants_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()

    expect(after).toEqual(before)
  })

  it('detectPresentFtsTables returns variants_fts before v26 extension FTS tables exist', () => {
    const present = detectPresentFtsTables(db)
    expect(present).toContain('variants_fts')
  })

  it('bulk insert path works end-to-end after teardown/restore cycle', () => {
    const now = Date.now()
    db.prepare(
      "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (1, 'c1', '/t', 100, 0, ?)"
    ).run(now)

    const snapshot = tearDownFtsTriggers(db)
    const stmt = db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol) VALUES (1, 'chr1', ?, 'A', 'T', ?)"
    )
    for (let i = 0; i < 100; i++) stmt.run(1000 + i, `GENE${i}`)
    restoreFtsTriggers(db, snapshot)
    db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")

    const count = db
      .prepare('SELECT COUNT(*) as n FROM variants_fts WHERE variants_fts MATCH ?')
      .get('GENE5*') as { n: number }
    expect(count.n).toBeGreaterThanOrEqual(1)
  })
})
