/**
 * E2E test: PostgreSQL import does not block the renderer.
 *
 * Starts a multi-file import of two VCF files and, while it runs, issues 10
 * consecutive cases:list IPC calls at ~100 ms intervals. Each call must
 * complete within 250 ms (measured wall-clock in the renderer). This confirms
 * that the import worker does not starve the IPC message pump.
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

test('postgres dev mode renderer stays responsive during a multi-file VCF import', async () => {
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
    const caseName = `PG Renderer Responsive ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ vepPath, snpeffPath, caseName }) => {
        // Start the multi-file import without awaiting — let it run in the background
        const importPromise = window.api.import.startMultiFile(
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

        // While the import runs, issue 10 cases:list calls and record latencies
        const latencies: number[] = []
        for (let i = 0; i < 10; i++) {
          const t0 = Date.now()
          await window.api.cases.list()
          latencies.push(Date.now() - t0)
          await new Promise<void>((r) => setTimeout(r, 100))
        }

        // Wait for import to finish before returning
        await importPromise

        return { maxLatency: Math.max(...latencies), latencies }
      },
      { vepPath, snpeffPath, caseName }
    )

    // Each cases:list must have completed within 250 ms
    expect(results.maxLatency).toBeLessThan(250)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
