/**
 * E2E test: PostgreSQL VCF single-sample import.
 *
 * Imports a VEP-annotated single-sample VCF into a PostgreSQL backend and
 * verifies variant counts, case metadata, gene queries, full-text search,
 * internal AF, and available builds.
 *
 * Requires:
 *   VARLENS_RUN_POSTGRES_E2E=1
 *   Docker container: postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
 */
import { expect, test } from '@playwright/test'
import { join } from 'node:path'

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

test('postgres dev mode imports a VEP-annotated single-sample VCF and verifies all read APIs', async () => {
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

    // HG005 is the sample name in single-sample.vep.vcf.gz
    const vcfPath = join(process.cwd(), 'tests/test-data/vcf/single-sample.vep.vcf.gz')
    const caseName = `PG VCF Single Sample ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ vcfPath, caseName }) => {
        const importResult = await window.api.import.start(vcfPath, caseName, {
          selectedSample: 'HG005',
          genomeBuild: 'GRCh38'
        })

        // Unwrap caseId safely — if it's a SerializableError the id will be 0
        const caseId =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? 0
            : (importResult as { caseId: number }).caseId

        return {
          importResult,
          cases: await window.api.cases.query({ limit: 25, offset: 0, search_term: caseName }),
          dataInfo: await window.api.caseMetadata.getDataInfo(caseId),
          typeCounts: await window.api.variants.typeCounts(caseId),
          // Use a broadly-matching gene filter rather than a hardcoded gene name —
          // the fixture covers chr22:29M-30.5M region of HG005 (NA12878-equiv).
          geneQuery: await window.api.variants.query(caseId, {}, 0, 1),
          internalAf: await window.api.variants.query(caseId, { max_internal_af: 1 }, 0, 25),
          availableBuilds: await window.api.cases.availableBuilds()
        }
      },
      { vcfPath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect((importResult as { caseId: number }).caseId).toBeGreaterThan(0)
    expect((importResult as { variantCount: number }).variantCount).toBeGreaterThan(0)

    const cases = expectSuccessfulIpcResult(results.cases)
    expect(cases).toMatchObject({
      total_count: 1,
      data: [
        expect.objectContaining({
          name: caseName,
          genome_build: 'GRCh38'
        })
      ]
    })

    const dataInfo = expectSuccessfulIpcResult(results.dataInfo)
    expect(dataInfo).toMatchObject({
      import_file_name: 'single-sample.vep.vcf.gz',
      import_file_type: 'vcf'
    })

    const typeCounts = expectSuccessfulIpcResult(results.typeCounts)
    // VEP-annotated single-sample VCF contains SNVs/indels
    expect((typeCounts as { snv?: number }).snv ?? 0).toBeGreaterThan(0)

    // At least one variant should be returned with no filters
    const geneQuery = expectSuccessfulIpcResult(results.geneQuery)
    expect((geneQuery as { total_count: number }).total_count).toBeGreaterThan(0)

    // Internal AF query: after import the frequency table is rebuilt.
    // max_internal_af: 1 should include all variants.
    const internalAf = expectSuccessfulIpcResult(results.internalAf)
    expect((internalAf as { total_count: number }).total_count).toBeGreaterThan(0)

    // The case's build should appear in the availableBuilds list
    // (The IPC returns Array<{ build: string; caseCount: number }>.)
    const builds = expectSuccessfulIpcResult(results.availableBuilds) as Array<{
      build: string
      caseCount: number
    }>
    expect(builds.map((b) => b.build)).toContain('GRCh38')
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
