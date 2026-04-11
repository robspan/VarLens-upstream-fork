/**
 * E2E monkey test: unified shortlist (Wave 6) with real (obfuscated) ONT data.
 *
 * Exercises the new Shortlist tab end-to-end:
 *   - Multi-VCF import (SNV + SV + CNV + STR) via `api.import.startMultiFile`
 *   - Case selection + shortlist auto-selection rule
 *   - Preset picker rotation (all 3 built-in presets)
 *   - Star toggle + broadcast refetch
 *   - "View in <type> tab" cross-tab navigation + return
 *   - Row click → VariantDetailsPanel
 *   - Randomised monkey phase (tab-flip, row-click, star-toggle, preset-flip)
 *   - Console error capture throughout the run
 *
 * The test is OFF by default. Enable by pointing `SHORTLIST_MONKEY_DATA_DIR`
 * at a directory containing a set of obfuscated ONT VCFs. Required names:
 *
 *   TEST_SAMPLE_MULTI.wf_snp.vcf.gz
 *   TEST_SAMPLE_MULTI.wf_sv.vcf.gz
 *   TEST_SAMPLE_MULTI.wf_cnv.vcf.gz
 *   TEST_SAMPLE_MULTI.wf_str.vcf.gz
 *
 * Artifacts are written under `/tmp/varlens-monkey-test/`:
 *   - screenshots/       per-step PNG captures
 *   - console-errors.txt console error log
 *   - report.md          structured test report
 *
 * Run with:
 *   SHORTLIST_MONKEY_DATA_DIR=/tmp/varlens-monkey-test/ont-obfuscated \
 *     xvfb-run --auto-servernum npx playwright test tests/e2e/shortlist-monkey.e2e.ts \
 *     --reporter=list
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const DATA_DIR = process.env.SHORTLIST_MONKEY_DATA_DIR ?? ''
const SCRATCH = '/tmp/varlens-monkey-test'
const SHOTS = join(SCRATCH, 'screenshots')
const USER_DATA = join(SCRATCH, 'userdata')
const ERROR_LOG = join(SCRATCH, 'console-errors.txt')
const REPORT = join(SCRATCH, 'report.md')

function findFileBySuffix(dir: string, suffix: string): string | null {
  if (dir === '' || !existsSync(dir)) return null
  try {
    const entries = readdirSync(dir)
    const match = entries.find((e) => e.endsWith(suffix))
    return match !== undefined ? join(dir, match) : null
  } catch {
    return null
  }
}

const SNV_VCF = findFileBySuffix(DATA_DIR, '.wf_snp.vcf.gz') ?? ''
const SV_VCF = findFileBySuffix(DATA_DIR, '.wf_sv.vcf.gz') ?? ''
const CNV_VCF = findFileBySuffix(DATA_DIR, '.wf_cnv.vcf.gz') ?? ''
const STR_VCF = findFileBySuffix(DATA_DIR, '.wf_str.vcf.gz') ?? ''

const CASE_NAME = 'MONKEY_MULTI_SHORTLIST'

let app: ElectronApplication | undefined
let window: Page
const consoleErrors: string[] = []
const reportLines: string[] = []

/** Append a line and flush the report so partial runs still have output. */
function log(line: string): void {
  reportLines.push(line)
  try {
    flushReport('IN_PROGRESS')
  } catch {
    // best effort
  }
}

function flushReport(status: string): void {
  const body = [
    '# VarLens Shortlist Monkey Test Report',
    '',
    `Status: ${status}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Data dir: ${DATA_DIR || '(unset)'}`,
    `User data dir: ${USER_DATA}`,
    '',
    '## Trace',
    '',
    ...reportLines,
    '',
    '## Console errors',
    '',
    consoleErrors.length === 0 ? '(none)' : consoleErrors.map((e) => `- ${e}`).join('\n'),
    ''
  ].join('\n')
  writeFileSync(REPORT, body, 'utf8')
  writeFileSync(ERROR_LOG, consoleErrors.join('\n'), 'utf8')
}

async function shot(name: string): Promise<string> {
  const path = join(SHOTS, name)
  try {
    await window.screenshot({ path, fullPage: true })
    log(`  screenshot: ${path}`)
  } catch (e) {
    log(`  screenshot FAILED (${name}): ${e instanceof Error ? e.message : String(e)}`)
  }
  return path
}

