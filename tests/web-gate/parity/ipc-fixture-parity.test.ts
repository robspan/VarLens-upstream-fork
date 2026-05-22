import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell,
  type LaunchElectronAppResult
} from '../../e2e/helpers/electron-app'
import { startIsolatedWebSchema, startWebDriver, type WebDriver } from '../helpers/web-driver'
import { IPC_SCENARIOS, REQUIRED_IPC_AREAS } from './ipc/scenarios'
import {
  rowsOf,
  type ApiCall,
  type ImportEnvelope,
  type RuntimeContext,
  type VariantAnchor
} from './ipc/shared'

const SHOULD_RUN =
  process.env.VARLENS_RUN_WEB_GATE_PARITY === '1' && process.env.VARLENS_RUN_WEB_PARITY_E2E === '1'
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const ELECTRON_BUILD = resolve(process.cwd(), 'out/main/index.js')
const API_FIXTURES_DIR = resolve(process.cwd(), 'tests/fixtures/api')
const REPORT_DIR = resolve(process.cwd(), '.planning/artifacts/web/parity')
const REPORT_JSON_PATH = resolve(REPORT_DIR, 'latest-ipc.json')
const REPORT_MD_PATH = resolve(REPORT_DIR, 'latest-ipc.md')
const DEBUG_DIR = resolve(REPORT_DIR, 'debug')

interface IpcAreaResult {
  area: string
  status: 'passed' | 'failed'
  desktopHash: string | null
  webHash: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
  operationCount: number
  error?: string
}

interface IpcParityReport {
  schemaVersion: 1
  status: 'passed' | 'failed'
  generatedAt: string
  finishedAt: string | null
  gitSha: string | null
  requiredIpcAreas: string[]
  validatedIpcAreas: number
  passedIpcAreas: number
  failedIpcAreas: number
  results: IpcAreaResult[]
}

const primaryCase = {
  filePath: resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf'),
  caseName: 'ipc-parity-primary',
  options: { selectedSample: 'HG005', genomeBuild: 'GRCh38' }
}

const secondaryCase = {
  filePath: resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf'),
  caseName: 'ipc-parity-secondary',
  options: { selectedSample: 'HG006', genomeBuild: 'GRCh38' }
}

function unwrap<T>(value: unknown): T {
  if (value !== null && typeof value === 'object' && 'ok' in value) {
    const result = value as { ok: boolean; data?: T; error?: { message?: string } }
    if (!result.ok) throw new Error(`IPC error: ${result.error?.message ?? 'unknown'}`)
    return result.data as T
  }
  return value as T
}

