/**
 * WGS import perf benchmark — PostgreSQL backend.
 *
 * Gated by VARLENS_RUN_WGS_PERF=1. Imports the GIAB HG002 GRCh38 v4.2.1
 * high-confidence VCF (downloaded by scripts/postgres/download-wgs-fixture.sh
 * to tests/.cache/wgs/) into a freshly reset postgres schema, records elapsed
 * time to .planning/artifacts/perf/wgs-import/<ts>-postgres.md, and asserts
 * elapsed < BUDGET_S.
 *
 * BUDGET_S defaults to 600 (10 minutes) and is overridable via
 * VARLENS_PG_WGS_BUDGET_S. After the first measured baseline, set the env to
 * 1.5× the measured time so future regressions trip the assertion.
 *
 * Setup:
 *   scripts/postgres/download-wgs-fixture.sh    # one-time fixture download
 *   make pg-reset && make pg-up                 # fresh schema, container up
 *   VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
 *   make pg-down
 *
 * Companion script: scripts/perf/compare-wgs-import.mjs
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const SHOULD_RUN = process.env.VARLENS_RUN_WGS_PERF === '1'
const FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz'
)
const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/wgs-import')
const BUDGET_S = Number(process.env.VARLENS_PG_WGS_BUDGET_S ?? '600')

function writeArtifact(elapsedSec: number): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(ARTIFACT_DIR, `${ts}-postgres.md`)
  writeFileSync(
    path,
    [
      `# WGS import perf — postgres`,
      ``,
      `- timestamp: ${ts}`,
      `- fixture: ${FIXTURE_PATH}`,
      `- elapsed: ${elapsedSec.toFixed(2)}s`,
      `- budget:   ${BUDGET_S.toFixed(2)}s (override via VARLENS_PG_WGS_BUDGET_S)`,
      ``
    ].join('\n')
  )
  return path
}

describe.skipIf(!SHOULD_RUN)('postgres VCF WGS import perf', () => {
  it(
    `imports the GIAB HG002 fixture into PG within ${BUDGET_S}s`,
    async () => {
      if (!existsSync(FIXTURE_PATH)) {
        throw new Error(
          `WGS fixture missing at ${FIXTURE_PATH}. Run scripts/postgres/download-wgs-fixture.sh first.`
        )
      }
      const fixtureSize = statSync(FIXTURE_PATH).size
      expect(fixtureSize).toBeGreaterThan(0)

      // Lazy-import the Electron harness so this file's body does not pull in
      // playwright when the test is skipped.
      const { _electron: electron } = await import('@playwright/test')

      const t0 = performance.now()
      const app = await electron.launch({
        args: ['./out/main/index.js'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
          VARLENS_PG_URL:
            process.env.VARLENS_PG_URL ??
            'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
          VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
        }
      })
      try {
        const window = await app.firstWindow()
        await window.waitForLoadState('domcontentloaded')

        const importT0 = performance.now()
        const result = await window.evaluate(
          async ({ filePath, caseName }) => {
            return await window.api.import.start(filePath, caseName, {
              selectedSample: 'HG002',
              genomeBuild: 'GRCh38'
            })
          },
          { filePath: FIXTURE_PATH, caseName: `WGS PG ${Date.now()}` }
        )
        const elapsedSec = (performance.now() - importT0) / 1000

        // The IPC envelope returns either the success body or a SerializableError.
        // Treat any string-keyed `code` field as failure.
        const isError =
          typeof result === 'object' && result !== null && 'code' in result && 'message' in result
        expect(isError).toBe(false)

        const totalSec = (performance.now() - t0) / 1000
        const artifactPath = writeArtifact(elapsedSec)
        // eslint-disable-next-line no-console
        console.log(
          `[wgs-perf] postgres elapsed=${elapsedSec.toFixed(2)}s total=${totalSec.toFixed(2)}s artifact=${artifactPath}`
        )
        expect(elapsedSec).toBeLessThan(BUDGET_S)
      } finally {
        await app.close()
      }
    },
    BUDGET_S * 1000 + 60_000
  )
})
