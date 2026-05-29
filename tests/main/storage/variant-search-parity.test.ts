import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('variant search parity', () => {
  let sqlite: DatabaseService

  beforeEach(() => {
    sqlite = new DatabaseService(':memory:')
  })

  afterEach(() => {
    sqlite.close()
  })

  it('matches non-gene search terms through SQLite FTS and Postgres search_document', async () => {
    const caseId = sqlite.cases.createCase('search-parity', '/fixtures/search.vcf', 1024)
    const variants: Omit<Variant, 'id' | 'case_id'>[] = [
      {
        chr: '1',
        pos: 1000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'GENE1',
        consequence: 'stop_gained',
        gnomad_af: null,
        cadd: null,
        clinvar: null
      },
      {
        chr: '1',
        pos: 2000,
        ref: 'C',
        alt: 'T',
        gene_symbol: 'STOPLIKE_GENE',
        consequence: 'missense_variant',
        gnomad_af: null,
        cadd: null,
        clinvar: null
      }
    ]
    sqlite.variants.insertVariantsBatch(caseId, variants)
    const sqliteResults = sqlite.variants.searchVariants(caseId, 'stop', 20)

    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: sqliteResults.map((variant) => ({
          ...variant,
          internal_af: null
        }))
      })
    }
    const postgres = new PostgresVariantReadRepository(pool as never, 'public')
    const postgresResults = await postgres.searchVariants(caseId, 'stop', 20)

    expect(sqliteResults.map((variant) => variant.consequence)).toContain('stop_gained')
    expect(postgresResults.map((variant) => variant.consequence)).toEqual(
      sqliteResults.map((variant) => variant.consequence)
    )
    const sql = (pool.query.mock.calls[0][0] as { text: string }).text
    expect(sql).toContain('search_document @@')
    expect(sql).not.toContain('gene_symbol ILIKE')
  })
})
