/**
 * E2E test: PostgreSQL VCF extension-table imports (SV, CNV, STR).
 *
 * Imports three synthetic VCF files that exercise the variant_sv, variant_cnv,
 * and variant_str extension tables respectively, then verifies the type counts
 * returned by variants.typeCounts.
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

const PG_ENV = {
  VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
  VARLENS_PG_URL:
    process.env.VARLENS_PG_URL ??
    'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
  VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
}

test('postgres dev mode imports synthetic-sv.vcf and populates variant_sv', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({ env: PG_ENV })
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const svPath = join(process.cwd(), 'tests/test-data/vcf/synthetic-sv.vcf')
    const caseName = `PG VCF SV ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ svPath, caseName }) => {
        // synthetic-sv.vcf has sample "SAMPLE1" and no annotation format hint
        const importResult = await window.api.import.start(svPath, caseName, {
          selectedSample: 'SAMPLE1',
          genomeBuild: 'GRCh38'
        })
        const caseId =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? 0
            : (importResult as { caseId: number }).caseId
        return {
          importResult,
          typeCounts: await window.api.variants.typeCounts(caseId)
        }
      },
      { svPath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect((importResult as { caseId: number }).caseId).toBeGreaterThan(0)

    const typeCounts = expectSuccessfulIpcResult(results.typeCounts)
    // synthetic-sv.vcf contains structural variants
    const svCount = (typeCounts as { sv?: number }).sv ?? 0
    expect(svCount).toBeGreaterThan(0)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})

test('postgres dev mode imports synthetic-cnv.vcf and populates variant_cnv', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({ env: PG_ENV })
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const cnvPath = join(process.cwd(), 'tests/test-data/vcf/synthetic-cnv.vcf')
    const caseName = `PG VCF CNV ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ cnvPath, caseName }) => {
        // synthetic-cnv.vcf has sample "SAMPLE1"
        const importResult = await window.api.import.start(cnvPath, caseName, {
          selectedSample: 'SAMPLE1',
          genomeBuild: 'GRCh38'
        })
        const caseId =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? 0
            : (importResult as { caseId: number }).caseId
        return {
          importResult,
          typeCounts: await window.api.variants.typeCounts(caseId)
        }
      },
      { cnvPath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect((importResult as { caseId: number }).caseId).toBeGreaterThan(0)

    const typeCounts = expectSuccessfulIpcResult(results.typeCounts)
    // synthetic-cnv.vcf contains copy-number variants
    const cnvCount = (typeCounts as { cnv?: number }).cnv ?? 0
    expect(cnvCount).toBeGreaterThan(0)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})

test('postgres dev mode imports synthetic-str.vcf and populates variant_str', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({ env: PG_ENV })
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const strPath = join(process.cwd(), 'tests/test-data/vcf/synthetic-str.vcf')
    const caseName = `PG VCF STR ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ strPath, caseName }) => {
        // synthetic-str.vcf — check its CHROM line for the sample name;
        // it uses a single sample. selectedSample is auto-detected if omitted.
        const importResult = await window.api.import.start(strPath, caseName, {
          genomeBuild: 'GRCh38'
        })
        const caseId =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? 0
            : (importResult as { caseId: number }).caseId
        return {
          importResult,
          typeCounts: await window.api.variants.typeCounts(caseId)
        }
      },
      { strPath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect((importResult as { caseId: number }).caseId).toBeGreaterThan(0)

    const typeCounts = expectSuccessfulIpcResult(results.typeCounts)
    // synthetic-str.vcf contains short tandem repeat variants
    const strCount = (typeCounts as { str?: number }).str ?? 0
    expect(strCount).toBeGreaterThan(0)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