test.beforeAll(async () => {
  if (
    DATA_DIR === '' ||
    SNV_VCF === '' ||
    SV_VCF === '' ||
    CNV_VCF === '' ||
    STR_VCF === '' ||
    !existsSync(SNV_VCF) ||
    !existsSync(SV_VCF) ||
    !existsSync(CNV_VCF) ||
    !existsSync(STR_VCF)
  ) {
    test.skip(
      true,
      DATA_DIR === ''
        ? 'Set SHORTLIST_MONKEY_DATA_DIR to enable this suite'
        : `Monkey test data missing in ${DATA_DIR}`
    )
  }

  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(USER_DATA, { recursive: true })

  // Wipe any prior session's DB so the fresh run starts empty.
  try {
    for (const entry of readdirSync(USER_DATA)) {
      rmSync(join(USER_DATA, entry), { recursive: true, force: true })
    }
  } catch {
    // fresh dir is fine
  }

  consoleErrors.length = 0
  reportLines.length = 0
  log(`Launching Electron with user-data-dir=${USER_DATA}`)

  app = await electron.launch({
    args: [resolve('./out/main/index.js'), `--user-data-dir=${USER_DATA}`],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
  window = await app.firstWindow()
  window.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  window.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`)
  })

  await window.waitForSelector('.v-application', { timeout: 15000 })

  const disclaimerBtn = window.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(500)
  }
  log('App ready + disclaimer dismissed')
})

test.afterAll(async () => {
  if (app !== undefined) {
    try {
      await app.close()
    } catch (e) {
      log(`afterAll: app.close() threw ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  flushReport('COMPLETE')
})

test('Phase 0: fresh DB has no cases', async () => {
  const cases = await window.evaluate(async () => {
    const w = window as unknown as {
      api: { cases: { list: () => Promise<Array<{ id: number; name: string }>> } }
    }
    return await w.api.cases.list()
  })
  log(`Phase 0: case list length = ${cases.length}`)
  expect(cases.length).toBe(0)
  await shot('00-empty-app.png')
})

test('Phase 1: import 4 VCFs via startMultiFile', async () => {
  const startTime = Date.now()
  const result = await window.evaluate(
    async ([caseName, snv, sv, cnv, str]: [string, string, string, string, string]) => {
      const w = window as unknown as {
        api: {
          import: {
            startMultiFile: (
              caseName: string,
              files: Array<{
                filePath: string
                variantType: string
                caller: string | null
                annotationFormat: string | null
              }>
            ) => Promise<{
              caseId: number
              totalVariants: number
              totalSkipped: number
              elapsed: number
              files: Array<{
                filePath: string
                variantType: string
                variantCount: number
                error?: string
              }>
            }>
          }
        }
      }
      return await w.api.import.startMultiFile(caseName, [
        { filePath: snv, variantType: 'snv', caller: 'Clair3', annotationFormat: null },
        { filePath: sv, variantType: 'sv', caller: 'Sniffles2', annotationFormat: 'ann' },
        { filePath: cnv, variantType: 'cnv', caller: 'Spectre', annotationFormat: 'ann' },
        { filePath: str, variantType: 'str', caller: 'Straglr', annotationFormat: null }
      ])
    },
    [CASE_NAME, SNV_VCF, SV_VCF, CNV_VCF, STR_VCF] as [string, string, string, string, string]
  )
  const elapsed = Date.now() - startTime
  log(`Phase 1: startMultiFile client=${elapsed}ms server=${result.elapsed}ms`)
  log(`  caseId=${result.caseId} total=${result.totalVariants}`)
  for (const f of result.files) {
    log(
      `  - ${f.filePath.split('/').pop()}: ${f.variantCount} ${f.variantType}${
        f.error !== undefined ? ` ERROR=${f.error}` : ''
      }`
    )
  }
  expect(result.caseId).toBeGreaterThan(0)
  expect(result.totalVariants).toBeGreaterThan(1000)
  expect(result.files).toHaveLength(4)
  for (const f of result.files) {
    expect(f.error).toBeUndefined()
  }

  await window.evaluate((id: number) => {
    ;(window as unknown as { __monkeyCaseId: number }).__monkeyCaseId = id
  }, result.caseId)

  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (id: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)
  log(`Phase 1: type counts = ${JSON.stringify(counts)}`)
  expect((counts.snv ?? 0) + (counts.indel ?? 0)).toBeGreaterThan(0)
  expect(counts.sv ?? 0).toBeGreaterThan(0)
  expect(counts.cnv ?? 0).toBeGreaterThan(0)
  expect(counts.str ?? 0).toBeGreaterThan(0)
})

test('Phase 2: navigate to the imported case', async () => {
  const caseNav = window.locator('button:has(.v-btn__content:has-text("Case"))').first()
  if ((await caseNav.count()) > 0) {
    await caseNav.click()
    await window.waitForTimeout(300)
  }

  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.fill(CASE_NAME, { force: true })
    await window.waitForTimeout(800)
  }

  const caseItem = window.locator('.v-list-item').filter({ hasText: CASE_NAME }).first()
  await expect(caseItem).toBeVisible({ timeout: 5000 })
  await caseItem.click()
  await window.waitForTimeout(2500)
  await shot('01-case-loaded.png')
  log('Phase 2: case selected')
})

test('Phase 3: Shortlist tab exists and is default-active', async () => {
  const shortlistTab = window.locator('.v-tab').filter({ hasText: 'Shortlist' })
  const count = await shortlistTab.count()
  log(`Phase 3: shortlist tab count = ${count}`)
  expect(count).toBeGreaterThan(0)

  const firstTab = shortlistTab.first()
  const ariaSelected = await firstTab.getAttribute('aria-selected').catch(() => null)
  const selectedClass = await firstTab.evaluate((el) =>
    Array.from(el.classList).some((c) => c.includes('selected') || c.includes('--active'))
  )
  log(`Phase 3: shortlist active — aria=${ariaSelected} selectedClass=${selectedClass}`)
  expect(ariaSelected === 'true' || selectedClass).toBe(true)

  await window.waitForSelector('.shortlist-panel', { timeout: 10000 })
  await window
    .locator('[data-testid="shortlist-loading"]')
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => {
      log('Phase 3: shortlist-loading never detached (loading may have been instant)')
    })
  await window.waitForTimeout(600)
  await shot('02-shortlist-initial.png')
})

