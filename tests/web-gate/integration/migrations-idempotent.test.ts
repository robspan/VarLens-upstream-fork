import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * Phase 1 gate — running migrations twice on the same on-disk database
 * file must be a no-op: identical `sqlite_master` dump and identical
 * `PRAGMA user_version` after the second run. Catches stray
 * `INSERT INTO ...` in migration bodies and `CREATE INDEX` without
 * `IF NOT EXISTS`.
 *
 * SKIPPED until the web build target lands. The Electron path covers
 * this implicitly via the existing `migrations.ts` test suite; this
 * version exercises the migrations through whatever startup path the
 * web container uses.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

describe.skipIf(!isWebBuilt)('migrations idempotency (web path)', () => {
  test('second app boot on same DB file is a schema no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-mig-'))
    const dbPath = join(dir, 'gate.db')

    try {
      const { buildApp } = await import('../../../src/web/server')

      // First boot: runs migrations from scratch.
      const app1 = await buildApp({ db: dbPath })
      await app1.close()

      // Snapshot schema after first boot.
      const Database = (await import('better-sqlite3-multiple-ciphers')).default
      const snap1 = (() => {
        const db = new Database(dbPath, { readonly: true })
        const master = db
          .prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)
          .all()
        const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
          .user_version
        db.close()
        return { master, version }
      })()

      // Second boot: must be a no-op.
      const app2 = await buildApp({ db: dbPath })
      await app2.close()

      const snap2 = (() => {
        const db = new Database(dbPath, { readonly: true })
        const master = db
          .prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)
          .all()
        const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
          .user_version
        db.close()
        return { master, version }
      })()

      expect(snap2.version).toBe(snap1.version)
      expect(snap2.master).toEqual(snap1.master)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
