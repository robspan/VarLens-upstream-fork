/**
 * E2E smoke test for auto-update feature.
 * Verifies the Electron app launches and the footer is rendered.
 *
 * Run with: npx playwright test tests/e2e/auto-update.e2e.ts
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
test('app launches and footer renders with version', async ({}, testInfo) => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    // Wait for Vuetify app to be ready
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Verify the footer is rendered
    const footer = window.locator('.v-footer')
    await expect(footer).toBeVisible({ timeout: 5000 })

    // Verify the version button is present in the footer
    const versionBtn = footer.locator('button', { hasText: /v\d+\.\d+\.\d+/ })
    await expect(versionBtn).toBeVisible({ timeout: 5000 })

    // Verify network status icon is visible
    const networkIcon = footer.locator('.mdi-wifi, .mdi-wifi-off')
    await expect(networkIcon).toBeVisible()

    // Take a screenshot for visual verification
    await window.screenshot({ path: testInfo.outputPath('footer-with-update.png') })
  } finally {
    if (app) await app.close()
  }
})

test('app footer does not show update indicator in idle state', async () => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const footer = window.locator('.v-footer')
    await expect(footer).toBeVisible({ timeout: 5000 })

    // In idle state (no real update server), no update indicator buttons should be visible
    // The update indicator only shows for checking/available/downloading/downloaded/error states
    const updateIcons = footer.locator('.mdi-arrow-up-circle, .mdi-restart, .mdi-download')
    await expect(updateIcons).toHaveCount(0)
  } finally {
    if (app) await app.close()
  }
})
