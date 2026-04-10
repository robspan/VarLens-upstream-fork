import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  tearDownFtsTriggers,
  restoreFtsTriggers,
  rebuildAllFtsIndexes,
  detectPresentFtsTables
} from '../../../src/main/database/fts-trigger-management'

describe('fts-trigger-management', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE variants (id INTEGER PRIMARY KEY, gene_symbol TEXT, consequence TEXT, omim_mim_number TEXT);
      CREATE VIRTUAL TABLE variants_fts USING fts5(
        gene_symbol, consequence, omim_mim_number,
        content='variants', content_rowid='id'
      );
      CREATE TRIGGER variants_fts_ai AFTER INSERT ON variants BEGIN
        INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
        VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
      END;
      CREATE TRIGGER variants_fts_au AFTER UPDATE ON variants BEGIN
        INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
          VALUES('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
        INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
          VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
      END;
      CREATE TRIGGER variants_fts_ad AFTER DELETE ON variants BEGIN
        INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
          VALUES('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
      END;
    `)
  })

  it('detectPresentFtsTables returns only present tables', () => {
    const present = detectPresentFtsTables(db)
    expect(present).toEqual(['variants_fts'])
  })

  it('detectPresentFtsTables includes extension tables when they exist', () => {
    db.exec(`
      CREATE TABLE variant_sv (variant_id INTEGER PRIMARY KEY, event_id TEXT, mate_id TEXT);
      CREATE VIRTUAL TABLE variant_sv_fts USING fts5(event_id, mate_id, content='variant_sv', content_rowid='variant_id');
    `)
    const present = detectPresentFtsTables(db).sort()
    expect(present).toEqual(['variant_sv_fts', 'variants_fts'])
  })

  it('tearDownFtsTriggers drops all present FTS triggers and captures snapshot', () => {
    const snapshot = tearDownFtsTriggers(db)
    expect(Object.keys(snapshot).sort()).toEqual([
      'variants_fts_ad',
      'variants_fts_ai',
      'variants_fts_au'
    ])
    const remaining = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'variants_%'")
      .all()
    expect(remaining).toEqual([])
  })

  it('restoreFtsTriggers recreates triggers from snapshot', () => {
    const snapshot = tearDownFtsTriggers(db)
    restoreFtsTriggers(db, snapshot)
    const restored = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'variants_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    expect(restored).toEqual(['variants_fts_ad', 'variants_fts_ai', 'variants_fts_au'])
  })

  it('derives trigger names with _fts infix (matches production naming from schema.ts)', () => {
    const snapshot = tearDownFtsTriggers(db)
    // Production triggers are variants_fts_ai/au/ad, not variants_ai/au/ad
    expect(Object.keys(snapshot)).toContain('variants_fts_ai')
    expect(Object.keys(snapshot)).toContain('variants_fts_au')
    expect(Object.keys(snapshot)).toContain('variants_fts_ad')
    expect(Object.keys(snapshot)).not.toContain('variants_ai')
  })

  it('teardown + restore is idempotent', () => {
    const snap1 = tearDownFtsTriggers(db)
    restoreFtsTriggers(db, snap1)
    const snap2 = tearDownFtsTriggers(db)
    restoreFtsTriggers(db, snap2)
    expect(() => {
      db.prepare("INSERT INTO variants (gene_symbol, consequence, omim_mim_number) VALUES ('BRCA1', 'missense', NULL)").run()
    }).not.toThrow()
  })

  it('rebuildAllFtsIndexes rebuilds present FTS indexes without error', () => {
    expect(() => rebuildAllFtsIndexes(db)).not.toThrow()
  })

  it('teardown is safe when no FTS tables exist (defensive)', () => {
    const db2 = new Database(':memory:')
    db2.exec('CREATE TABLE variants (id INTEGER PRIMARY KEY)')
    expect(() => tearDownFtsTriggers(db2)).not.toThrow()
    expect(detectPresentFtsTables(db2)).toEqual([])
  })
})
