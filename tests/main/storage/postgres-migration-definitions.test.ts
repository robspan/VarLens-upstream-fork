import { describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'

describe('Postgres migration definitions', () => {
  it('loads the PostgreSQL migrations with SQL and sha256 checksums', () => {
    expect(POSTGRES_MIGRATIONS).toHaveLength(7)
    expect(POSTGRES_MIGRATIONS.map((migration) => migration.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007'
    ])
    expect(POSTGRES_MIGRATIONS.map((migration) => migration.name)).toEqual([
      'create_cases',
      'create_case_metadata',
      'create_variants',
      'generated_search_documents',
      'create_workflow_tables',
      'create_audit_log',
      'perf_indexes'
    ])

    for (const migration of POSTGRES_MIGRATIONS) {
      expect(migration.name).not.toHaveLength(0)
      expect(migration.sql.trim()).not.toHaveLength(0)
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/)
    }

    const perfMigration = POSTGRES_MIGRATIONS.find((migration) => migration.version === '0007')
    expect(perfMigration?.sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    expect(perfMigration?.sql).toContain('ON "__schema__"."variants" USING BRIN (chr, pos)')
    expect(perfMigration?.sql).toContain(
      'ON "__schema__"."variants" USING GIN (gene_symbol gin_trgm_ops)'
    )
  })
})
