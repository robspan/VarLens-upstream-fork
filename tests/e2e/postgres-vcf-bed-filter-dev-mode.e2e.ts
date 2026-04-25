/**
 * E2E test: PostgreSQL VCF import with BED region filter.
 *
 * Imports the same VCF file twice via import:startMultiFile (multi-file is
 * required for BED filter routing per IPC design). The first import has no
 * BED filter; the second applies test-regions.bed. Verifies that the
 * BED-filtered import produces strictly fewer variants.
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

test('postgres dev mode BED filter reduces variant count compared to unfiltered import', async () => {
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

    const vcfPath = join(process.cwd(), 'tests/test-data/vcf/single-sample.vep.vcf.gz')
    const bedPath = join(process.cwd(), 'tests/test-data/vcf/test-regions.bed')
    const ts = Date.now()
    const unfilteredCaseName = `PG BED Unfiltered ${ts}`
    const filteredCaseName = `PG BED Filtered ${ts}`

    const results = await launched.window.evaluate(
      async ({ vcfPath, bedPath, unfilteredCaseName, filteredCaseName }) => {
        // First import — no BED filter
        const unfilteredResult = await window.api.import.startMultiFile(
          unfilteredCaseName,
          [{ filePath: vcfPath, variantType: 'snv-indel', annotationFormat: null, caller: null }],
          { selectedSample: 'HG005', genomeBuild: 'GRCh38' }
          // No filters payload → full import
        )

        // Second import — BED filter applied (bedPadding: 0 for deterministic results)
        const filteredResult = await window.api.import.startMultiFile(
          filteredCaseName,
          [{ filePath: vcfPath, variantType: 'snv-indel', annotationFormat: null, caller: null }],
          { selectedSample: 'HG005', genomeBuild: 'GRCh38' },
          { bedFile: bedPath, bedPadding: 0, passOnly: false }
        )

        return { unfilteredResult, filteredResult }
      },
      { vcfPath, bedPath, unfilteredCaseName, filteredCaseName }
    )

    const unfilteredResult = expectSuccessfulIpcResult(results.unfilteredResult)
    const filteredResult = expectSuccessfulIpcResult(results.filteredResult)

    const unfilteredCount = (unfilteredResult as { totalVariants: number }).totalVariants
    const filteredCount = (filteredResult as { totalVariants: number }).totalVariants

    expect(unfilteredCount).toBeGreaterThan(0)
    // BED filter must narrow the variant set
    expect(filteredCount).toBeGreaterThan(0)
    expect(filteredCount).toBeLessThan(unfilteredCount)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
