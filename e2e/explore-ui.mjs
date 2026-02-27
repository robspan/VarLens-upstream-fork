import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SCREENSHOT_DIR = path.join(ROOT, 'e2e/screenshots')
const VARIANT_FILE = '/home/bernt/development/varvis-connector-dev/tmp/LB26-0434.json.gz'

async function main() {
  console.log('Launching Electron app...')
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    cwd: ROOT
  })

  const window = await app.firstWindow()
  await window.waitForSelector('.v-application', { timeout: 15000 })
  await window.setViewportSize({ width: 1920, height: 1080 })
  await window.waitForTimeout(1000)

  // Dismiss disclaimer
  const dismissBtn = window.locator('text=I Understand — Continue')
  if ((await dismissBtn.count()) > 0) {
    await dismissBtn.click()
    await window.waitForTimeout(500)
  }

  await window.screenshot({ path: path.join(SCREENSHOT_DIR, '01-empty-state.png') })

  // Import via renderer's exposed API
  console.log('Importing variant file...')
  const importResult = await window.evaluate(async (filePath) => {
    try {
      // api.import.start(filePath, caseName) is the correct method
      const result = await window.api.import.start(filePath, 'TestCase_001')
      return { success: true, result: JSON.stringify(result).slice(0, 500) }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }, VARIANT_FILE)
  console.log('Import result:', JSON.stringify(importResult))

  // Reload the page to pick up the imported data
  await window.reload()
  await window.waitForSelector('.v-application', { timeout: 15000 })
  await window.waitForTimeout(2000)

  // Dismiss disclaimer again after reload
  const dismissBtn2 = window.locator('text=I Understand — Continue')
  if ((await dismissBtn2.count()) > 0) {
    await dismissBtn2.click()
    await window.waitForTimeout(500)
  }

  await window.screenshot({ path: path.join(SCREENSHOT_DIR, '02-after-import.png') })

  // List sidebar cases
  const sidebarTexts = await window.locator('.v-navigation-drawer .v-list-item').allTextContents()
  console.log('Sidebar:', sidebarTexts.map((s) => s.trim()).filter(Boolean))

  // Click on first real case
  const caseItems = await window.locator('.v-navigation-drawer .v-list-item').all()
  for (const item of caseItems) {
    const text = await item.textContent()
    if (text && !text.includes('No cases') && text.trim().length > 2) {
      console.log(`Clicking case: "${text.trim().slice(0, 60)}"`)
      await item.click({ force: true })
      await window.waitForTimeout(3000)
      break
    }
  }

  await window.screenshot({ path: path.join(SCREENSHOT_DIR, '03-case-view-full.png') })

  // Check table
  const tableCount = await window.locator('.v-data-table-server, .v-data-table').count()
  console.log('Tables:', tableCount)

  if (tableCount > 0) {
    await window
      .locator('.v-data-table-server, .v-data-table')
      .first()
      .screenshot({ path: path.join(SCREENSHOT_DIR, '04-variant-table.png') })
  }

  // Capture filter bar area (top section above table)
  const mainContent = window.locator('main.v-main')
  if ((await mainContent.count()) > 0) {
    await mainContent.screenshot({ path: path.join(SCREENSHOT_DIR, '05-main-content.png') })
  }

  // Detailed filter info
  const filterInfo = await window.evaluate(() => {
    const info = { filterElements: [], chips: [], annotationIcons: {} }
    document.querySelectorAll('[class*="filter"]').forEach((el, i) => {
      if (i < 20) {
        const r = el.getBoundingClientRect()
        info.filterElements.push({
          classes: el.className?.toString().slice(0, 150),
          text: el.textContent?.slice(0, 80),
          rect: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height)
          },
          overflow: window.getComputedStyle(el).overflow,
          visible: r.width > 0 && r.height > 0
        })
      }
    })
    document.querySelectorAll('.v-chip').forEach((el, i) => {
      const r = el.getBoundingClientRect()
      info.chips.push({
        text: el.textContent?.trim().slice(0, 60),
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height)
        }
      })
    })
    info.annotationIcons = {
      starFilled: document.querySelectorAll('.mdi-star').length,
      starOutline: document.querySelectorAll('.mdi-star-outline').length,
      commentFilled: document.querySelectorAll('.mdi-comment-text').length,
      commentOutline: document.querySelectorAll('.mdi-comment-text-outline').length
    }
    return info
  })
  console.log('Filter elements:', JSON.stringify(filterInfo.filterElements.slice(0, 10), null, 2))
  console.log('Chips:', JSON.stringify(filterInfo.chips, null, 2))
  console.log('Annotation icons:', JSON.stringify(filterInfo.annotationIcons))

  // Screenshots at multiple viewport sizes
  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [1024, 768]
  ]) {
    await window.setViewportSize({ width: w, height: h })
    await window.waitForTimeout(300)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, `06-${w}x${h}.png`) })
  }

  // Try activating some filters to see how they look when active
  // Click on impact preset buttons (HIGH, MODERATE, etc.)
  const impactChips = await window.locator('.v-chip').allTextContents()
  console.log('All chips text:', impactChips.map((c) => c.trim()).filter(Boolean))

  // Click HIGH impact chip if found
  const highChip = window.locator('.v-chip:has-text("HIGH")').first()
  if ((await highChip.count()) > 0) {
    await highChip.click()
    await window.waitForTimeout(1000)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, '07-filter-high-active.png') })
    console.log('Screenshot: HIGH filter active')
  }

  // Click Frequency preset
  const freqChip = window.locator('.v-chip:has-text("1%")').first()
  if ((await freqChip.count()) > 0) {
    await freqChip.click()
    await window.waitForTimeout(1000)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, '08-filter-freq-active.png') })
    console.log('Screenshot: frequency filter active')
  }

  // Full page with active filters at different sizes
  for (const [w, h] of [
    [1920, 1080],
    [1280, 800],
    [1024, 768]
  ]) {
    await window.setViewportSize({ width: w, height: h })
    await window.waitForTimeout(300)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, `09-active-filters-${w}x${h}.png`) })
  }

  // Check what the filter toolbar structure looks like
  const toolbarStructure = await window.evaluate(() => {
    const toolbar =
      document.querySelector('.filter-toolbar') ||
      document.querySelector('[class*="filter-toolbar"]') ||
      document.querySelector('[class*="FilterToolbar"]')
    if (!toolbar) return 'No filter toolbar found in DOM'

    // Get computed styles of filter groups
    const groups = toolbar.querySelectorAll('[class*="filter-group"], [class*="group"]')
    const result = []
    groups.forEach((g, i) => {
      const style = window.getComputedStyle(g)
      const r = g.getBoundingClientRect()
      result.push({
        classes: g.className?.toString().slice(0, 100),
        display: style.display,
        flexShrink: style.flexShrink,
        flexBasis: style.flexBasis,
        minWidth: style.minWidth,
        overflow: style.overflow,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height)
        },
        isVisible: r.width > 0 && r.height > 0
      })
    })
    return result
  })
  console.log('Toolbar structure:', JSON.stringify(toolbarStructure, null, 2).slice(0, 3000))

  await app.close()
  console.log('Done!')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
