import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

describe('web CI target wiring', () => {
  test('root Makefile keeps web CI explicit and Postgres-gated', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')

    expect(makefile).toMatch(/^web-ci: rebuild-node build-web web-gate-static web-gate-postgres/m)
    expect(makefile).toMatch(/^web-gate-postgres: build-web/m)
    expect(makefile).toContain('VARLENS_PG_URL is required for web-gate-postgres')
    expect(makefile).toMatch(/^ci: lint-check format-check typecheck rebuild-node test/m)
    expect(makefile).toMatch(/^VARLENS_WEB \?= 0/m)
    expect(makefile).not.toMatch(/wildcard web-deploy\/\.env/)
  })

  test('web report treats VARLENS_WEB=1 as full parity mode', () => {
    const runner = readFileSync(resolve(ROOT, 'scripts/reports/run-web-test-report.mjs'), 'utf8')

    expect(runner).toContain("const webMode = process.env.VARLENS_WEB === '1'")
    expect(runner).toContain(
      "const runParity = webMode || process.env.VARLENS_WEB_REPORT_PARITY === '1'"
    )
    expect(runner).toContain(
      "const runParityE2e = webMode || process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'"
    )
    expect(runner).toContain('loadLocalPostgresEnvForWebMode()')
    expect(runner).toContain('process.env.VARLENS_RECOVERY_KEY_DIR = resolve(runDir,')
    expect(runner).toContain('renderStakeholderReport(manifest, ctrf, reportAssessment)')
    expect(runner).toContain('buildReportAssessment(manifest)')
    expect(runner).toContain('compactReportPackage(runDir)')
    expect(runner).toContain('publishLatestReport(runDir)')
    expect(runner).toContain('hashMatch: scenario.hashMatch')
    expect(runner).toContain('matching SHA-256 fingerprints')
    expect(runner).toContain("hasIpcParityGaps ? 'incomplete' : 'passed'")
    expect(runner).toContain('Exact IPC parity:')
    expect(runner).toContain('Incomplete: IPC parity gaps')
    expect(runner).toContain('stakeholderIpcAreas')
    expect(runner).toContain('## IPC Parity Coverage')
    expect(runner).toContain('## Domain Data Parity')
    expect(runner).toContain('flatIpcHandlers')
    expect(runner).toContain('stakeholder-report.pdf')
    expect(runner).toContain("'stakeholder-report.md'")
    expect(runner).toContain("'vitest'")
    expect(runner).toContain(
      "skippedSuite('web-gate-postgres', 'VARLENS_PG_URL is not set', webMode)"
    )
  })

  test('web publish and release workflows run web-ci before building images', () => {
    const publish = readFileSync(resolve(ROOT, '.github/workflows/publish-web.yml'), 'utf8')
    const release = readFileSync(resolve(ROOT, '.github/workflows/release-web.yml'), 'utf8')

    expect(publish).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(publish).toMatch(/build-and-push:[\s\S]*?needs: web-ci/)
    expect(release).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(release).toMatch(/build-and-push:[\s\S]*?needs: \[resolve-version, web-ci\]/)
  })
})
