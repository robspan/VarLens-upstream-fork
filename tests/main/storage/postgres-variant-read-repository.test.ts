import { describe, expect, it, vi } from 'vitest'

import {
  PostgresVariantReadRepository,
  toPrefixTsQueryForTest
} from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('PostgresVariantReadRepository', () => {
  it('returns variant type counts with bigint strings normalized', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { variant_type: 'snv', count: '2' },
          { variant_type: 'sv', count: '1' }
        ]
      })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypeCounts(1)).resolves.toStrictEqual({ snv: 2, sv: 1 })
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/\bvariants\b/), [1])
  })

  it('returns distinct variant types for a case scope', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ variant_type: 'snv' }, { variant_type: 'str' }] })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypesPresent({ caseId: 1 })).resolves.toStrictEqual([
      'snv',
      'str'
    ])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('case_id = $1'), [1])
  })

  it('returns gene symbols by prefix case-insensitively', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ gene_symbol: 'BRCA1' }] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getGeneSymbols(1, 'br', 20)).resolves.toStrictEqual(['BRCA1'])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), [1, 'br%', 20])
  })

  it('keeps the postgres tsquery test helper private to repository tests for now', () => {
    expect(toPrefixTsQueryForTest('')).toBe('')
  })
})
