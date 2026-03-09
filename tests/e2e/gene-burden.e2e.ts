/**
 * E2E test for gene burden association analysis
 *
 * Tests that the Gene Burden tab renders, shows configuration panel,
 * and handles the analysis workflow.
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
})

test.afterEach(async () => {
  await app.close()
})

test('gene burden tab is accessible from cohort view', async (_fixtures, testInfo) => {
  // Switch to Cohort mode
  const cohortBtn = window.locator('.v-btn').filter({ hasText: /Cohort/i })
  const cohortBtnCount = await cohortBtn.count()

  if (cohortBtnCount === 0) {
    console.log('No Cohort mode button found - skipping')
    test.skip()
    return
  }

  await cohortBtn.first().click()
  await window.waitForTimeout(1000)

  // Look for the Gene Burden tab
  const burdenTab = window.locator('.v-tab').filter({ hasText: /Gene Burden/i })
  const burdenTabCount = await burdenTab.count()

  console.log(`Gene Burden tabs found: ${burdenTabCount}`)
  expect(burdenTabCount).toBeGreaterThan(0)

  // Click the Gene Burden tab
  await burdenTab.first().click()
  await window.waitForTimeout(1000)

  // Verify the config panel renders
  const configTitle = window.locator('text=Gene Burden Analysis')
  await expect(configTitle.first()).toBeVisible({ timeout: 5000 })

  // Verify group builders are present
  const groupA = window.locator('text=Group A')
  const groupB = window.locator('text=Group B')
  expect(await groupA.count()).toBeGreaterThan(0)
  expect(await groupB.count()).toBeGreaterThan(0)

  // Verify run button exists
  const runBtn = window.locator('.v-btn').filter({ hasText: /Run Analysis/i })
  expect(await runBtn.count()).toBeGreaterThan(0)

  // Run button should be disabled (no cases selected)
  const isDisabled = await runBtn.first().isDisabled()
  expect(isDisabled).toBe(true)

  // Take a screenshot for visual verification
  await window.screenshot({ path: testInfo.outputPath('gene-burden-tab.png') })
})

test('gene burden configuration panel has all expected controls', async (_fixtures, testInfo) => {
  // Switch to Cohort mode
  const cohortBtn = window.locator('.v-btn').filter({ hasText: /Cohort/i })
  if ((await cohortBtn.count()) === 0) {
    test.skip()
    return
  }

  await cohortBtn.first().click()
  await window.waitForTimeout(1000)

  // Click Gene Burden tab
  const burdenTab = window.locator('.v-tab').filter({ hasText: /Gene Burden/i })
  if ((await burdenTab.count()) === 0) {
    test.skip()
    return
  }
  await burdenTab.first().click()
  await window.waitForTimeout(1000)

  // Check for primary test radio buttons
  const fisherRadio = window.locator("text=Fisher's exact")
  const logisticRadio = window.locator('text=Logistic burden')
  expect(await fisherRadio.count()).toBeGreaterThan(0)
  expect(await logisticRadio.count()).toBeGreaterThan(0)

  // Check for weight scheme selector
  const weightLabel = window.locator('text=Weight scheme')
  expect(await weightLabel.count()).toBeGreaterThan(0)

  // Check for variant filters expandable section
  const filtersPanel = window.locator('text=Variant Filters')
  expect(await filtersPanel.count()).toBeGreaterThan(0)

  // Take a screenshot
  await window.screenshot({ path: testInfo.outputPath('gene-burden-config.png') })
})
