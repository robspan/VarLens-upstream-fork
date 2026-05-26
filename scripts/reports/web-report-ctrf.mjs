import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function normalizeStatus(status) {
  if (status === 'passed' || status === 'pass') return 'passed'
  if (status === 'failed' || status === 'fail') return 'failed'
  if (status === 'skipped' || status === 'pending' || status === 'todo') return 'skipped'
  return 'other'
}

function extractVitestTests(report, suiteId) {
  const tests = []
  const testResults = Array.isArray(report?.testResults) ? report.testResults : []
  for (const fileResult of testResults) {
    const filePath = typeof fileResult.name === 'string' ? fileResult.name : undefined
    const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : []
    for (const assertion of assertions) {
      const ancestors = Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles : []
      const name =
        typeof assertion.fullName === 'string' && assertion.fullName !== ''
          ? assertion.fullName
          : [...ancestors, assertion.title ?? 'unknown test'].join(' ')
      const messages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.join('\n')
        : undefined
      tests.push({
        name,
        status: normalizeStatus(assertion.status),
        duration: typeof assertion.duration === 'number' ? assertion.duration : 0,
        suite: suiteId,
        filePath,
        message: messages === '' ? undefined : messages,
        extra: { rawStatus: assertion.status, ancestorTitles: ancestors }
      })
    }
  }
  return tests
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) }
  }
}

async function suiteToCtrfTests(suite, runDir) {
  if (suite.kind !== 'vitest' || suite.vitestJsonPath === undefined) {
    return [
      {
        name: `${suite.id} command`,
        status:
          suite.exitCode === 0 ? 'passed' : suite.skipped && !suite.required ? 'skipped' : 'failed',
        duration: suite.durationMs ?? 0,
        suite: suite.id,
        message: suite.skipReason ?? suite.error,
        extra: {
          command: suite.command,
          required: suite.required,
          stdoutPath: suite.stdoutPath,
          stderrPath: suite.stderrPath
        }
      }
    ]
  }

  const report = await readJsonIfExists(resolve(runDir, suite.vitestJsonPath))
  const tests = extractVitestTests(report, suite.id)
  if (tests.length > 0) return tests

  return [
    {
      name: `${suite.id} vitest report`,
      status: suite.exitCode === 0 ? 'passed' : 'failed',
      duration: suite.durationMs ?? 0,
      suite: suite.id,
      message: report?.parseError ?? suite.error,
      extra: {
        command: suite.command,
        required: suite.required,
        vitestJsonPath: suite.vitestJsonPath,
        stdoutPath: suite.stdoutPath,
        stderrPath: suite.stderrPath
      }
    }
  ]
}

function summarizeTests(tests) {
  const summary = {
    tests: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    other: 0
  }
  for (const test of tests) {
    if (test.status === 'passed') summary.passed++
    else if (test.status === 'failed') summary.failed++
    else if (test.status === 'skipped') summary.skipped++
    else summary.other++
  }
  return summary
}

async function buildCtrf(manifest, runDir) {
  const tests = []
  for (const suite of manifest.suites) {
    tests.push(...(await suiteToCtrfTests(suite, runDir)))
  }

  const parityReportPath = resolve(runDir, 'parity', 'latest.json')
  const parityReport = await readJsonIfExists(parityReportPath)
  if (parityReport !== null && Array.isArray(parityReport.scenarios)) {
    for (const scenario of parityReport.scenarios) {
      tests.push({
        name: `data parity ${scenario.id}`,
        status: scenario.status === 'passed' ? 'passed' : 'failed',
        duration: typeof scenario.durationMs === 'number' ? scenario.durationMs : 0,
        suite: 'web-parity-e2e',
        message: scenario.error,
        extra: {
          type: 'data-manifest-parity',
          importMode: scenario.importMode,
          hashMatch: scenario.hashMatch,
          desktop: scenario.desktop,
          web: scenario.web
        }
      })
    }
  }

  const summary = summarizeTests(tests)
  return {
    reportFormat: 'CTRF',
    specVersion: '0.0.0',
    results: {
      tool: { name: 'VarLens web test report runner' },
      summary: {
        ...summary,
        start: manifest.startedAt,
        stop: manifest.finishedAt
      },
      tests
    },
    extra: {
      schemaVersion: 1,
      runId: manifest.runId,
      git: manifest.git,
      environment: manifest.environment
    }
  }
}

function suiteFailed(suite) {
  return suite.required === true && (suite.skipped === true || suite.exitCode !== 0)
}

function suitePassed(suite) {
  return suite.skipped !== true && suite.exitCode === 0
}

export { buildCtrf, readJsonIfExists, suiteFailed, suitePassed }
