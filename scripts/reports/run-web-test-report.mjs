#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { log } from 'node:console'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const artifactRoot = resolve(repoRoot, '.planning/artifacts/web/test-reporting')
const latestDir = resolve(artifactRoot, 'latest')
const runsDir = resolve(artifactRoot, 'runs')
const webMode = process.env.VARLENS_WEB === '1'
const ipcDomainDirs = {
  shared: 'src/shared/ipc/domains',
  preload: 'src/preload/domains',
  main: 'src/main/ipc/domains'
}
const flatIpcHandlers = ['shell', 'shortlist', 'system', 'updater']
const stakeholderIpcAreas = [
  { id: 'analysis-groups', label: 'Analysis Groups' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'batch-import', label: 'Batch Import' },
  { id: 'case-comments', label: 'Case Comments' },
  { id: 'case-metadata', label: 'Case Metadata' },
  { id: 'case-metrics', label: 'Case Metrics' },
  { id: 'cases', label: 'Cases' },
  { id: 'cohort', label: 'Cohort' },
  { id: 'database', label: 'Database' },
  { id: 'export', label: 'Export' },
  { id: 'presets', label: 'Filter Presets' },
  { id: 'gene-lists', label: 'Gene Lists' },
  { id: 'gene-ref', label: 'Gene Reference' },
  { id: 'hpo', label: 'HPO' },
  { id: 'import', label: 'Import' },
  { id: 'panels', label: 'Panels' },
  { id: 'protein', label: 'Protein' },
  { id: 'region-files', label: 'Region Files' },
  { id: 'tags', label: 'Tags' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'variants', label: 'Variants' },
  { id: 'vep', label: 'VEP' }
]
const stakeholderIpcSharedIds = {
  audit: 'audit-log',
  presets: 'filter-presets'
}

function loadLocalPostgresEnvForWebMode() {
  if (!webMode || process.env.VARLENS_PG_URL !== undefined) return

  const envPath = resolve(repoRoot, '.env.postgres.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/u)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, '')
    if (key !== '' && process.env[key] === undefined) process.env[key] = value
  }
}

loadLocalPostgresEnvForWebMode()

const hasPg = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const runParity = webMode || process.env.VARLENS_WEB_REPORT_PARITY === '1'
const runParityE2e = webMode || process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'
const shouldBuild = process.env.VARLENS_WEB_REPORT_BUILD !== '0'

function isoForPath(date) {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '-')
}

async function exec(command, args, options) {
  const startedAt = new Date()
  const childEnv = {
    ...process.env,
    CI: process.env.CI ?? '1',
    ...(options.env ?? {})
  }
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    process.stderr.write(chunk)
  })

  const exitCode = await new Promise((resolveExit) => {
    child.on('close', (code) => resolveExit(code ?? 1))
  })
  const finishedAt = new Date()

  await mkdir(dirname(options.stdoutPath), { recursive: true })
  await writeFile(options.stdoutPath, stdout, 'utf8')
  await writeFile(options.stderrPath, stderr, 'utf8')

  return {
    command,
    args,
    displayCommand: [command, ...args].join(' '),
    exitCode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stdoutPath: relative(options.stdoutPath),
    stderrPath: relative(options.stderrPath)
  }
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path
}

function vitestArgs(id, extraArgs, jsonPath, junitPath) {
  return [
    'vitest',
    'run',
    ...extraArgs,
    '--reporter=default',
    '--reporter=json',
    '--reporter=junit',
    `--outputFile.json=${jsonPath}`,
    `--outputFile.junit=${junitPath}`
  ]
}

function suitePaths(runDir, id) {
  return {
    json: resolve(runDir, 'vitest', `${id}.json`),
    junit: resolve(runDir, 'junit', `${id}.xml`),
    stdout: resolve(runDir, 'logs', `${id}.stdout.log`),
    stderr: resolve(runDir, 'logs', `${id}.stderr.log`)
  }
}

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

  const parityReportPath = resolve(repoRoot, '.planning/artifacts/web/parity/latest.json')
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

