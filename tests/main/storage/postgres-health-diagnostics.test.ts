import { describe, expect, it, vi } from 'vitest'

import { PostgresHealthDiagnostics } from '../../../src/main/storage/postgres/PostgresHealthDiagnostics'

describe('PostgresHealthDiagnostics', () => {
  it('collects server, schema, role, privilege, and migration status', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'public.schema_migrations' }] }
      if (sql.includes('schema_migrations')) return { rows: [{ version: '0005' }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: false }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      return { rows: [{ ok: 1 }] }
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'public')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      serverVersion: 'PostgreSQL 18',
      currentUser: 'varlens_app',
      schema: 'public',
      currentMigration: '0005',
      canReadSchema: true,
      canWriteSchema: false
    })
  })

  it('treats a missing migration ledger as an unmigrated but reachable database', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: null }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: true }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      throw new Error(`Unexpected query: ${sql}`)
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'public')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      serverVersion: 'PostgreSQL 18',
      currentUser: 'varlens_app',
      schema: 'public',
      currentMigration: null,
      canReadSchema: true,
      canWriteSchema: true
    })
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('"schema_migrations" ORDER BY version DESC LIMIT 1')
    )
  })

  it('probes migration status with quoted schema identifiers', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('to_regclass')) {
        expect(sql).toContain(`to_regclass('"Workspace-A"."schema_migrations"')`)
        return { rows: [{ relation: '"Workspace-A".schema_migrations' }] }
      }
      if (sql.includes('schema_migrations')) return { rows: [{ version: '0005' }] }
      if (sql.includes('USAGE')) return { rows: [{ can_read_schema: true }] }
      if (sql.includes('CREATE')) return { rows: [{ can_write_schema: true }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      return { rows: [] }
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'Workspace-A')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      schema: 'Workspace-A',
      currentMigration: '0005'
    })
  })

  it('returns a failed diagnostic instead of throwing', async () => {
    const diagnostics = new PostgresHealthDiagnostics(
      { query: vi.fn(async () => Promise.reject(new Error('permission denied'))) } as never,
      'workspace'
    )

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: false,
      schema: 'workspace',
      message: 'permission denied'
    })
  })
})
