import { expect, test } from '@playwright/test'
import type { FastifyInstance } from 'fastify'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { startIsolatedWebSchema } from '../web-gate/helpers/web-driver'

const PG_ENV_PATH = resolve(process.cwd(), '.env.postgres.local')
const WEB_PUBLIC_DIR = resolve(process.cwd(), 'out/web/public')
const WEB_INDEX_PATH = resolve(WEB_PUBLIC_DIR, 'index.html')
const SOURCE_LOGIN_HTML = resolve(process.cwd(), 'src/web/login/login.html')
const ADMIN_USERNAME = 'web-live-admin'
const ADMIN_PASSWORD = 'web-live-bootstrap-password-2026'
const ROTATED_PASSWORD = 'web-live-rotated-password-2026'

interface BuiltWebServer {
  buildApp: (options?: {
    admin?: {
      username: string
      password?: string
      passwordHash?: string
      displayName?: string
    }
  }) => Promise<FastifyInstance>
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}

  const env: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key !== '') env[key] = value
  }
  return env
}

function ensurePostgresEnv(): void {
  const fileEnv = readEnvFile(PG_ENV_PATH)
  for (const [key, value] of Object.entries(fileEnv)) {
    process.env[key] ??= value
  }
}

function hasRootWebBuild(): boolean {
  if (!existsSync(WEB_INDEX_PATH)) return false
  return !readFileSync(WEB_INDEX_PATH, 'utf8').includes('/varlens/')
}

function setEnv(name: string, value: string, restore: Array<() => void>): void {
  const previous = process.env[name]
  process.env[name] = value
  restore.push(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

test('live web app handles login rotation and real API calls with dev latency', async ({ page }) => {
  test.skip(
    process.env.VARLENS_RUN_WEB_LIVE_E2E !== '1',
    'Set VARLENS_RUN_WEB_LIVE_E2E=1 to run the live browser web smoke.'
  )

  ensurePostgresEnv()
  test.skip(
    process.env.VARLENS_PG_URL === undefined || process.env.VARLENS_PG_URL === '',
    'VARLENS_PG_URL is required; start the local Postgres container first.'
  )
  test.skip(
    !hasRootWebBuild(),
    'Run `VARLENS_WEB_BASE=/ npm run build:web` before this test so assets mount at /.'
  )

  const restoreEnv: Array<() => void> = []
  let app: FastifyInstance | undefined
  const isolated = await startIsolatedWebSchema('web_live_latency')

  try {
    setEnv('NODE_ENV', 'development', restoreEnv)
    setEnv('APP_PATH_PREFIX', '/', restoreEnv)
    setEnv('VARLENS_WEB_API_LATENCY_MS', '75', restoreEnv)
    setEnv('VARLENS_WEB_PUBLIC_DIR', WEB_PUBLIC_DIR, restoreEnv)
    setEnv('VARLENS_LOGIN_HTML_PATH', SOURCE_LOGIN_HTML, restoreEnv)

    const { buildApp } = (await import('../../out/web/server.cjs')) as BuiltWebServer
    app = await buildApp({
      admin: {
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        displayName: 'Web Live Admin'
      }
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (address === null || typeof address !== 'object') {
      throw new Error('web live smoke: server did not bind to a TCP port')
    }
    const baseUrl = `http://127.0.0.1:${address.port}`

    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(`${baseUrl}/`)
    await expect(page).toHaveURL(/\/login\?next=%2F$/u)

    await page.locator('#username').fill(ADMIN_USERNAME)
    await page.locator('#password').fill(ADMIN_PASSWORD)
    await page.locator('#submit').click()

    await expect(page.locator('#rotate-form')).toBeVisible()
    await page.locator('#new-password').fill(ROTATED_PASSWORD)
    await page.locator('#confirm-password').fill(ROTATED_PASSWORD)
    await page.locator('#rotate-submit').click()

    await expect(page).toHaveURL(`${baseUrl}/`)
    await expect(page.getByTestId('database-picker')).toContainText('VarLens Web')

    const probe = await page.evaluate(async () => {
      const webFlag = (window as Window & { __VARLENS_WEB__?: boolean }).__VARLENS_WEB__ === true
      const databaseInfo = await window.api.database.info()
      const cases = await window.api.cases.list()
      const started = performance.now()
      await window.api.auth.isAccountsEnabled()
      const elapsedMs = performance.now() - started
      return { webFlag, databaseInfo, cases, elapsedMs }
    })

    expect(probe.webFlag).toBe(true)
    expect(probe.databaseInfo).toMatchObject({ name: 'VarLens Web' })
    expect(probe.cases).toEqual([])
    expect(probe.elapsedMs).toBeGreaterThanOrEqual(60)
    expect(consoleErrors).toEqual([])
  } finally {
    await app?.close()
    for (const restore of restoreEnv.reverse()) restore()
    await isolated.close()
  }
})
