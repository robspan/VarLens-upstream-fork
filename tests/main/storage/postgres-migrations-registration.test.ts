import { describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'

/**
 * Static gate: every migration file added under
 * `src/main/storage/postgres/migrations/sql/` must be registered in
 * POSTGRES_MIGRATIONS so the runner picks it up. Forgetting to register
 * a freshly-added file is the failure mode this guards against — the
 * file would sit on disk and the migration would silently never run
 * against any environment.
 *
 * Phase 2 deliverable #1 adds 0007_create_users_and_settings.sql for
 * the web's auth tables. This test goes RED until that migration is
 * registered.
 */

describe('postgres migration registration', () => {
  it('registers the users + database_settings migration (Phase 2 #1)', () => {
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version)
    const names = POSTGRES_MIGRATIONS.map((m) => m.name)
    expect(versions).toContain('0007')
    expect(names).toContain('create_users_and_settings')
  })

  it('registered migrations are sorted by version (no out-of-order insert)', () => {
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([...versions].sort())
  })

  it('every registered migration carries a non-empty checksum', () => {
    for (const m of POSTGRES_MIGRATIONS) {
      expect(m.checksum).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
