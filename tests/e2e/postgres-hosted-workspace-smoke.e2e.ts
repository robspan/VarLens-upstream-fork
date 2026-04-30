import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

const DEFAULT_ENV_FILE = '.env.postgres.local'
const FALLBACK_PG_URL = 'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface DockerPostgresProfile {
  name: string
  host: string
  port: string
  database: string
  username: string
  password: string
  schema: string
}

function getDockerPostgresProfile(): DockerPostgresProfile {
  const env = {
    ...readPostgresEnvFile(DEFAULT_ENV_FILE),
    ...process.env
  }
  const url = new URL(env.VARLENS_PG_URL ?? buildPostgresUrl(env))

  return {
    name: `Hosted PostgreSQL Smoke ${Date.now()}`,
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    schema: env.VARLENS_PG_SCHEMA ?? 'public'
  }
}

function readPostgresEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}

  const env: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key !== '') {
      env[key] = value
    }
  }

  return env
}

function buildPostgresUrl(env: Record<string, string | undefined>): string {
  const database = env.POSTGRES_DB ?? 'varlens_dev'
  const username = env.POSTGRES_USER ?? 'varlens'
  const password = env.POSTGRES_PASSWORD ?? 'varlens_dev_password'
  const port = env.VARLENS_PG_PORT ?? '55432'
  const url = new URL(FALLBACK_PG_URL)

  url.hostname = '127.0.0.1'
  url.port = port
  url.pathname = `/${database}`
  url.username = username
  url.password = password

  return url.toString()
}

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