async function electronCall<T>(
  session: LaunchElectronAppResult,
  domain: string,
  method: string,
  args: unknown[] = []
): Promise<T> {
  const raw = await session.window.evaluate(
    async ({ domain: apiDomain, method: apiMethod, args: apiArgs }) => {
      const api = (window as unknown as { api?: Record<string, Record<string, unknown>> }).api
      const fn = api?.[apiDomain]?.[apiMethod]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${apiDomain}.${apiMethod} is not exposed`)
      }
      return await (fn as (...innerArgs: unknown[]) => Promise<unknown>)(...apiArgs)
    },
    { domain, method, args }
  )
  return unwrap<T>(raw)
}

async function webCall<T>(
  driver: WebDriver,
  domain: string,
  method: string,
  args: unknown[] = []
): Promise<T> {
  const response = await driver.api(domain, method, ...args)
  expect(response.statusCode, response.body).toBe(200)
  if (response.body.trim() === '') return undefined as T
  return unwrap<T>(response.json())
}

function importEnvelope(raw: unknown): ImportEnvelope {
  const value = raw as { caseId: number; variantCount?: number; totalVariants?: number }
  return {
    caseId: value.caseId,
    variantCount: value.variantCount ?? value.totalVariants ?? 0
  }
}

async function createElectronRuntime(): Promise<{
  context: RuntimeContext
  cleanup: () => Promise<void>
}> {
  const isolated = await startIsolatedWebSchema('electron_ipc_parity')
  let session: LaunchElectronAppResult | undefined
  const exportDir = mkdtempSync(resolve(tmpdir(), 'varlens-electron-export-'))

  async function cleanup(): Promise<void> {
    try {
      await session?.cleanup()
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
      await isolated.close()
    }
  }

  try {
    session = await launchElectronApp({
      hideWindow: true,
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_SCHEMA: isolated.schema,
        VARLENS_API_FIXTURES_DIR: API_FIXTURES_DIR,
        VARLENS_ALLOW_API_FIXTURES: '1',
        VARLENS_AUTOMATED_EXPORT_DIR: exportDir
      }
    })
    await waitForAppShell(session.window)
    await dismissDisclaimerIfPresent(session.window)
    const call: ApiCall = async (domain, method, args = []) =>
      await electronCall(session!, domain, method, args)
    return { context: await seedRuntime(call, exportDir), cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

async function createWebRuntime(): Promise<{
  context: RuntimeContext
  cleanup: () => Promise<void>
}> {
  const previousFixturesDir = process.env.VARLENS_API_FIXTURES_DIR
  const previousWebParityFixtures = process.env.VARLENS_WEB_PARITY_FIXTURES
  process.env.VARLENS_API_FIXTURES_DIR = API_FIXTURES_DIR
  process.env.VARLENS_WEB_PARITY_FIXTURES = '1'
  const exportDir = mkdtempSync(resolve(tmpdir(), 'varlens-web-export-'))
  let driver: WebDriver | undefined

  async function cleanup(): Promise<void> {
    try {
      await driver?.close()
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
      if (previousFixturesDir === undefined) delete process.env.VARLENS_API_FIXTURES_DIR
      else process.env.VARLENS_API_FIXTURES_DIR = previousFixturesDir
      if (previousWebParityFixtures === undefined) delete process.env.VARLENS_WEB_PARITY_FIXTURES
      else process.env.VARLENS_WEB_PARITY_FIXTURES = previousWebParityFixtures
    }
  }

  try {
    driver = await startWebDriver()
    const call: ApiCall = async (domain, method, args = []) =>
      await webCall(driver!, domain, method, args)
    return { context: await seedRuntime(call, exportDir), cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

async function seedRuntime(call: ApiCall, exportDir: string): Promise<RuntimeContext> {
  const primaryImport = importEnvelope(
    await call('import', 'start', [primaryCase.filePath, primaryCase.caseName, primaryCase.options])
  )
  const secondaryImport = importEnvelope(
    await call('import', 'start', [
      secondaryCase.filePath,
      secondaryCase.caseName,
      secondaryCase.options
    ])
  )
  const query = await call('variants', 'query', [
    primaryImport.caseId,
    { gene_symbol: 'COMT' },
    0,
    25
  ])
  const primaryVariant = rowsOf(query).find((row) => {
    const value = row as Record<string, unknown>
    return value.chr === 'chr22' && value.pos === 20000350 && value.ref === 'G' && value.alt === 'A'
  }) as VariantAnchor | undefined
  if (primaryVariant === undefined) throw new Error('COMT variant anchor was not imported')

  return {
    call,
    primaryCaseId: primaryImport.caseId,
    secondaryCaseId: secondaryImport.caseId,
    primaryImport,
    secondaryImport,
    primaryVariant,
    exportDir
  }
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  const byteArray = normalizeByteArray(value)
  if (byteArray !== null) return { __bytes: byteArray }
  if (Array.isArray(value)) return value.map(normalize).sort(compareStable)

  const drop = new Set([
    'case_id',
    'variant_id',
    'created_at',
    'updated_at',
    'createdAt',
    'updatedAt',
    'timestamp',
    'activated_at',
    'last_rebuilt_at',
    'cachedAt',
    'file_path',
    'path',
    'connectionLabel',
    'connectionUrlRedacted'
  ])
  const normalized: Record<string, unknown> = {}
  const source = value as Record<string, unknown>
  for (const [key, entry] of Object.entries(source)) {
    if (drop.has(key)) continue
    if (key === 'id' && typeof entry === 'number') continue
    if (key === 'name' && typeof source.encrypted === 'boolean') continue
    normalized[key] = normalize(entry)
  }
  return normalized
}

function normalizeByteArray(value: object): number[] | null {
  if (Array.isArray(value)) return null
  if (
    'type' in value &&
    'data' in value &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const data = (value as { data: unknown[] }).data
    return data.every((item) => typeof item === 'number') ? data : null
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return null
  if (!entries.every(([key, entry]) => /^\d+$/u.test(key) && typeof entry === 'number')) {
    return null
  }
  return entries
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, entry]) => entry as number)
}

function compareStable(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right))
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`
}

function hashResult(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(normalize(value)))
    .digest('hex')
}

function getGitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    }).trim()
  } catch {
    return null
  }
}

function writeReport(report: IpcParityReport): void {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8')
  writeFileSync(REPORT_MD_PATH, renderReport(report), 'utf8')
}

