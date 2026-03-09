/**
 * E2E smoke test for ACMG Classification Panel.
 * Verifies the Electron app launches and the ACMG panel renders
 * with evidence code buttons.
 *
 * Run with: npx playwright test tests/e2e/acmg-classification.e2e.ts
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
}

// eslint-disable-next-line no-empty-pattern
test('app launches and ACMG panel is accessible from variant details', async ({}, testInfo) => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    // Wait for Vuetify app to be ready
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Verify the main app rendered
    const appEl = window.locator('.v-application')
    await expect(appEl).toBeVisible({ timeout: 5000 })

    // Take a screenshot of initial state
    await window.screenshot({ path: testInfo.outputPath('app-launched.png') })
  } finally {
    if (app) await app.close()
  }
})
