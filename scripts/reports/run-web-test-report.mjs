#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { log } from 'node:console'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const artifactRoot = resolve(repoRoot, '.planning/artifacts/web/test-reporting')
const latestDir = resolve(artifactRoot, 'latest')
const runsDir = resolve(artifactRoot, 'runs')
const hasPg = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const runParity = process.env.VARLENS_WEB_REPORT_PARITY === '1'
const runParityE2e = process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'
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
        status: suite.exitCode === 0 ? 'passed' : suite.skipped ? 'skipped' : 'failed',
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
  return suite.required === true && suite.skipped !== true && suite.exitCode !== 0
}

function renderSummary(manifest, ctrf) {
  const summary = ctrf.results.summary
  const status = manifest.status.toUpperCase()
  const lines = [
    '# Web Test Report',
    '',
    `Status: ${status}`,
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
    `- Manifest: \`${relative(resolve(latestDir, 'manifest.json'))}\``,
    `- CTRF: \`${relative(resolve(latestDir, 'ctrf-report.json'))}\``,
    `- JUnit: \`${relative(resolve(latestDir, 'junit'))}\``,
    `- Vitest JSON: \`${relative(resolve(latestDir, 'vitest'))}\``,
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
  await mkdir(runDir, { recursive: true })

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
    manifest.suites.push(skippedSuite('web-gate-postgres', 'VARLENS_PG_URL is not set', false))
  }

  if (runParity) {
    if (shouldBuild && !existsSync(resolve(repoRoot, 'out/main/index.js'))) {
      manifest.suites.push(
        await runCommandSuite(runDir, 'build-electron-for-parity', 'npm', ['run', 'build'], {
          required: true
        })
      )
    }
    manifest.suites.push(
      await runCommandSuite(
        runDir,
        'rebuild-electron-for-parity',
        'npm',
        ['run', 'rebuild:electron'],
        {
          required: true
        }
      )
    )
    manifest.suites.push(
      await runVitestSuite(runDir, 'web-gate-parity', ['--project', 'web-gate-parity'], {
        required: true,
        env: { VARLENS_RUN_WEB_GATE_PARITY: '1' }
      })
    )
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
      if (shouldBuild) {
        manifest.suites.push(
          await runCommandSuite(runDir, 'build-apps-for-parity-e2e', 'npm', ['run', 'build'], {
            required: true
          })
        )
      }
      manifest.suites.push(
        await runCommandSuite(
          runDir,
          'rebuild-electron-for-parity-e2e',
          'npm',
          ['run', 'rebuild:electron'],
          {
            required: true
          }
        )
      )
      manifest.suites.push(
        await runVitestSuite(
          runDir,
          'web-parity-e2e',
          ['--project', 'web-gate-parity', 'tests/web-gate/parity/data-manifest-parity.test.ts'],
          {
            required: true,
            env: {
              VARLENS_RUN_WEB_GATE_PARITY: '1',
              VARLENS_RUN_WEB_PARITY_E2E: '1'
            }
          }
        )
      )
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

  const finishedAt = new Date()
  manifest.finishedAt = finishedAt.toISOString()
  manifest.durationMs = finishedAt.getTime() - startedAt.getTime()
  manifest.status = manifest.suites.some(suiteFailed) ? 'failed' : 'passed'

  const ctrf = await buildCtrf(manifest, runDir)
  const summary = renderSummary(manifest, ctrf)
  await writeFile(
    resolve(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  )
  await writeFile(resolve(runDir, 'ctrf-report.json'), JSON.stringify(ctrf, null, 2) + '\n', 'utf8')
  await writeFile(resolve(runDir, 'summary.md'), summary, 'utf8')

  await rm(latestDir, { recursive: true, force: true })
  await mkdir(dirname(latestDir), { recursive: true })
  await cp(runDir, latestDir, { recursive: true })

  log(`\nWeb test report: ${relative(resolve(latestDir, 'summary.md'))}`)
  if (manifest.status !== 'passed') process.exitCode = 1
}

await main()