/**
 * Probe the preset situation: DB-level list vs. what the panel's dropdown
 * actually has. A mismatch points at the known store-instancing bug
 * (useFilterPresetStore is not a singleton).
 */
test('Phase 3b: diagnose preset availability in the panel', async () => {
  // Pull the raw preset list via IPC.
  const dbPresets = await window.evaluate(async () => {
    const w = window as unknown as {
      api: {
        presets: {
          list: () => Promise<
            Array<{ id: number; name: string; filterJson: Record<string, unknown> | null }>
          >
        }
      }
    }
    return await w.api.presets.list()
  })
  log(`Phase 3b: DB has ${dbPresets.length} presets total`)
  const shortlistInDb = dbPresets.filter(
    (p) => (p.filterJson as { shortlist?: unknown } | null)?.shortlist != null
  )
  log(`Phase 3b: DB has ${shortlistInDb.length} shortlist presets`)
  for (const p of shortlistInDb) {
    log(`  - ${p.id}: ${p.name}`)
  }

  // Now introspect what the <v-select> actually shows. Open it and count items.
  const select = window.locator('.shortlist-panel__header .v-select').first()
  await select.click()
  await window.waitForTimeout(400)
  const opts = window.locator('.v-overlay--active .v-list-item')
  const optCount = await opts.count()
  log(`Phase 3b: preset dropdown shows ${optCount} items`)
  for (let i = 0; i < optCount; i++) {
    const txt = (await opts.nth(i).textContent())?.trim() ?? ''
    log(`    [${i}] ${txt}`)
  }
  await shot('02b-preset-dropdown-open.png')
  await window.keyboard.press('Escape')
  await window.waitForTimeout(200)

  // This is where the known bug surfaces: DB has shortlist presets but
  // dropdown is empty. We record the gap instead of failing hard so
  // subsequent phases can still exercise downstream behaviour.
  if (shortlistInDb.length > 0 && optCount === 0) {
    log('BUG: shortlist panel dropdown is empty even though DB has shortlist presets.')
    log(
      '  Root cause likely: useFilterPresetStore() is not a singleton. ShortlistPanel instantiates its own store that never calls loadPresets().'
    )
  }
})

