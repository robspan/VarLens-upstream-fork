/**
 * E2E test for enhanced case metadata feature
 *
 * Tests the tabbed metadata modal with Comments and Metrics tabs.
 * Uses Playwright's native Electron support with the existing user data.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'

const APP_PATH = join(__dirname, '../../out/main/index.js')

let app: ElectronApplication
let window: Page

test.beforeEach(async () => {
  app = await electron.launch({
    args: [APP_PATH],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DISPLAY: ':0'
    }
  })

  window = await app.firstWindow()
  await window.waitForSelector('.v-application', { timeout: 30000 })

  // Dismiss "Research Use Only" disclaimer if it appears
  const disclaimerBtn = window.locator('text=I Understand')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(500)
  }

  // Select the first case in the sidebar, skip if not available
  const testCaseLocator = window.locator('text=TestCase_001')
  if ((await testCaseLocator.count()) === 0) {
    test.skip()
    return
  }
  await testCaseLocator.first().click({ force: true })
  await window.waitForTimeout(2000)
})

test.afterEach(async () => {
  await app.close()
})

async function openMetadataModal(page: Page): Promise<void> {
  // The metadata modal opens by clicking the case name or the info icon in the header
  // The info icon is mdi-information-outline next to the case name
  const infoIcon = page.locator('.mdi-information-outline').first()
  if ((await infoIcon.count()) > 0) {
    await infoIcon.click({ force: true })
  } else {
    // Fallback: click the case name text in the header
    await page.locator('.clickable-case-name').first().click({ force: true })
  }
  await page.waitForTimeout(1000)
}

test.describe('Enhanced Case Metadata', () => {
  test('metadata modal has three tabs (Overview, Comments, Metrics)', async () => {
    // Open the metadata modal
    await openMetadataModal(window)

    // Verify three tabs exist
    const tabs = window.locator('.v-tab')
    const tabCount = await tabs.count()
    const tabTexts = await tabs.allTextContents()
    console.log(`Tabs found: ${tabCount}, texts: ${tabTexts}`)

    expect(tabCount).toBe(3)
    expect(tabTexts.some((t) => t.includes('Overview'))).toBeTruthy()
    expect(tabTexts.some((t) => t.includes('Comments'))).toBeTruthy()
    expect(tabTexts.some((t) => t.includes('Metrics'))).toBeTruthy()

    // Test Comments tab
    await tabs.filter({ hasText: 'Comments' }).click()
    await window.waitForTimeout(500)
    expect(await window.locator('text=Add a comment').count()).toBeGreaterThan(0)

    // Test Metrics tab
    await tabs.filter({ hasText: 'Metrics' }).click()
    await window.waitForTimeout(500)
    expect(await window.locator('text=Add a metric').count()).toBeGreaterThan(0)

    // Back to Overview
    await tabs.filter({ hasText: 'Overview' }).click()
    await window.waitForTimeout(500)
  })

  test('can add and see a comment in the Comments tab', async () => {
    await openMetadataModal(window)

    // Go to Comments tab
    await window.locator('.v-tab').filter({ hasText: 'Comments' }).click()
    await window.waitForTimeout(500)

    // Type a comment in the textarea
    const textarea = window.locator('textarea').first()
    await textarea.fill('E2E test comment')
    await window.waitForTimeout(300)

    // Click Add Comment
    await window.locator('button:has-text("Add Comment")').click()
    await window.waitForTimeout(1000)

    // Verify the comment appears
    expect(await window.locator('text=E2E test comment').count()).toBeGreaterThan(0)
  })

  test('can search and select metrics in the Metrics tab', async () => {
    await openMetadataModal(window)

    // Go to Metrics tab
    await window.locator('.v-tab').filter({ hasText: 'Metrics' }).click()
    await window.waitForTimeout(500)

    // Scope selectors within the dialog card
    const dialog = window.locator('.v-dialog .v-card')

    // Click autocomplete and type to search
    const autocomplete = window.getByRole('combobox', { name: 'Add a metric...' })
    await autocomplete.click({ force: true })
    await autocomplete.fill('Height')
    await window.waitForTimeout(500)

    // Check suggestions appeared in the dropdown overlay
    const menuItems = window.locator('.v-overlay--active .v-list-item')
    const menuCount = await menuItems.count()
    console.log(`Metric suggestions found: ${menuCount}`)

    if (menuCount > 0) {
      // Select first suggestion
      await menuItems.first().click()
      await window.waitForTimeout(500)

      // Enter a numeric value (scoped to dialog)
      const valueInput = dialog.locator('input[type="number"]')
      if ((await valueInput.count()) > 0) {
        await valueInput.fill('175')

        // Save
        await dialog.locator('button:has-text("Save")').click()
        await window.waitForTimeout(1000)

        // Verify metric appears in the list
        expect(await dialog.locator('text=175').count()).toBeGreaterThan(0)
      }
    }
  })
})
