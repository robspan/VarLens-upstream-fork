/**
 * WGS import perf benchmark — SQLite backend.
 *
 * Gated by VARLENS_RUN_WGS_PERF=1. Imports the GIAB HG002 GRCh38 v4.2.1
 * high-confidence VCF into a fresh SQLite database, records elapsed time
 * to .planning/artifacts/perf/wgs-import/<ts>-sqlite.md, and asserts
 * elapsed < BUDGET_S.
 *
 * BUDGET_S defaults to 600 (10 minutes) and is overridable via
 * VARLENS_SQLITE_WGS_BUDGET_S.
 *
 * Setup:
 *   scripts/postgres/download-wgs-fixture.sh
 *   VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
 *
 * Companion script: scripts/perf/compare-wgs-import.mjs
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const SHOULD_RUN = process.env.VARLENS_RUN_WGS_PERF === '1'
const FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz'
)
const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/wgs-import')
const BUDGET_S = Number(process.env.VARLENS_SQLITE_WGS_BUDGET_S ?? '600')

function writeArtifact(elapsedSec: number): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(ARTIFACT_DIR, `${ts}-sqlite.md`)
  writeFileSync(
    path,
    [
      `# WGS import perf — sqlite`,
      ``,
      `- timestamp: ${ts}`,
      `- fixture: ${FIXTURE_PATH}`,
      `- elapsed: ${elapsedSec.toFixed(2)}s`,
      `- budget:   ${BUDGET_S.toFixed(2)}s (override via VARLENS_SQLITE_WGS_BUDGET_S)`,
      ``
    ].join('\n')
  )
  return path
}

describe.skipIf(!SHOULD_RUN)('sqlite VCF WGS import perf', () => {
  it(
    `imports the GIAB HG002 fixture into SQLite within ${BUDGET_S}s`,
    async () => {
      if (!existsSync(FIXTURE_PATH)) {
        throw new Error(
          `WGS fixture missing at ${FIXTURE_PATH}. Run scripts/postgres/download-wgs-fixture.sh first.`
        )
      }
      const fixtureSize = statSync(FIXTURE_PATH).size
      expect(fixtureSize).toBeGreaterThan(0)

      const { _electron: electron } = await import('@playwright/test')

      // Use a fresh isolation root so the SQLite DB is empty before import.
      const isolationRoot = mkdtempSync(join(tmpdir(), 'varlens-wgs-perf-'))
      const userDataDir = join(isolationRoot, 'user-data')
      const appDataDir = join(isolationRoot, 'app-data')
      mkdirSync(userDataDir, { recursive: true })
      mkdirSync(appDataDir, { recursive: true })

      const t0 = performance.now()
      const app = await electron.launch({
        args: ['./out/main/index.js'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          HOME: isolationRoot,
          XDG_CONFIG_HOME: appDataDir,
          XDG_DATA_HOME: appDataDir,
          VARLENS_APP_DATA_DIR: appDataDir,
          VARLENS_USER_DATA_DIR: userDataDir
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
          { filePath: FIXTURE_PATH, caseName: `WGS SQLite ${Date.now()}` }
        )
        const elapsedSec = (performance.now() - importT0) / 1000

        const isError =
          typeof result === 'object' && result !== null && 'code' in result && 'message' in result
        expect(isError).toBe(false)

        const totalSec = (performance.now() - t0) / 1000
        const artifactPath = writeArtifact(elapsedSec)
        // eslint-disable-next-line no-console
        console.log(
          `[wgs-perf] sqlite elapsed=${elapsedSec.toFixed(2)}s total=${totalSec.toFixed(2)}s artifact=${artifactPath}`
        )
        expect(elapsedSec).toBeLessThan(BUDGET_S)
      } finally {
        await app.close()
      }
    },
    BUDGET_S * 1000 + 60_000
  )
})
