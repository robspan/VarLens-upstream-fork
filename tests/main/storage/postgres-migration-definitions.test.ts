import { describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'

describe('Postgres migration definitions', () => {
  it('loads the initial PostgreSQL migrations with SQL and sha256 checksums', () => {
    expect(POSTGRES_MIGRATIONS).toHaveLength(4)
    expect(POSTGRES_MIGRATIONS.map((migration) => migration.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004'
    ])

    for (const migration of POSTGRES_MIGRATIONS) {
      expect(migration.name).not.toHaveLength(0)
      expect(migration.sql.trim()).not.toHaveLength(0)
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
