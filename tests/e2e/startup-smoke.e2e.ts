import { test, expect } from '@playwright/test'
import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'
import { ensureArtifactDir, writeJsonArtifact } from './helpers/perf-artifacts'

test('startup smoke launches the app shell with isolated Electron state', async ({}, testInfo) => {
  const startupArtifactDir = ensureArtifactDir('startup-smoke')
  const launched = await launchElectronApp({ perfMode: true })

  try {
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    await expect(launched.window.locator('.v-footer')).toBeVisible()

    const snapshot = await launched.window.evaluate(async () => {
      return window.api.perf.getSnapshot()
    })

    expect(snapshot.main.milestones['app-ready']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['window-created']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['renderer-interactive']).toBeGreaterThanOrEqual(0)

    await launched.window.screenshot({
      path: `${startupArtifactDir}/app-shell.png`
    })

    writeJsonArtifact('startup-smoke/launch-context.json', {
      isolationRoot: launched.isolationRoot,
      userDataDir: launched.userDataDir,
      appDataDir: launched.appDataDir,
      consoleMessages: launched.consoleMessages
    })
    writeJsonArtifact('startup-smoke/perf-snapshot.json', snapshot)
  } catch (error) {
    writeJsonArtifact('startup-smoke/failure-context.json', {
      message: error instanceof Error ? error.message : String(error),
      consoleMessages: launched.consoleMessages,
      testOutputDir: testInfo.outputDir
    })
    throw error
  } finally {
    await launched.cleanup()
  }
})
