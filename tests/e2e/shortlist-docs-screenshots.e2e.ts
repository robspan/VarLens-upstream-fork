/**
 * E2E: capture documentation screenshots for the unified shortlist feature.
 *
 * Launches Electron, imports the obfuscated ONT multi-type fixture, then
 * captures a small set of well-framed PNGs that ship with the user-facing
 * documentation at `docs/features/shortlist.md`. Each shot is saved
 * twice — once raw under `/tmp/varlens-monkey-test/docs-shots/` and once
 * annotated under the same directory with an `-annotated.png` suffix
 * (annotations are applied post-run by `scripts/annotate-shortlist-docs-shots.sh`).
 *
 * Off by default. Run with:
 *
 *   SHORTLIST_MONKEY_DATA_DIR=/tmp/varlens-monkey-test/ont-obfuscated \
 *     xvfb-run --auto-servernum npx playwright test \
 *     tests/e2e/shortlist-docs-screenshots.e2e.ts --reporter=list
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const DATA_DIR = process.env.SHORTLIST_MONKEY_DATA_DIR ?? ''
const SCRATCH = '/tmp/varlens-monkey-test'
const SHOTS = join(SCRATCH, 'docs-shots')
const USER_DATA = join(SCRATCH, 'docs-userdata')

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

const CASE_NAME = 'DOCS_SHORTLIST_FIXTURE'

let app: ElectronApplication | undefined
let window: Page

test.beforeAll(async () => {
  if (
    DATA_DIR === '' ||
    SNV_VCF === '' ||
    SV_VCF === '' ||
    CNV_VCF === '' ||
    STR_VCF === ''
  ) {
    test.skip(
      true,
      'SHORTLIST_MONKEY_DATA_DIR is unset or the required .wf_{snp,sv,cnv,str}.vcf.gz files are missing'
    )
    return
  }

  if (existsSync(USER_DATA)) {
    rmSync(USER_DATA, { recursive: true, force: true })
  }
  mkdirSync(USER_DATA, { recursive: true })
  mkdirSync(SHOTS, { recursive: true })

  app = await electron.launch({
    args: [resolve('./out/main/index.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  window = await app.firstWindow()
  await window.setViewportSize({ width: 1400, height: 900 })
  await window.waitForSelector('.v-application', { timeout: 15000 })

  const disclaimerBtn = window.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(300)
  }
})

test.afterAll(async () => {
  if (app !== undefined) {
    try {
      await app.close()
    } catch {
      // best effort
    }
  }
})

test('import the multi-type case', async () => {
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
            ) => Promise<{ caseId: number; totalVariants: number }>
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
  expect(result.caseId).toBeGreaterThan(0)
})

test('shot 01: shortlist tab active in case view (+ bounding boxes)', async () => {
  // Navigate to the case via the sidebar list.
  const caseNav = window.locator('button:has(.v-btn__content:has-text("Case"))').first()
  if ((await caseNav.count()) > 0) {
    await caseNav.click()
    await window.waitForTimeout(300)
  }
  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.fill(CASE_NAME, { force: true })
    await window.waitForTimeout(500)
  }
  const caseItem = window.locator('.v-list-item').filter({ hasText: CASE_NAME }).first()
  await expect(caseItem).toBeVisible({ timeout: 5000 })
  await caseItem.click()
  await window.waitForTimeout(2000)

  await window.waitForSelector('.shortlist-panel', { timeout: 10000 })
  await window
    .locator('[data-testid="shortlist-loading"]')
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined)
  await window.waitForTimeout(800)

  // Full-window screenshot for the main feature doc image.
  await window.screenshot({ path: join(SHOTS, '01-shortlist-tab.png'), fullPage: false })

  // Collect bounding boxes for the regions we want to highlight. ImageMagick
  // post-processing reads these from the emitted JSON and draws rectangles.
  const shortlistTab = window.locator('.v-tab.shortlist-tab').first()
  const presetPicker = window.locator('.shortlist-panel__header').first()
  const firstRow = window.locator('.shortlist-data-table tbody tr').first()
  const firstScoreCell = firstRow.locator('td').nth(1)

  const tabBox = await shortlistTab.boundingBox()
  const pickerBox = await presetPicker.boundingBox()
  const rowBox = await firstRow.boundingBox()
  const scoreBox = await firstScoreCell.boundingBox()

  writeFileSync(
    join(SHOTS, '01-shortlist-tab.boxes.json'),
    JSON.stringify(
      {
        image: '01-shortlist-tab.png',
        boxes: {
          shortlistTab: tabBox,
          panelHeader: pickerBox,
          firstRow: rowBox,
          rankScoreCell: scoreBox
        }
      },
      null,
      2
    ),
    'utf8'
  )
})

test('shot 02: rank score tooltip visible above the score cell', async () => {
  // Hover the first score cell to trigger the tooltip. Vuetify's v-tooltip
  // default open delay is 400ms (`openDelay` in plugins/vuetify.ts). Wait
  // well past that before capturing.
  const firstScoreCell = window
    .locator('.shortlist-data-table tbody tr')
    .first()
    .locator('td')
    .nth(1)
  await firstScoreCell.scrollIntoViewIfNeeded()
  await firstScoreCell.hover({ force: true })
  // Long wait + explicit poll for the tooltip overlay so we don't race it.
  await window.waitForSelector('.v-overlay .v-tooltip__content', { timeout: 5000 }).catch(() => {
    // Fallback: some Vuetify builds render tooltips under a different class
  })
  await window.waitForTimeout(1000)

  await window.screenshot({ path: join(SHOTS, '02-score-tooltip.png'), fullPage: false })
})

test('shot 04: application preferences — case view section', async () => {
  // Move the mouse away to dismiss any stray tooltip.
  await window.mouse.move(0, 0)
  await window.waitForTimeout(300)

  // Open the gear menu in the app toolbar via its testing seam.
  const settingsBtn = window.locator('[data-testid="app-settings-menu"]').first()
  await expect(settingsBtn).toBeVisible({ timeout: 5000 })
  await settingsBtn.click()
  await window.waitForTimeout(400)

  // Click the "Application Preferences" menu item.
  const prefItem = window.locator('.v-list-item').filter({ hasText: 'Application Preferences' }).first()
  await expect(prefItem).toBeVisible({ timeout: 3000 })
  await prefItem.click()

  // Wait for the dialog to open and stabilize.
  await window.waitForSelector('.v-dialog .v-card-title:has-text("Application Preferences")', {
    timeout: 5000
  })
  await window.waitForTimeout(500)

  await window.screenshot({ path: join(SHOTS, '04-preferences-case-view.png'), fullPage: false })

  // Bounding box for the "Case View" section — the region we'll highlight
  // in the annotated version. The section header is a div with the text
  // "Case View"; Vuetify's dialog uses a v-card-text as its scroll region.
  const cardText = window.locator('.v-dialog .v-card-text').first()
  const dialogBox = await cardText.boundingBox()

  // Precise span of the Case View section within the card. It begins at the
  // "Case View" subtitle and ends just before the divider that precedes the
  // "Performance" subtitle. We compute it from the inner v-select for
  // defaultCaseTab and its parent label/hint.
  const defaultCaseTabSelect = window.locator('.v-dialog .v-select').nth(1) // 0 = itemsPerPage, 1 = defaultCaseTab
  const selectBox = await defaultCaseTabSelect.boundingBox()

  writeFileSync(
    join(SHOTS, '04-preferences-case-view.boxes.json'),
    JSON.stringify(
      {
        image: '04-preferences-case-view.png',
        boxes: {
          dialogCardText: dialogBox,
          defaultCaseTabSelect: selectBox
        }
      },
      null,
      2
    ),
    'utf8'
  )
})
