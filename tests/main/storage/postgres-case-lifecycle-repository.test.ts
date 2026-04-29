import { describe, expect, it, vi } from 'vitest'

import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'

function makePool() {
  const client = {
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn()
  }
  const pool = {
    connect: vi.fn(async () => client)
  }

  return { client, pool }
}

describe('PostgresCaseLifecycleRepository', () => {
  it('deletes a case and rebuilds variant frequency in one transaction', async () => {
    const { client, pool } = makePool()
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public')

    await repo.deleteCase(7)

    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."cases" WHERE id = $1'),
      [7]
    )
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('"variant_frequency"'))
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('preserves the original delete error when rollback fails', async () => {
    const { client, pool } = makePool()
    const deleteError = new Error('delete failed')
    const rollbackError = new Error('rollback failed')
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM')) throw deleteError
      if (sql === 'ROLLBACK') throw rollbackError
      return { rows: [] }
    })
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public')

    await expect(repo.deleteCase(7)).rejects.toBe(deleteError)

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