async function openPostgresDialog(page: Page): Promise<void> {
  const databasePicker = page.getByTestId('database-picker')
  await databasePicker.click()
  await expect(page.getByText('PostgreSQL Workspaces', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add PostgreSQL workspace', exact: true }).click()
  await expect(page.getByText('PostgreSQL Workspace', { exact: true })).toBeVisible()
}

async function saveAndConnectProfile(page: Page, profile: DockerPostgresProfile): Promise<void> {
  await openPostgresDialog(page)

  await page.getByTestId('postgres-name').locator('input').fill(profile.name)
  await page.getByTestId('postgres-host').locator('input').fill(profile.host)
  await page.getByTestId('postgres-port').locator('input').fill(profile.port)
  await page.getByTestId('postgres-database').locator('input').fill(profile.database)
  await page.getByTestId('postgres-username').locator('input').fill(profile.username)
  await page.getByTestId('postgres-password').locator('input').fill(profile.password)
  await page.getByTestId('postgres-schema').locator('input').fill(profile.schema)

  await page.getByRole('button', { name: 'Connect PostgreSQL workspace' }).click()
  await expect(page.getByTestId('postgres-name')).toBeHidden({
    timeout: 15_000
  })
  await expect(page.getByTestId('database-picker')).toContainText('PostgreSQL:', {
    timeout: 15_000
  })
}

async function connectSavedProfile(page: Page, profileName: string): Promise<void> {
  const databasePicker = page.getByTestId('database-picker')
  await databasePicker.click()

  const connectProfileButton = page.getByRole('button', {
    name: `Connect PostgreSQL workspace ${profileName}`,
    exact: true
  })
  await expect(connectProfileButton).toBeVisible({ timeout: 15_000 })
  await connectProfileButton.click()

  await expect(databasePicker).toContainText('PostgreSQL:', {
    timeout: 15_000
  })
}

test('postgres hosted workspace survives saved-profile relaunch smoke flow', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting and seeding the local postgres container.'
  )

  const profile = getDockerPostgresProfile()
  const isolationRoot = mkdtempSync(join(tmpdir(), 'varlens-postgres-hosted-e2e-'))
  const exportPath = join(isolationRoot, 'hosted-variants.csv')
  let firstLaunch: Awaited<ReturnType<typeof launchElectronApp>> | undefined
  let secondLaunch: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    firstLaunch = await launchElectronApp({
      isolationRoot,
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: undefined,
        VARLENS_PG_URL: undefined,
        VARLENS_PG_SCHEMA: undefined,
        VARLENS_POSTGRES_PROFILE_SECRET_STORE: 'insecure-local'
      }
    })

    await waitForAppShell(firstLaunch.window)
    await dismissDisclaimerIfPresent(firstLaunch.window)
    await saveAndConnectProfile(firstLaunch.window, profile)

    await firstLaunch.app.evaluate(async ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath
      })
    }, exportPath)

    const firstResults = await firstLaunch.window.evaluate(async () => {
      const cases = await window.api.cases.list()
      const diagnostics = await window.api.database.postgresDiagnostics()
      const variants = await window.api.variants.query(1, {}, 0, 25)
      const shortlist = await window.api.variants.shortlist({
        caseId: 1,
        adHocConfig: {
          variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
          baseFilters: {},
          topN: 5,
          rankConfig: {
            weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
          }
        }
      })
      const cohortSummary = await window.api.cohort.getSummary()
      const exportResult = await window.api.export.variants(1, {}, 'Oldest Case')

      return {
        cases,
        diagnostics,
        variants,
        shortlist,
        cohortSummary,
        exportResult
      }
    })

    expect(firstResults.cases).toEqual([
      expect.objectContaining({ id: 3, name: 'Newest Case' }),
      expect.objectContaining({ id: 2, name: 'Middle Case' }),
      expect.objectContaining({ id: 1, name: 'Oldest Case' })
    ])

    expect(expectSuccessfulIpcResult(firstResults.diagnostics)).toEqual(
      expect.objectContaining({
        ok: true,
        schema: profile.schema,
        currentMigration: '0006'
      })
    )

    expect(expectSuccessfulIpcResult(firstResults.variants)).toMatchObject({
      total_count: 5,
      data: expect.arrayContaining([
        expect.objectContaining({ gene_symbol: 'BRCA1', variant_type: 'snv' })
      ])
    })

    const shortlist = expectSuccessfulIpcResult(firstResults.shortlist)
    expect(shortlist.totalCandidates).toBeGreaterThan(0)
    expect(shortlist.rows[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        rank_score: expect.any(Number)
      })
    )

    expect(expectSuccessfulIpcResult(firstResults.cohortSummary)).toEqual(
      expect.objectContaining({
        total_cases: 3,
        total_variants: 6,
        unique_variants: 5
      })
    )

    expect(expectSuccessfulIpcResult(firstResults.exportResult)).toEqual(
      expect.objectContaining({
        success: true,
        filePath: exportPath
      })
    )
    expect(existsSync(exportPath)).toBe(true)
    expect(readFileSync(exportPath, 'utf8')).toContain('BRCA1')

    await firstLaunch.cleanup()
    firstLaunch = undefined

    secondLaunch = await launchElectronApp({
      isolationRoot,
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: undefined,
        VARLENS_PG_URL: undefined,
        VARLENS_PG_SCHEMA: undefined,
        VARLENS_POSTGRES_PROFILE_SECRET_STORE: 'insecure-local'
      }
    })

    await waitForAppShell(secondLaunch.window)
    await dismissDisclaimerIfPresent(secondLaunch.window)

    const savedProfiles = await secondLaunch.window.evaluate(async () => {
      return await window.api.database.postgresProfilesList()
    })
    const publicProfiles = expectSuccessfulIpcResult(savedProfiles)
    expect(publicProfiles).toEqual([
      expect.objectContaining({
        name: profile.name,
        host: profile.host,
        port: Number(profile.port),
        database: profile.database,
        username: profile.username,
        schema: profile.schema
      })
    ])
    expect(publicProfiles[0]).not.toEqual(
      expect.objectContaining({
        password: expect.any(String)
      })
    )
    expect(publicProfiles[0]).not.toEqual(
      expect.objectContaining({
        secrets: expect.anything()
      })
    )
    expect(publicProfiles[0]).not.toEqual(
      expect.objectContaining({
        caCertificatePem: expect.any(String)
      })
    )

    await connectSavedProfile(secondLaunch.window, profile.name)

    const relaunchCases = await secondLaunch.window.evaluate(async () => {
      return await window.api.cases.list()
    })
    expect(relaunchCases).toEqual([
      expect.objectContaining({ id: 3, name: 'Newest Case' }),
      expect.objectContaining({ id: 2, name: 'Middle Case' }),
      expect.objectContaining({ id: 1, name: 'Oldest Case' })
    ])
  } finally {
    if (firstLaunch !== undefined) {
      await firstLaunch.cleanup()
    }
    if (secondLaunch !== undefined) {
      await secondLaunch.cleanup()
    }
  }
})
