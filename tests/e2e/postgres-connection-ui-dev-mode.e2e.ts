import { expect, test } from '@playwright/test'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

const DEFAULT_PG_URL = 'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

function getDockerPostgresProfile(): {
  name: string
  host: string
  port: string
  database: string
  username: string
  password: string
  schema: string
} {
  const url = new URL(process.env.VARLENS_PG_URL ?? DEFAULT_PG_URL)

  return {
    name: `Docker PostgreSQL ${Date.now()}`,
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    schema: process.env.VARLENS_PG_SCHEMA ?? 'public'
  }
}

test('connection manager opens docker postgres workspace from a saved UI profile', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const profile = getDockerPostgresProfile()
  let launched:
    | Awaited<ReturnType<typeof launchElectronApp>>
    | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: undefined,
        VARLENS_PG_URL: undefined,
        VARLENS_PG_SCHEMA: undefined,
        VARLENS_POSTGRES_PROFILE_SECRET_STORE: 'insecure-local'
      }
    })

    const page = launched.window
    await waitForAppShell(page)
    await dismissDisclaimerIfPresent(page)

    const databasePicker = page.getByTestId('database-picker')

    await databasePicker.click()
    await expect(page.getByText('PostgreSQL Workspaces', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add PostgreSQL workspace', exact: true }).click()

    await page.getByTestId('postgres-name').locator('input').fill(profile.name)
    await page.getByTestId('postgres-host').locator('input').fill(profile.host)
    await page.getByTestId('postgres-port').locator('input').fill(profile.port)
    await page.getByTestId('postgres-database').locator('input').fill(profile.database)
    await page.getByTestId('postgres-username').locator('input').fill(profile.username)
    await page.getByTestId('postgres-password').locator('input').fill(profile.password)
    await page.getByTestId('postgres-schema').locator('input').fill(profile.schema)

    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByText(/Connection test succeeded/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Save PostgreSQL workspace' }).click()
    await expect(page.getByRole('dialog', { name: 'PostgreSQL Workspace' })).toBeHidden()

    await databasePicker.click()
    const connectProfileButton = page.getByRole('button', {
      name: `Connect PostgreSQL workspace ${profile.name}`,
      exact: true
    })
    await expect(connectProfileButton).toBeVisible({ timeout: 15_000 })
    await connectProfileButton.click()

    await expect(databasePicker).toContainText('PostgreSQL:', {
      timeout: 15_000
    })

    const cases = await page.evaluate(async () => {
      return await window.api.cases.list()
    })

    expect(cases).toEqual([
      expect.objectContaining({ id: 3, name: 'Newest Case' }),
      expect.objectContaining({ id: 2, name: 'Middle Case' }),
      expect.objectContaining({ id: 1, name: 'Oldest Case' })
    ])
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
