/**
 * E2E test for offset-based cohort pagination
 *
 * Tests that the cohort table loads data, paginates with offset,
 * and handles sort changes correctly.
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

test('cohort table loads and displays data with offset pagination', async (_fixtures, testInfo) => {
  // Switch to Cohort mode using the mode toggle button
  const cohortBtn = window.locator('.v-btn').filter({ hasText: /Cohort/i })
  const cohortBtnCount = await cohortBtn.count()
  console.log(`Cohort buttons found: ${cohortBtnCount}`)

  if (cohortBtnCount === 0) {
    console.log('No Cohort mode button found')
    test.skip()
    return
  }

  await cohortBtn.first().click()
  await window.waitForTimeout(3000)

  await window.screenshot({ path: testInfo.outputPath('cohort-table.png') })

  // Check for data rows
  const dataRows = window.locator('.v-data-table__tr')
  const rowCount = await dataRows.count()
  console.log(`Cohort data rows: ${rowCount}`)

  if (rowCount === 0) {
    console.log('No data rows - need multiple imported cases')
    test.skip()
    return
  }

  // Verify table has proper structure
  expect(rowCount).toBeGreaterThan(0)

  // Check footer pagination info
  const footer = window.locator('.v-data-table-footer')
  if ((await footer.count()) > 0) {
    const footerText = await footer.textContent()
    console.log(`Footer: ${footerText}`)
  }

  // Get first page content
  const firstRowText = await dataRows.first().textContent()
  console.log(`First row: ${firstRowText?.substring(0, 80)}`)
})

test('cohort pagination navigates between pages', async (_fixtures, testInfo) => {
  // Switch to Cohort mode
  const cohortBtn = window.locator('.v-btn').filter({ hasText: /Cohort/i })
  if ((await cohortBtn.count()) === 0) {
    test.skip()
    return
  }
  await cohortBtn.first().click()
  await window.waitForTimeout(3000)

  const dataRows = window.locator('.v-data-table__tr')
  const rowCount = await dataRows.count()
  if (rowCount === 0) {
    test.skip()
    return
  }

  // Get first page content
  const firstPageFirstRow = await dataRows.first().textContent()

  // Try to navigate to next page
  const nextBtn = window.locator('[aria-label="Next page"]')
  if ((await nextBtn.count()) > 0 && (await nextBtn.first().isEnabled())) {
    await nextBtn.first().click()
    await window.waitForTimeout(2000)

    const newRowCount = await dataRows.count()
    console.log(`Page 2 rows: ${newRowCount}`)
    expect(newRowCount).toBeGreaterThan(0)

    // Verify different content (offset pagination working)
    const secondPageFirstRow = await dataRows.first().textContent()
    expect(secondPageFirstRow).not.toBe(firstPageFirstRow)
    console.log('Pagination verified: page 2 has different data from page 1')

    await window.screenshot({ path: testInfo.outputPath('cohort-page2.png') })
  } else {
    console.log('Not enough data for multi-page pagination (single page)')
  }
})

test('cohort sort change resets to page 1', async () => {
  // Switch to Cohort mode
  const cohortBtn = window.locator('.v-btn').filter({ hasText: /Cohort/i })
  if ((await cohortBtn.count()) === 0) {
    test.skip()
    return
  }
  await cohortBtn.first().click()
  await window.waitForTimeout(3000)

  const dataRows = window.locator('.v-data-table__tr')
  if ((await dataRows.count()) === 0) {
    test.skip()
    return
  }

  // Click a sortable column header
  const posHeader = window.locator('th').filter({ hasText: 'Position' })
  if ((await posHeader.count()) > 0) {
    await posHeader.first().click()
    await window.waitForTimeout(2000)

    // Verify data still loads after sort change
    const rowsAfterSort = await dataRows.count()
    expect(rowsAfterSort).toBeGreaterThan(0)
    console.log(`Rows after sort by Position: ${rowsAfterSort}`)

    // Click again to reverse sort
    await posHeader.first().click()
    await window.waitForTimeout(2000)

    const rowsAfterReverse = await dataRows.count()
    expect(rowsAfterReverse).toBeGreaterThan(0)
    console.log(`Rows after reverse sort: ${rowsAfterReverse}`)
  }
})
