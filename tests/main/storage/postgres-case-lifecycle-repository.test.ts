import { describe, expect, it, vi } from 'vitest'

import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'

/** Normalise a client.query(...) arg into the SQL text, whether it was called
 *  positionally (string) or with a named-statement config object (runNamed). */
function sqlText(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg && typeof arg === 'object' && typeof (arg as { text?: unknown }).text === 'string') {
    return (arg as { text: string }).text
  }
  return ''
}

function makePool(genomeBuild = 'GRCh38') {
  const client = {
    query: vi.fn(async (arg: unknown) => {
      if (sqlText(arg).includes('SELECT genome_build')) {
        return { rows: [{ genome_build: genomeBuild }] }
      }
      return { rows: [] }
    }),
    release: vi.fn()
  }
  const pool = {
    connect: vi.fn(async () => client)
  }

  return { client, pool }
}

/** Capture-only summary double recording the order of its method calls. */
function makeSummary() {
  const calls: string[] = []
  const summary = {
    recomputeCohortFrequency: vi.fn(async (args: { affectedBuilds?: string[] }) => {
      calls.push(`recompute:${JSON.stringify(args.affectedBuilds ?? null)}`)
    }),
    removeColumnMetas: vi.fn(async () => {
      calls.push('removeColumnMetas')
    })
  }
  return { summary, calls }
}

/** Index of the first client.query call whose SQL text contains `needle`. */
function firstIndex(client: { query: { mock: { calls: unknown[][] } } }, needle: string): number {
  return client.query.mock.calls.findIndex(([arg]) => sqlText(arg).includes(needle))
}

describe('PostgresCaseLifecycleRepository', () => {
  it('deletes a case and rebuilds variant frequency in one transaction', async () => {
    const { client, pool } = makePool()
    const { summary } = makeSummary()
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

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
    const { summary } = makeSummary()
    const deleteError = new Error('delete failed')
    const rollbackError = new Error('rollback failed')
    client.query.mockImplementation(async (arg: unknown) => {
      const sql = sqlText(arg)
      if (sql.includes('DELETE FROM') && sql.includes('"cases"')) throw deleteError
      if (sql === 'ROLLBACK') throw rollbackError
      if (sql.includes('SELECT genome_build')) return { rows: [{ genome_build: 'GRCh38' }] }
      return { rows: [] }
    })
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

    await expect(repo.deleteCase(7)).rejects.toBe(deleteError)

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  describe('PostgresCaseLifecycleRepository.deleteCase — Sprint A C3', () => {
    it('captures genome_build BEFORE delete (step 1)', async () => {
      const { client, pool } = makePool('GRCh37')
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      const selectIdx = firstIndex(client, 'SELECT genome_build')
      const deleteCaseIdx = firstIndex(client, 'DELETE FROM "public"."cases"')
      expect(selectIdx).toBeGreaterThanOrEqual(0)
      expect(deleteCaseIdx).toBeGreaterThan(selectIdx)
    })

    it('runs _applyAnnotationFlagsOnCaseDelete BEFORE the case delete (Pass-5 HIGH #1)', async () => {
      const { client, pool } = makePool()
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      // The on-case-delete flag hook carries the ` AND v.case_id <> $1` predicate.
      const flagIdx = firstIndex(client, 'v.case_id <> $1')
      const deleteCaseIdx = firstIndex(client, 'DELETE FROM "public"."cases"')
      expect(flagIdx).toBeGreaterThanOrEqual(0)
      expect(deleteCaseIdx).toBeGreaterThan(flagIdx)
    })

    it('subtracts carrier_count, het_count, hom_count simultaneously (Pass-6 MED #3)', async () => {
      const { client, pool } = makePool()
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      const updateCall = client.query.mock.calls.find(
        ([arg]) =>
          sqlText(arg).includes('UPDATE') &&
          sqlText(arg).includes('"cohort_variant_summary"') &&
          sqlText(arg).includes('carrier_count = cvs.carrier_count - per_case.carrier_delta')
      )
      expect(updateCall).toBeDefined()
      const sql = sqlText(updateCall?.[0])
      expect(sql).toContain('het_count = cvs.het_count - per_case.het_delta')
      expect(sql).toContain('hom_count = cvs.hom_count - per_case.hom_delta')
      // Zero-carrier cleanup is a sibling DELETE (Pass-2 verdict #1).
      expect(firstIndex(client, 'WHERE carrier_count <= 0')).toBeGreaterThanOrEqual(0)
    })

    it('rebuilds variant_frequency after the case delete (Pass-6 HIGH #1)', async () => {
      const { client, pool } = makePool()
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      const deleteCaseIdx = firstIndex(client, 'DELETE FROM "public"."cases"')
      const rebuildIdx = firstIndex(client, 'INSERT INTO "public"."variant_frequency"')
      expect(rebuildIdx).toBeGreaterThan(deleteCaseIdx)
    })

    it('recomputes cohort_frequency narrowed to captured genome_build (Pass-4 HIGH #1)', async () => {
      const { pool } = makePool('GRCh37')
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      expect(summary.recomputeCohortFrequency).toHaveBeenCalledWith(
        expect.objectContaining({ schema: 'public', affectedBuilds: ['GRCh37'] })
      )
    })

    it('removeColumnMetas runs after the cascade (step 8)', async () => {
      const { pool } = makePool()
      const { summary, calls } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await repo.deleteCase(7)

      expect(summary.removeColumnMetas).toHaveBeenCalledWith(
        expect.objectContaining({ schema: 'public', caseId: 7 })
      )
      // recompute (step 7) runs before removeColumnMetas (step 8).
      expect(calls).toEqual(['recompute:["GRCh38"]', 'removeColumnMetas'])
    })

    it('handles zero-variant cases (steps still run cleanly, no rows updated)', async () => {
      // No matching case row → SELECT returns no genome_build → recompute falls
      // back to all builds (undefined affectedBuilds) and everything else runs.
      const { client, pool } = makePool()
      client.query.mockImplementation(async () => ({ rows: [] }))
      const { summary } = makeSummary()
      const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

      await expect(repo.deleteCase(999)).resolves.toBeUndefined()

      expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
      expect(client.query).toHaveBeenLastCalledWith('COMMIT')
      expect(summary.recomputeCohortFrequency).toHaveBeenCalledWith(
        expect.objectContaining({ schema: 'public', affectedBuilds: undefined })
      )
      expect(summary.removeColumnMetas).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 999 })
      )
    })
  })
})
