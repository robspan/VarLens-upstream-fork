import { describe, expect, it, vi } from 'vitest'

import { PostgresHealthDiagnostics } from '../../../src/main/storage/postgres/PostgresHealthDiagnostics'

describe('PostgresHealthDiagnostics', () => {
  it('collects server, schema, role, privilege, and migration status', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
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