function renderSummary(manifest, ctrf, reportAssessment) {
  const summary = ctrf.results.summary
  const status = manifest.status.toUpperCase()
  const lines = [
    '# Web Test Report',
    '',
    `Status: ${status}`,
    `Harness status: ${(manifest.harnessStatus ?? manifest.status).toUpperCase()}`,
    `Exact IPC parity: ${reportAssessment.exactIpcParityCount}/${stakeholderIpcAreas.length}`,
    `Run ID: ${manifest.runId}`,
    `Started: ${manifest.startedAt}`,
    `Finished: ${manifest.finishedAt}`,
    `Git: ${manifest.git.branch ?? 'unknown'} @ ${manifest.git.sha ?? 'unknown'}${
      manifest.git.dirty ? ' (dirty)' : ''
    }`,
    '',
    '## Suites',
    '',
    '| Suite | Required | Result | Exit | Duration ms | Command |',
    '| --- | --- | --- | ---: | ---: | --- |'
  ]

  for (const suite of manifest.suites) {
    const result = suite.skipped
      ? `skipped: ${suite.skipReason}`
      : suite.exitCode === 0
        ? 'passed'
        : 'failed'
    lines.push(
      `| ${suite.id} | ${suite.required ? 'yes' : 'no'} | ${result} | ${
        suite.exitCode ?? ''
      } | ${suite.durationMs ?? 0} | \`${suite.command ?? ''}\` |`
    )
  }

  lines.push(
    '',
    '## Test Cases',
    '',
    `Total: ${summary.tests}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Skipped: ${summary.skipped}`,
    `Other: ${summary.other}`,
    '',
    '## Artifacts',
    '',
    `- Stakeholder PDF: \`${relative(resolve(latestDir, 'stakeholder-report.pdf'))}\``,
    `- Technical summary: \`${relative(resolve(latestDir, 'summary.md'))}\``,
    `- Logs: \`${relative(resolve(latestDir, 'logs'))}\``
  )

  const failures = ctrf.results.tests.filter((test) => test.status === 'failed')
  if (failures.length > 0) {
    lines.push('', '## Failures', '')
    for (const failure of failures.slice(0, 30)) {
      lines.push(
        `- ${failure.suite}: ${failure.name}${failure.message ? ` — ${failure.message}` : ''}`
      )
    }
    if (failures.length > 30) lines.push(`- ... ${failures.length - 30} more failures`)
  }

  return `${lines.join('\n')}\n`
}

function suiteById(manifest, id) {
  return manifest.suites.find((suite) => suite.id === id)
}

function suiteStatusLabel(suite) {
  if (suite === undefined) return 'Not run'
  if (suite.skipped) return suite.required ? 'Not completed' : 'Not applicable'
  return suite.exitCode === 0 ? 'Passed' : 'Failed'
}

function suiteStatusSentence(suite, passedText, skippedText, failedText) {
  if (suite === undefined) return 'Not run in this report.'
  if (suite.skipped) return skippedText
  return suite.exitCode === 0 ? passedText : failedText
}

