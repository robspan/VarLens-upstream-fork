import { describe, expect, it, vi } from 'vitest'

import {
  getDatabaseCapabilities,
  getPostgresDiagnostics
} from '../../../src/main/ipc/handlers/database-logic'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'
import { SQLITE_CAPABILITIES } from '../../../src/main/storage/sqlite/SqliteStorageSession'

describe('database capabilities logic', () => {
  it('returns capabilities from the current storage session', () => {
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({ capabilities: POSTGRES_CAPABILITIES })
    }))

    expect(getDatabaseCapabilities(getDbManager as never)).toEqual(POSTGRES_CAPABILITIES)
  })

  it('returns a typed unsupported diagnostics result for sqlite sessions', async () => {
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({
        capabilities: SQLITE_CAPABILITIES,
        workspace: { kind: 'sqlite', path: '/tmp/test.db', name: 'test.db', encrypted: false }
      })
    }))

    await expect(getPostgresDiagnostics(getDbManager as never)).resolves.toMatchObject({
      ok: false,
      schema: '',
      message: 'PostgreSQL diagnostics are only available for PostgreSQL sessions'
    })
  })

  it('collects diagnostics from postgres sessions', async () => {
    const collectDiagnostics = vi.fn().mockResolvedValue({
      ok: true,
      schema: 'workspace_a',
      currentMigration: '0005'
    })
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({
        capabilities: POSTGRES_CAPABILITIES,
        workspace: { kind: 'postgres', schema: 'workspace_a' },
        collectDiagnostics
      })
    }))

    await expect(getPostgresDiagnostics(getDbManager as never)).resolves.toMatchObject({
      ok: true,
      schema: 'workspace_a',
      currentMigration: '0005'
    })
    expect(collectDiagnostics).toHaveBeenCalledOnce()
  })

  it('returns a typed diagnostics failure when a postgres session lacks diagnostics support', async () => {
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({
        capabilities: POSTGRES_CAPABILITIES,
        workspace: { kind: 'postgres', schema: 'workspace_a' }
      })
    }))

    await expect(getPostgresDiagnostics(getDbManager as never)).resolves.toMatchObject({
      ok: false,
      schema: 'workspace_a',
      message: 'Current PostgreSQL session does not expose diagnostics'
    })
  })
})
