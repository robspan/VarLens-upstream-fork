import { describe, expect, it, vi } from 'vitest'

import { getDatabaseCapabilities } from '../../../src/main/ipc/handlers/database-logic'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('database capabilities logic', () => {
  it('returns capabilities from the current storage session', () => {
    const getDbManager = vi.fn(() => ({
      getCurrentSession: () => ({ capabilities: POSTGRES_CAPABILITIES })
    }))

    expect(getDatabaseCapabilities(getDbManager as never)).toEqual(POSTGRES_CAPABILITIES)
  })
})
