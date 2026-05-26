#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { log } from 'node:console'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { buildCtrf, suiteFailed, suitePassed } from './web-report-ctrf.mjs'
import {
  compactReportPackage,
  publishLatestReport,
  writeTestDataEvidencePackage
} from './web-report-data.mjs'
import {
  buildReportAssessment,
  renderStakeholderReport,
  renderSummary,
  writeStakeholderPdf
} from './web-report-stakeholder.mjs'
import {
  latestDir,
  loadLocalPostgresEnvForWebMode,
  repoRoot,
  runsDir
} from './web-report-context.mjs'

const webMode = process.env.VARLENS_WEB === '1'
loadLocalPostgresEnvForWebMode()

const hasPg = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const runParity = webMode || process.env.VARLENS_WEB_REPORT_PARITY === '1'
const runParityE2e =
  webMode ||
  process.env.VARLENS_WEB_REPORT_PARITY === '1' ||
  process.env.VARLENS_WEB_REPORT_PARITY_E2E === '1'
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
  const parityReportDir = resolve(runDir, 'parity')
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
          env: {
            VARLENS_RUN_WEB_GATE_PARITY: '1',
            VARLENS_RUN_WEB_PARITY_E2E: '1',
            VARLENS_WEB_PARITY_REPORT_DIR: parityReportDir
          }
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
                VARLENS_RUN_WEB_PARITY_E2E: '1',
                VARLENS_WEB_PARITY_REPORT_DIR: parityReportDir
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
  const reportAssessment = await buildReportAssessment(manifest, runDir)
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
  await writeTestDataEvidencePackage(runDir, manifest)

  await compactReportPackage(runDir)
  await publishLatestReport(runDir)

  log(`\nWeb test report: ${relative(resolve(latestDir, 'summary.md'))}`)
  if (manifest.status !== 'passed') process.exitCode = 1
}

await main()
