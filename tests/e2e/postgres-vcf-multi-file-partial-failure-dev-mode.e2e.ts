/**
 * E2E test: PostgreSQL VCF multi-file import with a per-file failure.
 *
 * Imports two files: the first is a valid VEP-annotated VCF, the second is
 * a deliberately malformed VCF written to a temp file at runtime. Verifies
 * that:
 * - The IPC call succeeds at the envelope level (no top-level rejection)
 * - files[0].error is undefined (valid file succeeded)
 * - files[1].error is a non-empty string (bad file failed gracefully)
 * - The case's variant_count reflects only file 1's variants
 * - Post-loop bookkeeping ran (max_internal_af: 1 returns rows from file 1)
 *
 * Requires:
 *   VARLENS_RUN_POSTGRES_E2E=1
 *   Docker container: postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
 */
import { expect, test } from '@playwright/test'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('postgres dev mode multi-file import surfaces per-file errors without aborting the session', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  // Create a temp directory + malformed VCF before launching Electron so the
  // path is available to both the test runner and the renderer evaluate call.
  const tmpDir = mkdtempSync(join(tmpdir(), 'varlens-pg-e2e-partial-'))
  const malformedPath = join(tmpDir, 'malformed.vcf')
  writeFileSync(
    malformedPath,
    [
      '##fileformat=VCFv4.2',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE1',
      'NOT_A_VALID_VCF_LINE'
    ].join('\n')
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

    const validPath = join(process.cwd(), 'tests/test-data/vcf/single-sample.vep.vcf.gz')
    const caseName = `PG Multi-File Partial Failure ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ validPath, malformedPath, caseName }) => {
        const importResult = await window.api.import.startMultiFile(
          caseName,
          [
            {
              filePath: validPath,
              variantType: 'snv-indel',
              annotationFormat: 'csq',
              caller: null
            },
            {
              filePath: malformedPath,
              variantType: 'snv-indel',
              annotationFormat: null,
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
          cases: await window.api.cases.query({ limit: 25, offset: 0, search_term: caseName }),
          internalAf:
            caseId > 0
              ? await window.api.variants.query(caseId, { max_internal_af: 1 }, 0, 25)
              : null
        }
      },
      { validPath, malformedPath, caseName }
    )

    // The IPC envelope must succeed (not a SerializableError)
    const importResult = expectSuccessfulIpcResult(results.importResult) as {
      caseId: number
      totalVariants: number
      files: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
    }

    expect(importResult.caseId).toBeGreaterThan(0)
    expect(importResult.files).toHaveLength(2)

    // File 0 (valid VCF) must have succeeded
    expect(importResult.files[0].error).toBeUndefined()
    expect(importResult.files[0].variantCount).toBeGreaterThan(0)

    // File 1 (malformed VCF) must have a per-file error message
    expect(importResult.files[1].error).toBeTruthy()

    // Case variant_count should reflect only file 0's variants
    const cases = expectSuccessfulIpcResult(results.cases)
    const caseRow = (cases as { data: Array<{ variant_count: number }> }).data[0]
    expect(caseRow.variant_count).toBe(importResult.files[0].variantCount)

    // Post-loop bookkeeping: frequency rebuild ran for file 0's variants
    if (results.internalAf !== null) {
      const internalAf = expectSuccessfulIpcResult(results.internalAf)
      expect((internalAf as { total_count: number }).total_count).toBeGreaterThan(0)
    }
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
    // Remove temp files regardless of test outcome
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // swallow — temp dir cleanup is best-effort
    }
  }
})
