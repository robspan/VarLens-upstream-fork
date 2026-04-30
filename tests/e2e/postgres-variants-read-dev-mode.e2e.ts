import { expect, test } from '@playwright/test'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

function expectSuccessfulIpcResult<T>(result: T): T {
  expect(result).not.toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      userMessage: expect.any(String)
    })
  )
  return result
}

test('postgres dev mode supports phase 7 variant reads', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const results = await launched.window.evaluate(async () => {
      return {
        typeCounts: await window.api.variants.typeCounts(1),
        typesPresent: await window.api.variants.typesPresent({ caseId: 1 }),
        geneSymbols: await window.api.variants.geneSymbols(1, 'BR', 20),
        snvQuery: await window.api.variants.query(1, { variant_type: 'snv' }, 0, 25, [{ key: 'pos', order: 'asc' }], false, true),
        baseFilterQuery: await window.api.variants.query(1, { funcs: ['missense_variant'] }, 0, 25),
        numericFilterQuery: await window.api.variants.query(1, { cadd_min: 25 }, 0, 25),
        columnFilterQuery: await window.api.variants.query(1, { column_filters: { consequence: { operator: 'in', value: ['HIGH'] } } }, 0, 25),
        internalAfQuery: await window.api.variants.query(1, { max_internal_af: 0.6 }, 0, 25),
        ftsQuery: await window.api.variants.query(1, { search_query: 'Huntington' }, 0, 25),
        coordinateQuery: await window.api.variants.query(1, { chr: '1', pos: 1000, ref: 'A', alt: 'G' }, 0, 25),
        shortlist: await window.api.variants.shortlist({
          caseId: 1,
          adHocConfig: {
            variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
            baseFilters: {},
            topN: 5,
            rankConfig: {
              weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
            }
          }
        })
      }
    })

    expect(expectSuccessfulIpcResult(results.typeCounts)).toMatchObject({
      snv: 1,
      indel: 1,
      sv: 1,
      cnv: 1,
      str: 1
    })
    expect(expectSuccessfulIpcResult(results.typesPresent)).toEqual(['cnv', 'indel', 'snv', 'str', 'sv'])
    expect(expectSuccessfulIpcResult(results.geneSymbols)).toEqual(['BRCA1', 'BRCA2'])

    const snvQuery = expectSuccessfulIpcResult(results.snvQuery)
    expect(snvQuery).toMatchObject({
      total_count: 2,
      unfiltered_count: 5,
      data: [
        expect.objectContaining({ gene_symbol: 'BRCA1', variant_type: 'snv' }),
        expect.objectContaining({ gene_symbol: 'BRCA2', variant_type: 'indel' })
      ]
    })
    expect(snvQuery.data[0].internal_af).toBeCloseTo(2 / 3)

    expect(expectSuccessfulIpcResult(results.baseFilterQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', func: 'missense_variant' })]
    })

    expect(expectSuccessfulIpcResult(results.numericFilterQuery)).toMatchObject({
      total_count: 2,
      data: expect.arrayContaining([
        expect.objectContaining({ gene_symbol: 'BRCA1' }),
        expect.objectContaining({ gene_symbol: 'DMD' })
      ])
    })

    expect(expectSuccessfulIpcResult(results.columnFilterQuery)).toMatchObject({
      total_count: 2,
      data: expect.arrayContaining([
        expect.objectContaining({ gene_symbol: 'BRCA1' }),
        expect.objectContaining({ gene_symbol: 'DMD' })
      ])
    })

    expect(expectSuccessfulIpcResult(results.internalAfQuery)).toMatchObject({
      total_count: 4,
      data: expect.not.arrayContaining([expect.objectContaining({ gene_symbol: 'BRCA1' })])
    })

    expect(expectSuccessfulIpcResult(results.ftsQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'HTT', variant_type: 'str' })]
    })

    expect(expectSuccessfulIpcResult(results.coordinateQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', pos: 1000 })]
    })

    const shortlist = expectSuccessfulIpcResult(results.shortlist)
    expect(shortlist.totalCandidates).toBeGreaterThan(0)
    expect(shortlist.rows[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        rank_score: expect.any(Number),
        rank_components: expect.any(Object)
      })
    )
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