function writeDebugSnapshot(area: string, desktopValue: unknown, webValue: unknown): void {
  mkdirSync(DEBUG_DIR, { recursive: true })
  writeFileSync(
    resolve(DEBUG_DIR, `${area}.json`),
    JSON.stringify(
      {
        area,
        desktop: normalize(desktopValue),
        web: normalize(webValue)
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
}

function renderReport(report: IpcParityReport): string {
  const lines = [
    '# IPC Parity Report',
    '',
    `Status: ${report.status}`,
    `Generated: ${report.generatedAt}`,
    `Finished: ${report.finishedAt ?? 'not finished'}`,
    `Validated IPC areas: ${report.validatedIpcAreas}/${report.requiredIpcAreas.length}`,
    `Passed IPC areas: ${report.passedIpcAreas}`,
    `Failed IPC areas: ${report.failedIpcAreas}`,
    '',
    '| IPC area | Status | Desktop hash | Web hash | Operations | Duration ms |',
    '| --- | --- | --- | --- | ---: | ---: |'
  ]
  for (const result of report.results) {
    lines.push(
      `| ${result.area} | ${result.status} | ${result.desktopHash?.slice(0, 12) ?? 'n/a'} | ${
        result.webHash?.slice(0, 12) ?? 'n/a'
      } | ${result.operationCount} | ${result.durationMs} |`
    )
  }
  const failures = report.results.filter((result) => result.status === 'failed')
  if (failures.length > 0) {
    lines.push('', '## Failures', '')
    for (const failure of failures) lines.push(`- ${failure.area}: ${failure.error ?? 'unknown'}`)
  }
  return `${lines.join('\n')}\n`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertRequiredIpcScenarios(): void {
  const expected = [...REQUIRED_IPC_AREAS].sort()
  const actual = IPC_SCENARIOS.map((scenario) => scenario.area).sort()
  expect(actual).toEqual(expected)
  expect(new Set(actual).size).toBe(REQUIRED_IPC_AREAS.length)
}

describe.skipIf(!SHOULD_RUN || !existsSync(ELECTRON_BUILD) || !HAS_PG)('IPC parity E2E', () => {
  test('validates all 23 IPC areas against fixture-backed desktop and web runtimes', async () => {
    assertRequiredIpcScenarios()
    const startedAt = new Date()
    const report: IpcParityReport = {
      schemaVersion: 1,
      status: 'failed',
      generatedAt: startedAt.toISOString(),
      finishedAt: null,
      gitSha: getGitSha(),
      requiredIpcAreas: REQUIRED_IPC_AREAS,
      validatedIpcAreas: REQUIRED_IPC_AREAS.length,
      passedIpcAreas: 0,
      failedIpcAreas: 0,
      results: []
    }

    let electron: Awaited<ReturnType<typeof createElectronRuntime>> | undefined
    let web: Awaited<ReturnType<typeof createWebRuntime>> | undefined

    try {
      electron = await createElectronRuntime()
      web = await createWebRuntime()
      const failed: string[] = []

      for (const scenario of IPC_SCENARIOS) {
        const areaStartedAt = new Date()
        let desktopValue: unknown
        let webValue: unknown
        try {
          desktopValue = await scenario.run(electron.context)
          webValue = await scenario.run(web.context)
          const desktopHash = hashResult(desktopValue)
          const webHash = hashResult(webValue)
          expect(stableStringify(normalize(webValue)), scenario.area).toEqual(
            stableStringify(normalize(desktopValue))
          )
          report.results.push({
            area: scenario.area,
            status: 'passed',
            desktopHash,
            webHash,
            startedAt: areaStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - areaStartedAt.getTime(),
            operationCount: Array.isArray(desktopValue) ? desktopValue.length : 1
          })
        } catch (error) {
          failed.push(scenario.area)
          writeDebugSnapshot(scenario.area, desktopValue, webValue)
          report.results.push({
            area: scenario.area,
            status: 'failed',
            desktopHash: desktopValue === undefined ? null : hashResult(desktopValue),
            webHash: webValue === undefined ? null : hashResult(webValue),
            startedAt: areaStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - areaStartedAt.getTime(),
            operationCount: Array.isArray(desktopValue) ? desktopValue.length : 0,
            error: message(error)
          })
        } finally {
          report.passedIpcAreas = report.results.filter(
            (result) => result.status === 'passed'
          ).length
          report.failedIpcAreas = report.results.filter(
            (result) => result.status === 'failed'
          ).length
          writeReport(report)
        }
      }

      if (failed.length > 0) throw new Error(`IPC parity failed for: ${failed.join(', ')}`)
      report.status = 'passed'
    } finally {
      await web?.cleanup()
      await electron?.cleanup()
      report.finishedAt = new Date().toISOString()
      report.passedIpcAreas = report.results.filter((result) => result.status === 'passed').length
      report.failedIpcAreas = report.results.filter((result) => result.status === 'failed').length
      writeReport(report)
    }
  }, 300_000)
})

describe.skipIf(SHOULD_RUN && existsSync(ELECTRON_BUILD) && HAS_PG)(
  'IPC parity skipped notice',
  () => {
    test('IPC parity E2E is opt-in and requires Electron build plus VARLENS_PG_URL', () => {
      expect(SHOULD_RUN ? existsSync(ELECTRON_BUILD) && HAS_PG : true).toBe(true)
    })
  }
)