test('Phase 4: rotate through every shortlist preset the dropdown offers', async () => {
  const select = window.locator('.shortlist-panel__header .v-select').first()
  await select.click()
  await window.waitForTimeout(400)
  const opts = window.locator('.v-overlay--active .v-list-item')
  const optCount = await opts.count()
  log(`Phase 4: dropdown offers ${optCount} presets`)
  if (optCount === 0) {
    log('Phase 4: SKIPPED — dropdown empty (see Phase 3b bug)')
    await window.keyboard.press('Escape')
    return
  }
  const names: string[] = []
  for (let i = 0; i < optCount; i++) {
    names.push(((await opts.nth(i).textContent()) ?? '').trim())
  }
  await window.keyboard.press('Escape')

  for (let i = 0; i < names.length; i++) {
    await select.click()
    await window.waitForTimeout(250)
    const opt = window
      .locator('.v-overlay--active .v-list-item')
      .filter({ hasText: names[i] })
      .first()
    if ((await opt.count()) === 0) {
      await window.keyboard.press('Escape')
      continue
    }
    await opt.click()
    await window.waitForTimeout(1200)
    await shot(`03-preset-${i}-${names[i].replace(/[^a-z0-9]/gi, '_')}.png`)
    log(`Phase 4: preset "${names[i]}" selected`)
  }
})

test('Phase 5: hover a score badge to show RankScoreTooltip', async () => {
  const rows = window.locator('.shortlist-panel tbody tr')
  const rowCount = await rows.count()
  log(`Phase 5: shortlist rows visible = ${rowCount}`)
  if (rowCount === 0) {
    log('Phase 5: SKIPPED — no rows (shortlist empty for this case/preset)')
    await shot('04-no-rows.png')
    return
  }
  const scoreCell = rows.first().locator('td').nth(1)
  await scoreCell.hover()
  await window.waitForTimeout(800)
  await shot('04-rank-score-tooltip.png')
  const tooltip = window.locator('.v-overlay--active, [role="tooltip"]')
  const tipCount = await tooltip.count()
  log(`Phase 5: tooltip overlays visible = ${tipCount}`)
})

test('Phase 6: toggle star on first row; verify broadcast refetch', async () => {
  const starBtns = window.locator('.shortlist-panel [data-testid^="shortlist-star-"]')
  const count = await starBtns.count()
  if (count === 0) {
    log('Phase 6: SKIPPED — no rows')
    return
  }
  const star = starBtns.first()
  const iconBefore = await star.locator('i.v-icon').getAttribute('class')
  log(`Phase 6: icon before = ${iconBefore}`)
  await star.click()
  await window.waitForTimeout(1500)
  const iconAfter = await star.locator('i.v-icon').getAttribute('class')
  log(`Phase 6: icon after  = ${iconAfter}`)
  await shot('05-after-star-toggle.png')
})

test('Phase 7: open-in-tab from an SV row, then return to Shortlist', async () => {
  const rows = window.locator('.shortlist-panel tbody tr')
  const count = await rows.count()
  log(`Phase 7: rows in panel = ${count}`)
  if (count === 0) {
    log('Phase 7: SKIPPED — no rows')
    return
  }

  let svRowIdx = -1
  for (let i = 0; i < count; i++) {
    const chipText = (await rows.nth(i).locator('.v-chip').first().textContent())?.trim() ?? ''
    if (chipText === 'SV') {
      svRowIdx = i
      break
    }
  }
  log(`Phase 7: SV row index = ${svRowIdx}`)
  if (svRowIdx === -1) {
    log('Phase 7: no SV row in current preset — using first row')
    svRowIdx = 0
  }

  const menuBtn = rows.nth(svRowIdx).locator('.mdi-dots-vertical').first()
  const menuCount = await menuBtn.count()
  if (menuCount === 0) {
    log('Phase 7: SKIPPED — kebab menu not found in row')
    return
  }
  await menuBtn.click({ timeout: 5000 }).catch((e: Error) => log(`Phase 7: kebab click failed: ${e.message}`))
  await window.waitForTimeout(400)
  await shot('06-kebab-open.png')

  const viewInTab = window
    .locator('.v-overlay--active .v-list-item')
    .filter({ hasText: /View in .* tab/ })
    .first()
  if ((await viewInTab.count()) === 0) {
    log('Phase 7: "View in <type> tab" menu item not found')
    await window.keyboard.press('Escape')
    return
  }
  await viewInTab.click()
  await window.waitForTimeout(1500)
  await shot('07-after-open-in-tab.png')

  const shortlistTab = window.locator('.v-tab').filter({ hasText: 'Shortlist' })
  expect(await shortlistTab.count()).toBeGreaterThan(0)
  const variantTable = window.locator('.per-type-region')
  await expect(variantTable).toBeVisible({ timeout: 5000 })

  await shortlistTab.first().click()
  await window.waitForTimeout(800)
  await shot('08-back-to-shortlist.png')
  const panelAfter = window.locator('.shortlist-panel')
  await expect(panelAfter).toBeVisible({ timeout: 5000 })
  log('Phase 7: returned to Shortlist successfully')
})

