import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

describe('web CI target wiring', () => {
  test('root Makefile keeps web CI explicit and Postgres-gated', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')

    expect(makefile).toMatch(/^web-ci: rebuild-node build-web web-gate-static web-gate-postgres/m)
    expect(makefile).toMatch(/^web-gate-postgres: build-web/m)
    expect(makefile).toMatch(/^web-gate-parity: web-data-verify/m)
    expect(makefile).toContain('VARLENS_PG_URL is required for web-gate-postgres')
    expect(makefile).toMatch(/^ci: lint-check format-check typecheck rebuild-node test/m)
    expect(makefile).toMatch(/^VARLENS_WEB \?= 0/m)
    expect(makefile).not.toMatch(/wildcard .*\.env/)
  })

  test('web report treats VARLENS_WEB=1 as full parity mode', () => {
    const reportFiles = {
      runner: readFileSync(resolve(ROOT, 'scripts/reports/run-web-test-report.mjs'), 'utf8'),
      context: readFileSync(resolve(ROOT, 'scripts/reports/web-report-context.mjs'), 'utf8'),
      ctrf: readFileSync(resolve(ROOT, 'scripts/reports/web-report-ctrf.mjs'), 'utf8'),
      data: readFileSync(resolve(ROOT, 'scripts/reports/web-report-data.mjs'), 'utf8'),
      stakeholder: readFileSync(
        resolve(ROOT, 'scripts/reports/web-report-stakeholder.mjs'),
        'utf8'
      ),
      pdf: readFileSync(resolve(ROOT, 'scripts/reports/web-report-pdf.mjs'), 'utf8')
    }
    const { runner } = reportFiles
    const combinedReportSource = Object.values(reportFiles).join('\n')

    expect(runner).toContain("const webMode = process.env.VARLENS_WEB === '1'")
    expect(runner).toContain(
      "const runParity = webMode || process.env.VARLENS_WEB_REPORT_PARITY === '1'"
    )
    expect(runner).toContain("process.env.VARLENS_WEB_REPORT_PARITY === '1'")
    expect(runner).toContain("process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'")
    expect(runner).toContain('loadLocalPostgresEnvForWebMode()')
    expect(runner).toContain('process.env.VARLENS_RECOVERY_KEY_DIR = resolve(runDir,')
    expect(runner).toContain('renderStakeholderReport(manifest, ctrf, reportAssessment)')
    expect(runner).toContain('buildReportAssessment(manifest, runDir)')
    expect(runner).toContain('compactReportPackage(runDir)')
    expect(runner).toContain('publishLatestReport(runDir)')
    expect(combinedReportSource).toContain('hashMatch: scenario.hashMatch')
    expect(combinedReportSource).toContain('matching SHA-256 fingerprints')
    expect(combinedReportSource).toContain("hasIpcParityGaps ? 'incomplete' : 'passed'")
    expect(combinedReportSource).toContain('Electron Postgres vs Web Postgres IPC parity:')
    expect(combinedReportSource).toContain('Incomplete: IPC parity gaps')
    expect(combinedReportSource).toContain('stakeholderIpcAreas')
    expect(combinedReportSource).toContain('## Abstract')
    expect(combinedReportSource).toContain('## Validation Scope')
    expect(combinedReportSource).toContain('## Methodology')
    expect(combinedReportSource).toContain('## IPC Traceability Matrix')
    expect(combinedReportSource).toContain('## Domain Data Parity')
    expect(combinedReportSource).toContain('## Limitations')
    expect(combinedReportSource).toContain('## Conclusion')
    expect(combinedReportSource).toContain('flatIpcHandlers')
    expect(combinedReportSource).toContain('stakeholder-report.pdf')
    expect(runner).toContain("'stakeholder-report.md'")
    expect(runner).toContain("'vitest'")
    expect(runner).toContain(
      "skippedSuite('web-gate-postgres', 'VARLENS_PG_URL is not set', webMode)"
    )
  })

  test('web publish workflow runs web-ci before building images', () => {
    const publish = readFileSync(resolve(ROOT, '.github/workflows/publish-web.yml'), 'utf8')

    expect(publish).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(publish).toMatch(/build-and-push:[\s\S]*?needs: web-ci/)
    expect(publish).not.toMatch(/branches: \[main\]/)
    expect(publish).toMatch(/Trivy gate[\s\S]*?Push scanned image/)
  })
})