function listIpcDomains(relativeDir) {
  const abs = resolve(repoRoot, relativeDir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .filter((file) => statSync(resolve(abs, file)).isFile())
    .map((file) => file.replace(/\.ts$/u, ''))
    .sort()
}

function ipcContractInventory() {
  const shared = listIpcDomains(ipcDomainDirs.shared)
  const preload = listIpcDomains(ipcDomainDirs.preload)
  const main = listIpcDomains(ipcDomainDirs.main)
  const preloadSet = new Set(preload)
  const mainSet = new Set(main)
  const sharedSet = new Set(shared)

  return {
    shared,
    preload,
    main,
    missingPreload: shared.filter((domain) => !preloadSet.has(domain)),
    missingMain: shared.filter((domain) => !mainSet.has(domain)),
    orphanPreload: preload.filter((domain) => !sharedSet.has(domain)),
    orphanMain: main.filter((domain) => !sharedSet.has(domain))
  }
}

function buildIpcParityMatrix(ipcInventory, ipcParityReport, paritySuite) {
  const sharedSet = new Set(ipcInventory.shared)
  const preloadSet = new Set(ipcInventory.preload)
  const mainSet = new Set(ipcInventory.main)
  const ipcResults = Array.isArray(ipcParityReport?.results) ? ipcParityReport.results : []
  const resultByArea = new Map(ipcResults.map((result) => [result.area, result]))
  const hasExactParityRun =
    paritySuite !== undefined &&
    suitePassed(paritySuite) &&
    ipcParityReport?.status === 'passed' &&
    ipcParityReport?.validatedIpcAreas === stakeholderIpcAreas.length &&
    ipcParityReport?.passedIpcAreas === stakeholderIpcAreas.length &&
    ipcParityReport?.failedIpcAreas === 0

  return stakeholderIpcAreas.map((area) => {
    const sharedId = stakeholderIpcSharedIds[area.id] ?? area.id
    const surfacePassed =
      sharedSet.has(sharedId) && preloadSet.has(sharedId) && mainSet.has(sharedId)
    const ipcResult = resultByArea.get(area.id)
    const hashMatch =
      ipcResult?.desktopHash !== null &&
      ipcResult?.desktopHash !== undefined &&
      ipcResult.desktopHash === ipcResult.webHash
    const exactParity = hasExactParityRun && ipcResult?.status === 'passed' && hashMatch
    return {
      ...area,
      surfacePassed,
      exactParity,
      result: exactParity ? 'Exact parity passed' : 'Parity test needed',
      evidence: exactParity
        ? `Scenario passed with matching result hash ${shortHash(ipcResult.desktopHash)} across ${ipcResult.operationCount ?? 0} operation(s).`
        : ipcResult === undefined
          ? 'No domain-specific desktop/web result parity scenario was recorded in this report.'
          : `Scenario ${ipcResult.status}; desktop hash ${shortHash(ipcResult.desktopHash)}, web hash ${shortHash(ipcResult.webHash)}.`
    }
  })
}

function shortHash(hash) {
  return typeof hash === 'string' && hash !== '' ? hash.slice(0, 12) : 'not available'
}

function queryMatchSummary(scenario) {
  const desktop = scenario.desktop?.queryCounts
  const web = scenario.web?.queryCounts
  if (desktop === undefined || web === undefined) return 'not recorded'

  return [
    `all ${desktop.all ?? 0}/${web.all ?? 0}`,
    `high impact ${desktop.highImpact ?? 0}/${web.highImpact ?? 0}`,
    `ClinVar pathogenic ${desktop.clinvarPathogenic ?? 0}/${web.clinvarPathogenic ?? 0}`
  ].join('; ')
}

async function buildReportAssessment(manifest) {
  const parityReport = await readJsonIfExists(
    resolve(repoRoot, '.planning/artifacts/web/parity/latest.json')
  )
  const ipcParityReport = await readJsonIfExists(
    resolve(repoRoot, '.planning/artifacts/web/parity/latest-ipc.json')
  )
  const parityScenarios = Array.isArray(parityReport?.scenarios) ? parityReport.scenarios : []
  const ipcInventory = ipcContractInventory()
  const paritySuite =
    suiteById(manifest, 'web-parity-e2e') ?? suiteById(manifest, 'web-gate-parity')
  const ipcParityMatrix = buildIpcParityMatrix(ipcInventory, ipcParityReport, paritySuite)
  const exactIpcParityCount = ipcParityMatrix.filter((row) => row.exactParity).length
  const hasIpcParityGaps = exactIpcParityCount < stakeholderIpcAreas.length
  const requiredFailure = manifest.suites.some(suiteFailed)
  const status = requiredFailure ? 'failed' : hasIpcParityGaps ? 'incomplete' : 'passed'
  const label =
    status === 'passed'
      ? 'Passed'
      : status === 'incomplete'
        ? 'Incomplete: IPC parity gaps'
        : 'Needs attention'

  return {
    status,
    label,
    parityScenarios,
    ipcParityReport,
    ipcInventory,
    ipcParityMatrix,
    exactIpcParityCount,
    hasIpcParityGaps
  }
}

async function renderStakeholderReport(manifest, ctrf, reportAssessment) {
  const summary = ctrf.results.summary
  const requiredSuites = manifest.suites.filter((suite) => suite.required)
  const failedSuites = requiredSuites.filter(suiteFailed)
  const nonBlockingSkipped = ctrf.results.tests.filter((test) => test.status === 'skipped').length
  const { parityScenarios, ipcInventory, ipcParityMatrix, exactIpcParityCount, hasIpcParityGaps } =
    reportAssessment
  const passedParityScenarios = parityScenarios.filter((scenario) => scenario.status === 'passed')
  const matchedParityHashes = parityScenarios.filter((scenario) => scenario.hashMatch === true)
  const totalDesktopVariants = parityScenarios.reduce(
    (total, scenario) => total + (scenario.desktop?.totalVariants ?? 0),
    0
  )
  const totalWebVariants = parityScenarios.reduce(
    (total, scenario) => total + (scenario.web?.totalVariants ?? 0),
    0
  )
  const staticSuite = suiteById(manifest, 'web-gate-static')
  const paritySuite =
    suiteById(manifest, 'web-parity-e2e') ?? suiteById(manifest, 'web-gate-parity')
  const dataParitySuite = suiteById(manifest, 'web-parity-e2e')
  const status =
    manifest.status === 'passed'
      ? 'Passed'
      : manifest.status === 'incomplete'
        ? 'Incomplete: IPC parity gaps'
        : 'Needs attention'
  const ipcSurfacePassed =
    staticSuite !== undefined &&
    suitePassed(staticSuite) &&
    ipcInventory.missingPreload.length === 0 &&
    ipcInventory.missingMain.length === 0 &&
    ipcInventory.orphanPreload.length === 0 &&
    ipcInventory.orphanMain.length === 0

  const lines = [
    '# VarLens Web Validation Report',
    '',
    `Overall result: ${status}`,
    '',
    `Run completed: ${manifest.finishedAt ?? 'not finished'}`,
    `Code version: ${manifest.git.branch ?? 'unknown'} @ ${manifest.git.sha ?? 'unknown'}${
      manifest.git.dirty ? ' (local changes present)' : ''
    }`,
    '',
    '## Executive Summary',
    '',
    manifest.status === 'passed'
      ? 'The web validation run completed successfully. Required web checks, PostgreSQL-backed behavior checks, desktop-to-web parity checks, and per-IPC parity checks all passed.'
      : manifest.status === 'incomplete'
        ? 'The web validation harness completed without required suite failures, but the report is incomplete because exact desktop/web parity is only proven for a subset of stakeholder IPC areas.'
        : 'The web validation run did not complete successfully. At least one required validation area needs review before this result should be used as release evidence.',
    '',
    `The run evaluated ${summary.tests} checks: ${summary.passed} passed, ${summary.failed} failed, and ${summary.skipped} were marked as non-blocking or not applicable by the harness.`,
    '',
    '## What Was Validated',
    '',
    '| Area | Result | What it means |',
    '| --- | --- | --- |'
  ]

  const dataSuites = ['web-data-gather', 'web-data-prepare', 'web-data-verify'].map((id) =>
    suiteById(manifest, id)
  )
  const dataPassed = dataSuites.every((suite) => suite !== undefined && suitePassed(suite))
  lines.push(
    `| Test data preparation | ${dataPassed ? 'Passed' : 'Needs attention'} | Public/local fixture sources were gathered, transformed, and verified before application tests ran. |`
  )

  lines.push(
    `| IPC/API surface checks | ${suiteStatusLabel(staticSuite)} | ${suiteStatusSentence(
      staticSuite,
      `${stakeholderIpcAreas.length} stakeholder-facing IPC areas are listed separately from domain data parity.`,
      'Static web checks were not part of this run.',
      'IPC/API surface checks reported failures.'
    )} |`
  )

  const postgresSuite = suiteById(manifest, 'web-gate-postgres')
  lines.push(
    `| PostgreSQL-backed web behavior | ${suiteStatusLabel(postgresSuite)} | ${suiteStatusSentence(
      postgresSuite,
      'The web server ran against PostgreSQL and passed its required integration checks.',
      'PostgreSQL-backed checks were not run.',
      'PostgreSQL-backed web checks reported failures.'
    )} |`
  )

  lines.push(
    `| Desktop-to-web behavior parity | ${
      hasIpcParityGaps && suitePassed(paritySuite) ? 'Partial' : suiteStatusLabel(paritySuite)
    } | ${suiteStatusSentence(
      paritySuite,
      hasIpcParityGaps
        ? `Representative workflows matched, but exact parity is only proven for ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas.`
        : 'Representative desktop and web behavior matched for the covered workflows.',
      'Behavior parity checks were not run.',
      'Desktop-to-web behavior parity reported failures.'
    )} |`
  )

  lines.push(
    `| Per-IPC exact parity | ${
      hasIpcParityGaps ? 'Incomplete' : 'Passed'
    } | ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas have exact desktop/web result parity evidence. |`
  )

  lines.push(
    `| Domain data parity | ${suiteStatusLabel(dataParitySuite)} | ${suiteStatusSentence(
      dataParitySuite,
      'Manifest-backed fixtures imported and queried consistently on desktop SQLite and web PostgreSQL, with normalized result hashes recorded for each scenario.',
      'Manifest-backed data parity was not run.',
      'Manifest-backed data parity reported failures.'
    )} |`
  )

  lines.push(
    '',
    '## IPC Parity Coverage',
    '',
    'IPC in this report means the typed Electron bridge from renderer code to main-process handlers: shared contract, preload binding, and main handler. This section lists the 23 stakeholder-facing IPC areas separately from the domain data fixture scenarios.',
    '',
    `${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas have exact desktop/web result parity evidence in this run. Rows marked "Parity test needed" have their communication surface checked, but still need a domain-specific parity scenario before they should be treated as exact-result parity.`,
    '',
    '| IPC Area | Surface Wiring | Exact Result Parity | Evidence |',
    '| --- | --- | --- | --- |'
  )

  for (const row of ipcParityMatrix) {
    lines.push(
      `| ${row.label} | ${row.surfacePassed ? 'Passed' : 'Needs attention'} | ${row.result} | ${row.evidence} |`
    )
  }

  lines.push(
    '',
    '### Technical IPC Contract Inventory',
    '',
    '| IPC Surface | Expected From Shared Contract | Verified In This Run | Result |',
    '| --- | ---: | --- | --- |',
    `| Domain-module IPC contracts | ${ipcInventory.shared.length} | ${ipcInventory.shared.length} shared contract files inspected | ${ipcSurfacePassed ? 'Passed' : 'Needs attention'} |`,
    `| Preload IPC bindings | ${ipcInventory.shared.length} | ${ipcInventory.preload.length} present, ${ipcInventory.missingPreload.length} missing, ${ipcInventory.orphanPreload.length} orphaned | ${ipcInventory.missingPreload.length === 0 && ipcInventory.orphanPreload.length === 0 ? 'Passed' : 'Needs attention'} |`,
    `| Main-process IPC handlers | ${ipcInventory.shared.length} | ${ipcInventory.main.length} present, ${ipcInventory.missingMain.length} missing, ${ipcInventory.orphanMain.length} orphaned | ${ipcInventory.missingMain.length === 0 && ipcInventory.orphanMain.length === 0 ? 'Passed' : 'Needs attention'} |`,
    `| Flat legacy IPC handlers | ${flatIpcHandlers.length} | ${flatIpcHandlers.join(', ')} are tracked outside the domain-module count | Tracked separately |`,
    '',
    `Domain-module IPC names: ${ipcInventory.shared.join(', ')}.`,
    '',
    '## Domain Data Parity',
    ''
  )

  if (parityScenarios.length > 0) {
    lines.push(
      `${passedParityScenarios.length} of ${parityScenarios.length} manifest-backed scenarios passed. Desktop produced ${totalDesktopVariants} variants and web produced ${totalWebVariants} variants across the compared fixtures.`,
      `${matchedParityHashes.length} of ${parityScenarios.length} scenarios produced matching SHA-256 fingerprints over the normalized desktop and web results. The assertion also compares the normalized result objects directly; the hash is included as compact stakeholder evidence.`,
      '',
      '| Fixture Set | Data Type / Mode | Result | Variant Match | Query Match | Result Fingerprint |',
      '| --- | --- | --- | --- | --- | --- |'
    )
    for (const scenario of parityScenarios) {
      const desktopVariants = scenario.desktop?.totalVariants ?? 0
      const webVariants = scenario.web?.totalVariants ?? 0
      const hashLabel =
        scenario.hashMatch === true
          ? `${shortHash(scenario.desktop?.resultHash)} matched`
          : scenario.hashMatch === false
            ? 'mismatch'
            : 'not available'
      lines.push(
        `| ${scenario.id} | ${scenario.importMode ?? 'unknown'} | ${scenario.status} | ${desktopVariants}/${webVariants} | ${queryMatchSummary(
          scenario
        )} | ${hashLabel} |`
      )
    }
  } else {
    lines.push('No manifest-backed data parity report was produced for this run.')
  }

  lines.push('', '## Remaining Notes', '')

  if (failedSuites.length === 0) {
    lines.push('- No required validation suite failed.')
  } else {
    lines.push(
      `- ${failedSuites.length} required validation suite${failedSuites.length === 1 ? '' : 's'} failed and need review.`
    )
  }

  if (nonBlockingSkipped > 0) {
    lines.push(
      `- ${nonBlockingSkipped} checks were skipped by the harness as non-blocking or not applicable for this run.`
    )
  }

  lines.push(
    '',
    '## Evidence Package',
    '',
    'The handoff package is intentionally compact. It keeps the stakeholder PDF, the technical summary, and per-suite logs:',
    '',
    `- Technical summary: \`${relative(resolve(latestDir, 'summary.md'))}\``,
    `- PDF handoff report: \`${relative(resolve(latestDir, 'stakeholder-report.pdf'))}\``,
    `- Per-suite logs: \`${relative(resolve(latestDir, 'logs'))}\``,
    `- Data parity detail: \`${relative(resolve(repoRoot, '.planning/artifacts/web/parity/latest.md'))}\``
  )

  return `${lines.join('\n')}\n`
}

function renderStakeholderHtml(markdown) {
  const md = new MarkdownIt({ html: false, linkify: true })
  const body = md
    .render(markdown)
    .replaceAll('<td>Passed</td>', '<td><span class="badge pass">Passed</span></td>')
    .replaceAll(
      '<td>Exact parity passed</td>',
      '<td><span class="badge pass">Exact parity passed</span></td>'
    )
    .replaceAll(
      '<td>Parity test needed</td>',
      '<td><span class="badge warn">Parity test needed</span></td>'
    )
    .replaceAll('<td>Incomplete</td>', '<td><span class="badge warn">Incomplete</span></td>')
    .replaceAll('<td>Partial</td>', '<td><span class="badge warn">Partial</span></td>')
    .replaceAll(
      '<td>Needs attention</td>',
      '<td><span class="badge fail">Needs attention</span></td>'
    )
    .replaceAll(
      '<td>Tracked separately</td>',
      '<td><span class="badge neutral">Tracked separately</span></td>'
    )

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>VarLens Web Validation Report</title>
  <style>
    @page { margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #17212b;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      line-height: 1.45;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 14px;
      padding: 18px 20px;
      color: #ffffff;
      background: #143d59;
      border-radius: 8px;
      font-size: 24px;
      letter-spacing: 0;
    }
    h2 {
      margin: 22px 0 8px;
      color: #143d59;
      font-size: 16px;
      border-bottom: 2px solid #dce8ef;
      padding-bottom: 5px;
    }
    h3 {
      margin: 16px 0 8px;
      color: #31485a;
      font-size: 13px;
    }
    p { margin: 6px 0 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px;
      page-break-inside: auto;
    }
    tr { page-break-inside: avoid; }
    th {
      background: #eaf3f7;
      color: #17384d;
      font-weight: 700;
      text-align: left;
      border: 1px solid #c8dce6;
      padding: 6px 7px;
    }
    td {
      border: 1px solid #dbe6ec;
      padding: 6px 7px;
      vertical-align: top;
    }
    tbody tr:nth-child(even) td { background: #f8fbfc; }
    code {
      color: #143d59;
      background: #edf4f7;
      border-radius: 4px;
      padding: 1px 4px;
    }
    ul { padding-left: 18px; }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pass { color: #0f5132; background: #d1e7dd; }
    .warn { color: #664d03; background: #fff3cd; }
    .fail { color: #842029; background: #f8d7da; }
    .neutral { color: #334155; background: #e2e8f0; }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

async function writeStakeholderPdf(runDir, stakeholderReport) {
  const html = renderStakeholderHtml(stakeholderReport)
  const htmlPath = resolve(runDir, 'stakeholder-report.html')
  const pdfPath = resolve(runDir, 'stakeholder-report.pdf')
  await writeFile(htmlPath, html, 'utf8')

  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } })
      await page.setContent(html, { waitUntil: 'networkidle' })
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' }
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    await writeFile(
      resolve(runDir, 'stakeholder-report.pdf.error.txt'),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      'utf8'
    )
    throw error
  }
}

async function compactReportPackage(runDir) {
  const removablePaths = [
    'ctrf-report.json',
    'junit',
    'manifest.json',
    'secrets',
    'stakeholder-report.html',
    'stakeholder-report.md',
    'vitest'
  ]

  for (const removablePath of removablePaths) {
    await rm(resolve(runDir, removablePath), { recursive: true, force: true })
  }
}

async function publishLatestReport(runDir) {
  await rm(latestDir, { recursive: true, force: true })
  await mkdir(latestDir, { recursive: true })

  await copyFile(resolve(runDir, 'summary.md'), resolve(latestDir, 'summary.md'))

  const pdfPath = resolve(runDir, 'stakeholder-report.pdf')
  if (existsSync(pdfPath)) {
    await copyFile(pdfPath, resolve(latestDir, 'stakeholder-report.pdf'))
  }

  const pdfErrorPath = resolve(runDir, 'stakeholder-report.pdf.error.txt')
  if (existsSync(pdfErrorPath)) {
    await copyFile(pdfErrorPath, resolve(latestDir, 'stakeholder-report.pdf.error.txt'))
  }

  const logsDir = resolve(runDir, 'logs')
  if (existsSync(logsDir)) {
    await cp(logsDir, resolve(latestDir, 'logs'), { recursive: true })
  }
}

function skippedSuite(id, reason, required = false) {
  return {
    id,
    kind: 'command',
    required,
    skipped: true,
    skipReason: reason,
    exitCode: null,
    durationMs: 0
  }
}

async function runCommandSuite(
  runDir,
  id,
  command,
  args,
  { required = true, env = {}, kind = 'command' } = {}
) {
  const paths = suitePaths(runDir, id)
  const result = await exec(command, args, {
    env,
    stdoutPath: paths.stdout,
    stderrPath: paths.stderr
  })
  return {
    id,
    kind,
    required,
    skipped: false,
    command: result.displayCommand,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stdoutPath: result.stdoutPath,
    stderrPath: result.stderrPath
  }
}

async function runVitestSuite(runDir, id, args, { required = true, env = {} } = {}) {
  const paths = suitePaths(runDir, id)
  const result = await exec('npx', vitestArgs(id, args, paths.json, paths.junit), {
    env,
    stdoutPath: paths.stdout,
    stderrPath: paths.stderr
  })
  return {
    id,
    kind: 'vitest',
    required,
    skipped: false,
    command: result.displayCommand,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stdoutPath: result.stdoutPath,
    stderrPath: result.stderrPath,
    vitestJsonPath: relative(paths.json).replace(`${relative(runDir)}/`, ''),
    junitPath: relative(paths.junit).replace(`${relative(runDir)}/`, '')
  }
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function gitInfo() {
  const sha = gitValue(['rev-parse', '--short=12', 'HEAD'])
  const branch = gitValue(['branch', '--show-current'])
  const porcelain = gitValue(['status', '--short'])
  return {
    sha,
    branch,
    dirty: porcelain !== null && porcelain !== ''
  }
}

async function main() {
  const startedAt = new Date()
  const gitState = await gitInfo()
  const runId = `${isoForPath(startedAt)}-${gitState.sha ?? 'unknown'}`
  const runDir = resolve(runsDir, runId)
  let attemptedElectronRebuild = false
  await mkdir(runDir, { recursive: true })

  if (webMode && process.env.VARLENS_RECOVERY_KEY_DIR === undefined) {
    process.env.VARLENS_RECOVERY_KEY_DIR = resolve(runDir, 'secrets')
  }

  const manifest = {
    schemaVersion: 1,
    runId,
    status: 'failed',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    git: gitState,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hasPostgresUrl: hasPg,
      webMode,
      hasRecoveryKeyDir: typeof process.env.VARLENS_RECOVERY_KEY_DIR === 'string',
      runParity,
      runParityE2e
    },
    suites: []
  }

  manifest.suites.push(
    await runCommandSuite(
      runDir,
      'web-data-gather',
      'node',
      ['scripts/data-fixtures/download-fixtures.mjs'],
      { required: true }
    )
  )
  manifest.suites.push(
    await runCommandSuite(
      runDir,
      'web-data-prepare',
      'node',
      ['scripts/data-fixtures/prepare-fixtures.mjs'],
      { required: true }
    )
  )
  manifest.suites.push(
    await runCommandSuite(
      runDir,
      'web-data-verify',
      'node',
      ['scripts/data-fixtures/verify-fixtures.mjs'],
      { required: true }
    )
  )

  manifest.suites.push(
    await runCommandSuite(runDir, 'rebuild-node-for-static', 'npm', ['run', 'rebuild:node'], {
      required: true
    })
  )

  manifest.suites.push(
    await runVitestSuite(runDir, 'web-gate-static', ['--project', 'web-gate'], {
      required: true
    })
  )

  if (hasPg) {
    if (shouldBuild) {
      manifest.suites.push(
        await runCommandSuite(runDir, 'build-web', 'npm', ['run', 'build:web'], {
          required: true
        })
      )
    }
    manifest.suites.push(
      await runVitestSuite(
        runDir,
        'web-gate-postgres',
        ['--project', 'web-gate', 'tests/web-gate/integration'],
        { required: true }
      )
    )
  } else {
    manifest.suites.push(skippedSuite('web-gate-postgres', 'VARLENS_PG_URL is not set', webMode))
  }

  if (runParity) {
    let parityReady = true
    if (shouldBuild && !existsSync(resolve(repoRoot, 'out/main/index.js'))) {
      const buildSuite = await runCommandSuite(
        runDir,
        'build-electron-for-parity',
        'npm',
        ['run', 'build'],
        {
          required: true
        }
      )
      manifest.suites.push(buildSuite)
      parityReady = suitePassed(buildSuite)
    }
    if (parityReady) {
      attemptedElectronRebuild = true
      const rebuildSuite = await runCommandSuite(
        runDir,
        'rebuild-electron-for-parity',
        'npm',
        ['run', 'rebuild:electron'],
        {
          required: true
        }
      )
      manifest.suites.push(rebuildSuite)
      parityReady = suitePassed(rebuildSuite)
    }
    if (parityReady) {
      manifest.suites.push(
        await runVitestSuite(runDir, 'web-gate-parity', ['--project', 'web-gate-parity'], {
          required: true,
          env: { VARLENS_RUN_WEB_GATE_PARITY: '1' }
        })
      )
    } else {
      manifest.suites.push(
        skippedSuite('web-gate-parity', 'Electron parity prerequisites failed', true)
      )
    }
  } else {
    manifest.suites.push(
      skippedSuite(
        'web-gate-parity',
        'set VARLENS_WEB_REPORT_PARITY=1 to run Electron parity',
        false
      )
    )
  }

  if (runParityE2e) {
    if (!hasPg) {
      manifest.suites.push(
        skippedSuite('web-parity-e2e', 'VARLENS_PG_URL is required for parity E2E', true)
      )
    } else {
      let parityE2eReady = true
      if (shouldBuild) {
        const buildSuite = await runCommandSuite(
          runDir,
          'build-apps-for-parity-e2e',
          'npm',
          ['run', 'build'],
          {
            required: true
          }
        )
        manifest.suites.push(buildSuite)
        parityE2eReady = suitePassed(buildSuite)
      }
      if (parityE2eReady) {
        attemptedElectronRebuild = true
        const rebuildSuite = await runCommandSuite(
          runDir,
          'rebuild-electron-for-parity-e2e',
          'npm',
          ['run', 'rebuild:electron'],
          {
            required: true
          }
        )
        manifest.suites.push(rebuildSuite)
        parityE2eReady = suitePassed(rebuildSuite)
      }
      if (parityE2eReady) {
        manifest.suites.push(
          await runVitestSuite(
            runDir,
            'web-parity-e2e',
            [
              '--project',
              'web-gate-parity',
              'tests/web-gate/parity/data-manifest-parity.test.ts',
              'tests/web-gate/parity/ipc-fixture-parity.test.ts'
            ],
            {
              required: true,
              env: {
                VARLENS_RUN_WEB_GATE_PARITY: '1',
                VARLENS_RUN_WEB_PARITY_E2E: '1'
              }
            }
          )
        )
      } else {
        manifest.suites.push(
          skippedSuite('web-parity-e2e', 'Electron parity E2E prerequisites failed', true)
        )
      }
    }
  } else {
    manifest.suites.push(
      skippedSuite(
        'web-parity-e2e',
        'set VARLENS_WEB_REPORT_PARITY_E2E=1 to run manifest-backed parity E2E',
        false
      )
    )
  }

  if (attemptedElectronRebuild) {
    manifest.suites.push(
      await runCommandSuite(
        runDir,
        'restore-node-abi-after-parity',
        'npm',
        ['run', 'rebuild:node'],
        {
          required: true
        }
      )
    )
  }

  const finishedAt = new Date()
  manifest.finishedAt = finishedAt.toISOString()
  manifest.durationMs = finishedAt.getTime() - startedAt.getTime()
  manifest.harnessStatus = manifest.suites.some(suiteFailed) ? 'failed' : 'passed'
  const reportAssessment = await buildReportAssessment(manifest)
  manifest.status = reportAssessment.status

  const ctrf = await buildCtrf(manifest, runDir)
  const summary = renderSummary(manifest, ctrf, reportAssessment)
  const stakeholderReport = await renderStakeholderReport(manifest, ctrf, reportAssessment)
  await writeFile(
    resolve(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  )
  await writeFile(resolve(runDir, 'ctrf-report.json'), JSON.stringify(ctrf, null, 2) + '\n', 'utf8')
  await writeFile(resolve(runDir, 'summary.md'), summary, 'utf8')
  await writeFile(resolve(runDir, 'stakeholder-report.md'), stakeholderReport, 'utf8')
  await writeStakeholderPdf(runDir, stakeholderReport)

  await compactReportPackage(runDir)
  await publishLatestReport(runDir)

  log(`\nWeb test report: ${relative(resolve(latestDir, 'summary.md'))}`)
  if (manifest.status !== 'passed') process.exitCode = 1
}

await main()