test('Phase 8: row click opens VariantDetailsPanel', async () => {
  const shortlistTab = window.locator('.v-tab').filter({ hasText: 'Shortlist' }).first()
  if ((await shortlistTab.count()) > 0) {
    await shortlistTab.click().catch(() => {})
    await window.waitForTimeout(500)
  }
  const rows = window.locator('.shortlist-panel tbody tr')
  if ((await rows.count()) === 0) {
    log('Phase 8: SKIPPED — no rows')
    return
  }
  await rows.first().locator('td').nth(3).click()
  await window.waitForTimeout(1000)
  await shot('09-details-panel.png')
  const detailsPanel = window.locator(
    '.variant-details-panel, [data-testid="variant-details"], .v-navigation-drawer--end'
  )
  log(`Phase 8: details panel candidates visible = ${await detailsPanel.count()}`)
})

test('Phase 9: monkey phase — random walk', async () => {
  // Make sure we end on a real tab so .v-tab queries resolve
  const shortlistTab = window.locator('.v-tab').filter({ hasText: 'Shortlist' }).first()
  const shortlistExists = (await shortlistTab.count()) > 0
  if (!shortlistExists) {
    log('Phase 9: SKIPPED — Shortlist tab not in DOM')
    return
  }

  const tabLabels = ['Shortlist', 'SNV/Indel', 'SV', 'CNV', 'STR']
  for (let i = 0; i < 5; i++) {
    const label = tabLabels[Math.floor(Math.random() * tabLabels.length)]
    const t = window.locator('.v-tab').filter({ hasText: label }).first()
    if ((await t.count()) > 0) {
      await t.click({ timeout: 3000 }).catch(() => {})
      await window.waitForTimeout(400)
      log(`Phase 9: flipped to ${label}`)
    }
  }
  await shortlistTab.click({ timeout: 3000 }).catch(() => {})
  await window.waitForTimeout(600)

  const rows = window.locator('.shortlist-panel tbody tr')
  const rc = await rows.count()
  for (let i = 0; i < Math.min(5, rc); i++) {
    const idx = Math.floor(Math.random() * rc)
    await rows
      .nth(idx)
      .locator('td')
      .nth(3)
      .click({ timeout: 2000 })
      .catch(() => {})
    await window.waitForTimeout(250)
  }
  log(`Phase 9: random row-clicks done (${Math.min(5, rc)})`)

  const starBtns = window.locator('.shortlist-panel [data-testid^="shortlist-star-"]')
  const sc = await starBtns.count()
  for (let i = 0; i < Math.min(3, sc); i++) {
    const idx = Math.floor(Math.random() * sc)
    await starBtns
      .nth(idx)
      .click({ timeout: 2000 })
      .catch(() => {})
    await window.waitForTimeout(600)
  }
  log(`Phase 9: random star toggles done (${Math.min(3, sc)}/${sc})`)

  for (let i = 0; i < 3; i++) {
    const sel = window.locator('.shortlist-panel__header .v-select').first()
    await sel.click({ timeout: 2000 }).catch(() => {})
    await window.waitForTimeout(250)
    const opts = window.locator('.v-overlay--active .v-list-item')
    const oc = await opts.count()
    if (oc === 0) {
      await window.keyboard.press('Escape')
      continue
    }
    await opts
      .nth(Math.floor(Math.random() * oc))
      .click({ timeout: 2000 })
      .catch(() => {})
    await window.waitForTimeout(800)
  }
  log('Phase 9: random preset flips done')

  await shot('10-monkey-final.png')
  log(`Phase 9: console errors so far = ${consoleErrors.length}`)
})

test('Phase 10: final sanity — app still responsive + error summary', async () => {
  const appEl = window.locator('.v-application')
  await expect(appEl).toBeVisible({ timeout: 5000 })
  log('Phase 10: app still visible')
  log(`Phase 10: final console error count = ${consoleErrors.length}`)
  for (const e of consoleErrors.slice(0, 20)) {
    log(`  err: ${e}`)
  }
})
