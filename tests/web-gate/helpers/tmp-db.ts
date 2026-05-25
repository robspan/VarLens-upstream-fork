import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

export interface TmpDb {
  db: Database.Database
  path: string
  cleanup: () => void
}

export function openMigratedTmpDb(): TmpDb {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-'))
  const path = join(dir, 'gate.db')
  const db = new Database(path)
  initializeSchema(db)
  runMigrations(db)
  return {
    db,
    path,
    cleanup: () => {
      try {
        db.close()
      } catch {
        // ignore — db may already be closed by the test
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export interface ColumnInfo {
  name: string
  type: string
  notnull: 0 | 1
  dflt_value: string | null
  pk: 0 | 1
}

export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}
