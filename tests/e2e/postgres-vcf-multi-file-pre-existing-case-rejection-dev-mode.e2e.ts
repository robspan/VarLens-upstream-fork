/**
 * E2E test: PostgreSQL multi-file import rejects a pre-existing case name.
 *
 * Steps:
 * 1. Pre-import a case via import:start to create it.
 * 2. Try import:startMultiFile with the SAME case name.
 * 3. Assert the result indicates failure (either IPC-level error or
 *    per-file error containing "already exists").
 * 4. Verify the original case is unchanged.
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

test('postgres dev mode multi-file import rejects a pre-existing case name', async () => {
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
    const caseName = `PreExisting ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ vcfPath, caseName }) => {
        // Step 1: create the case via single-file import
        const firstImport = await window.api.import.start(vcfPath, caseName, {
          selectedSample: 'HG005',
          genomeBuild: 'GRCh38'
        })

        const originalVariantCount =
          typeof firstImport === 'object' &&
          firstImport !== null &&
          !('code' in firstImport)
            ? (firstImport as { variantCount: number }).variantCount
            : 0

        // Step 2: attempt multi-file import with the same case name
        const secondImport = await window.api.import.startMultiFile(
          caseName,
          [
            {
              filePath: vcfPath,
              variantType: 'snv-indel',
              annotationFormat: 'csq',
              caller: null
            }
          ],
          { selectedSample: 'HG005', genomeBuild: 'GRCh38' }
        )

        // Step 3: re-query the original case to confirm it is unchanged
        const casesAfter = await window.api.cases.query({
          limit: 25,
          offset: 0,
          search_term: caseName
        })

        return { firstImport, secondImport, casesAfter, originalVariantCount }
      },
      { vcfPath, caseName }
    )

    // Step 1 must have succeeded
    const firstImport = expectSuccessfulIpcResult(results.firstImport)
    expect((firstImport as { caseId: number }).caseId).toBeGreaterThan(0)

    // Step 2: the second import must indicate failure.
    // The postgres worker throws "case '...' already exists — cannot create a duplicate"
    // which surfaces either as a SerializableError on the IPC envelope OR as an
    // error on files[0]. Accept either form.
    const secondImport = results.secondImport as
      | { code: string; message: string; userMessage: string }
      | {
          caseId: number
          files: Array<{ error?: string }>
          errors?: string[]
        }

    const isEnvelopeError = 'code' in secondImport && 'message' in secondImport
    const isFileError =
      !isEnvelopeError &&
      'files' in secondImport &&
      Array.isArray(secondImport.files) &&
      secondImport.files.length > 0 &&
      typeof secondImport.files[0].error === 'string' &&
      secondImport.files[0].error.length > 0

    expect(isEnvelopeError || isFileError).toBe(true)

    if (isEnvelopeError) {
      expect((secondImport as { message: string }).message).toContain('already exists')
    } else if (isFileError) {
      expect((secondImport as { files: Array<{ error?: string }> }).files[0].error).toContain(
        'already exists'
      )
    }

    // Step 4: original case is unchanged — still exactly 1 case with the original variant count
    const casesAfter = expectSuccessfulIpcResult(results.casesAfter)
    expect((casesAfter as { total_count: number }).total_count).toBe(1)
    const caseRow = (casesAfter as { data: Array<{ variant_count: number }> }).data[0]
    expect(caseRow.variant_count).toBe(results.originalVariantCount)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
