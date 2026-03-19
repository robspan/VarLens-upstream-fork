/**
 * E2E benchmark: startup performance with a large database.
 *
 * Measures how long it takes to:
 *  1. Launch the Electron app
 *  2. Open a large database (3.7 GB, 4.1M variants, 555 cases)
 *  3. Load the case list sidebar
 *  4. Select a case and render the variant table
 *  5. Switch to cohort view
 *
 * Run:
 *   LARGE_DB=/media/bernt-popp/1819-E513/varlens.db npx playwright test tests/e2e/startup-large-db.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { copyFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The large DB path — set via env var or skip the test
const LARGE_DB_PATH = process.env.LARGE_DB
const WORK_DB_PATH = join(tmpdir(), `varlens-startup-bench-${Date.now()}.db`)

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`
}

test.describe.serial('Startup performance with large database', () => {
  let app: ElectronApplication
  let window: Page

  // Generous timeout for large DB operations
  test.setTimeout(180_000)

  test.skip(!LARGE_DB_PATH || !existsSync(LARGE_DB_PATH ?? ''), 'LARGE_DB env var not set')

  test.beforeAll(async () => {
    // Copy the large DB to a temp location so we don't modify the original
    console.log(`Copying ${LARGE_DB_PATH} to ${WORK_DB_PATH} ...`)
    const copyStart = performance.now()
    copyFileSync(LARGE_DB_PATH!, WORK_DB_PATH)
    console.log(`  Copy took ${ms(copyStart)}`)

    // Launch the app
    const t0 = performance.now()
    app = await electron.launch({
      args: ['./out/main/index.js'],
      env: { ...process.env, NODE_ENV: 'production' }
    })
    console.log(`[BENCH] Electron launch: ${ms(t0)}`)

    window = await app.firstWindow()

    // Capture renderer console for debugging
    window.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[RENDERER ERROR] ${msg.text()}`)
    })

    await window.waitForLoadState('domcontentloaded')
    console.log(`[BENCH] DOM content loaded: ${ms(t0)}`)

    await window.waitForSelector('.v-application', { timeout: 30_000 })
    console.log(`[BENCH] Vuetify app shell: ${ms(t0)}`)

    // Dismiss disclaimer dialog if present
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(500)
    }
    console.log(`[BENCH] App ready: ${ms(t0)}`)
  })

  test.afterAll(async () => {
    if (app) await app.close()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = WORK_DB_PATH + suffix
      if (existsSync(p)) unlinkSync(p)
    }
  })

  // eslint-disable-next-line no-empty-pattern
  test('opens the large database', async ({}) => {
    const t0 = performance.now()

    // Try opening via IPC and capture full error details
    const result = await window.evaluate(async (dbPath: string) => {
      const start = Date.now()
      try {
        const res = await (window as any).api.database.open(dbPath)
        return { elapsed: Date.now() - start, ...res }
      } catch (err: any) {
        return {
          elapsed: Date.now() - start,
          success: false,
          error: err?.message ?? String(err),
          stack: err?.stack
        }
      }
    }, WORK_DB_PATH)

    console.log(`[BENCH] database:open elapsed: ${result.elapsed}ms (total ${ms(t0)})`)
    console.log(`[BENCH] Result:`, JSON.stringify(result, null, 2))

    // If it failed, also try to get main-process logs
    if (!result.success) {
      // Try to gather more info via evaluate in main process
      try {
        const mainInfo = await app.evaluate(async () => {
          return { pid: process.pid, versions: process.versions }
        })
        console.log(`[BENCH] Main process info:`, JSON.stringify(mainInfo))
      } catch {
        // ignore
      }
    }

    expect(result.success).toBe(true)
    console.log(`[BENCH] Database opened successfully`)
  })

  // eslint-disable-next-line no-empty-pattern
  test('case list renders', async ({}) => {
    const t0 = performance.now()

    // Reload the page so the renderer picks up the new database
    await window.reload()
    await window.waitForSelector('.v-application', { timeout: 30_000 })

    // Dismiss disclaimer again after reload
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(500)
    }
    console.log(`[BENCH] Page reloaded: ${ms(t0)}`)

    // Open sidebar if closed
    const sidebar = window.locator('.v-navigation-drawer--left')
    if (!(await sidebar.isVisible())) {
      const toggleBtn = window.locator('.sidebar-toggle-btn')
      if ((await toggleBtn.count()) > 0) {
        await toggleBtn.click()
        await window.waitForTimeout(300)
      }
    }

    // Navigate to case view
    const caseBtn = window.locator('.mode-toggle .v-btn').first()
    await caseBtn.click()
    await window.waitForTimeout(500)

    // Wait for case list to populate
    const caseList = window.locator('.case-list-item, .v-list-item')
    await caseList.first().waitFor({ timeout: 60_000 })

    const caseCount = await caseList.count()
    console.log(`[BENCH] Case list visible (${caseCount} items): ${ms(t0)}`)
    expect(caseCount).toBeGreaterThan(0)
  })

  // eslint-disable-next-line no-empty-pattern
  test('variant table renders for first case', async ({}) => {
    const t0 = performance.now()

    const firstCase = window.locator('.case-list-item, .v-list-item').first()
    await firstCase.click()

    const table = window.locator('.v-data-table, .v-table')
    await table.first().waitFor({ timeout: 60_000 })
    console.log(`[BENCH] Variant table visible: ${ms(t0)}`)

    const rows = window.locator('.v-data-table tbody tr, .v-table tbody tr')
    await rows.first().waitFor({ timeout: 30_000 })

    const rowCount = await rows.count()
    console.log(`[BENCH] Table rows: ${rowCount} in ${ms(t0)}`)
    expect(rowCount).toBeGreaterThan(0)

    await window.screenshot({ path: 'test-results/large-db-variant-table.png' })
  })

  // eslint-disable-next-line no-empty-pattern
  test('cohort view renders', async ({}) => {
    const t0 = performance.now()

    const cohortBtn = window.locator('.mode-toggle .v-btn').last()
    await cohortBtn.click()

    const table = window.locator('.v-data-table, .v-table')
    await table.first().waitFor({ timeout: 60_000 })
    console.log(`[BENCH] Cohort table visible: ${ms(t0)}`)

    const rows = window.locator('.v-data-table tbody tr, .v-table tbody tr')
    await rows.first().waitFor({ timeout: 60_000 })

    const rowCount = await rows.count()
    console.log(`[BENCH] Cohort rows: ${rowCount} in ${ms(t0)}`)

    await window.screenshot({ path: 'test-results/large-db-cohort-view.png' })
  })
})
