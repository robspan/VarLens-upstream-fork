/**
 * E2E test: PostgreSQL VCF multi-file happy path.
 *
 * Merges two VCF files (VEP-annotated + SnpEff-annotated, same sample HG005)
 * into a single case via import:startMultiFile. Verifies that:
 * - result.caseId is set
 * - result.files has 2 entries, both without errors
 * - cases:query shows ONE case with the combined variant count
 * - result.totalVariants approximates the sum of both files' variants
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

test('postgres dev mode multi-file import merges two VCF files into one case', async () => {
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

    const vepPath = join(process.cwd(), 'tests/test-data/vcf/single-sample.vep.vcf.gz')
    const snpeffPath = join(process.cwd(), 'tests/test-data/vcf/single-sample.snpeff.vcf.gz')
    const caseName = `PG Multi-File ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ vepPath, snpeffPath, caseName }) => {
        const importResult = await window.api.import.startMultiFile(
          caseName,
          [
            {
              filePath: vepPath,
              variantType: 'snv-indel',
              annotationFormat: 'csq',
              caller: null
            },
            {
              filePath: snpeffPath,
              variantType: 'snv-indel',
              annotationFormat: 'ann',
              caller: null
            }
          ],
          { selectedSample: 'HG005', genomeBuild: 'GRCh38' }
        )

        const caseId =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? 0
            : (importResult as { caseId: number }).caseId

        return {
          importResult,
          cases: await window.api.cases.query({ limit: 25, offset: 0, search_term: caseName })
        }
      },
      { vepPath, snpeffPath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult) as {
      caseId: number
      totalVariants: number
      files: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
    }

    expect(importResult.caseId).toBeGreaterThan(0)
    expect(importResult.totalVariants).toBeGreaterThan(0)

    // Both files must have been processed
    expect(importResult.files).toHaveLength(2)
    expect(importResult.files[0].error).toBeUndefined()
    expect(importResult.files[1].error).toBeUndefined()

    // totalVariants should equal sum of per-file counts
    const sumOfFiles = importResult.files.reduce((s, f) => s + f.variantCount, 0)
    expect(importResult.totalVariants).toBe(sumOfFiles)

    // Only ONE case should exist with this name
    const cases = expectSuccessfulIpcResult(results.cases)
    expect((cases as { total_count: number }).total_count).toBe(1)
    const caseRow = (cases as { data: Array<{ variant_count: number }> }).data[0]
    expect(caseRow.variant_count).toBe(importResult.totalVariants)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
