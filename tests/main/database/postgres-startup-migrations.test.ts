import { describe, expect, it, vi } from 'vitest'

import { openConfiguredDatabase } from '../../../src/main/database/startup'

describe('PostgreSQL startup migrations', () => {
  it('migrates before opening a postgres session', async () => {
    const manager = {
      open: vi.fn().mockResolvedValue(undefined),
      openPostgresSession: vi.fn().mockResolvedValue(undefined)
    }
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      end: vi.fn().mockResolvedValue(undefined)
    }
    const session = { close: vi.fn().mockResolvedValue(undefined) }
    const createPostgresSession = vi.fn().mockReturnValue(session)

    await openConfiguredDatabase(manager as never, {
      userDataPath: '/tmp',
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: 'postgres://u:p@localhost/db'
      },
      createPostgresPool: vi.fn().mockReturnValue(pool),
      createPostgresSession: createPostgresSession as never
    })

    const schemaMigrationCallIndex = client.query.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string' && sql.includes('schema_migrations')
    )
    expect(schemaMigrationCallIndex).toBeGreaterThanOrEqual(0)
    expect(createPostgresSession).toHaveBeenCalledTimes(1)
    expect(manager.openPostgresSession).toHaveBeenCalledWith(session)
    expect(client.query.mock.invocationCallOrder[schemaMigrationCallIndex]).toBeLessThan(
      createPostgresSession.mock.invocationCallOrder[0]
    )
  })
})
