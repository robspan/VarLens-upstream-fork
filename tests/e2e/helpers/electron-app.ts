import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export interface LaunchElectronAppOptions {
  perfMode?: boolean
  env?: Record<string, string | undefined>
  isolationRoot?: string
}

export interface LaunchElectronAppResult {
  app: ElectronApplication
  window: Page
  isolationRoot: string
  userDataDir: string
  appDataDir: string
  consoleMessages: string[]
  cleanup: () => Promise<void>
}

export async function launchElectronApp(
  options: LaunchElectronAppOptions = {}
): Promise<LaunchElectronAppResult> {
  const isolationRoot = options.isolationRoot ?? mkdtempSync(join(tmpdir(), 'varlens-e2e-'))
  const userDataDir = join(isolationRoot, 'user-data')
  const appDataDir = join(isolationRoot, 'app-data')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(appDataDir, { recursive: true })

  const app = await electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOME: isolationRoot,
      XDG_CONFIG_HOME: appDataDir,
      XDG_DATA_HOME: appDataDir,
      VARLENS_APP_DATA_DIR: appDataDir,
      VARLENS_USER_DATA_DIR: userDataDir,
      VARLENS_PERF_MODE: options.perfMode ? '1' : process.env.VARLENS_PERF_MODE,
      ...options.env
    }
  })

  const logFilePath = join(userDataDir, 'logs', 'main.log')
  let window: Page
  try {
    window = await app.firstWindow()
  } catch (error) {
    const mainLog = existsSync(logFilePath)
      ? readFileSync(logFilePath, 'utf8').trim()
      : 'Main log file was not created before Electron exited.'

    throw new Error(
      [
        'Electron app closed before the first window became available.',
        `Isolation root: ${isolationRoot}`,
        `Main log: ${logFilePath}`,
        mainLog
      ].join('\n\n'),
      { cause: error }
    )
  }

  const consoleMessages: string[] = []
  window.on('console', (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
  })
  window.on('pageerror', (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`)
  })

  return {
    app,
    window,
    isolationRoot,
    userDataDir,
    appDataDir,
    consoleMessages,
    cleanup: async () => {
      await app.close()
    }
  }
}

export async function waitForAppShell(window: Page): Promise<void> {
  const timeoutMs = process.env.CI === 'true' ? 45_000 : 15_000
  await window.waitForSelector('.v-application', { timeout: timeoutMs })
}

export async function dismissDisclaimerIfPresent(window: Page): Promise<void> {
  const disclaimerButton = window.getByRole('button', { name: 'I Understand' })
  if ((await disclaimerButton.count()) === 0) return
  await disclaimerButton.click()
  await window.waitForTimeout(300)
}

export function resolveAppPath(relativePath: string): string {
  return resolve(process.cwd(), relativePath)
}
