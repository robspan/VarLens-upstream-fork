import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SCREENSHOT_DIR = path.join(ROOT, 'e2e/screenshots')

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

  // Navigate to cohort view
  console.log('Navigating to cohort view...')
  const cohortTab = window.locator('text=Cohort')
  if ((await cohortTab.count()) > 0) {
    await cohortTab.first().click()
    await window.waitForTimeout(1000)
  }

  // Screenshot 1: toolbar before any interaction
  await window.screenshot({
    path: path.join(SCREENSHOT_DIR, 'cohort-toolbar-clean.png'),
    clip: { x: 0, y: 0, width: 1920, height: 120 }
  })
  console.log('Screenshot 1: toolbar')

  // Test star toggle - click the star icon button in the toolbar
  console.log('Testing star toggle...')
  const starBtn = window.locator('button:has(.mdi-star-outline)').first()
  if ((await starBtn.count()) > 0) {
    await starBtn.click()
    await window.waitForTimeout(1500) // wait for filter + data fetch

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, 'cohort-starred-active.png'),
      clip: { x: 0, y: 0, width: 1920, height: 120 }
    })

    // Check count
    const resultsText = await window.evaluate(() => {
      const chip = document.querySelector('.results-chip')
      return chip ? chip.textContent.trim() : 'not found'
    })
    console.log('Results after star filter:', resultsText)

    // Untoggle star
    const starBtnActive = window.locator('button:has(.mdi-star)').first()
    await starBtnActive.click()
    await window.waitForTimeout(1000)
  } else {
    console.log('Star button not found')
  }

  // Test comment toggle
  console.log('Testing comment toggle...')
  const commentBtn = window.locator('button:has(.mdi-comment-text-outline)').first()
  if ((await commentBtn.count()) > 0) {
    await commentBtn.click()
    await window.waitForTimeout(1500)

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, 'cohort-commented-active.png'),
      clip: { x: 0, y: 0, width: 1920, height: 120 }
    })

    const resultsText = await window.evaluate(() => {
      const chip = document.querySelector('.results-chip')
      return chip ? chip.textContent.trim() : 'not found'
    })
    console.log('Results after comment filter:', resultsText)

    // Untoggle
    const commentBtnActive = window.locator('button:has(.mdi-comment-text)').first()
    await commentBtnActive.click()
    await window.waitForTimeout(1000)
  }

  // Test ACMG chip selection (click 'P' for Pathogenic)
  console.log('Testing ACMG chip...')
  const pChip = window.locator('.v-chip:has-text("P")').first()
  if ((await pChip.count()) > 0) {
    await pChip.click()
    await window.waitForTimeout(1500)

    await window.screenshot({
      path: path.join(SCREENSHOT_DIR, 'cohort-acmg-pathogenic.png'),
      clip: { x: 0, y: 0, width: 1920, height: 120 }
    })

    const resultsText = await window.evaluate(() => {
      const chip = document.querySelector('.results-chip')
      return chip ? chip.textContent.trim() : 'not found'
    })
    console.log('Results after ACMG P filter:', resultsText)
  }

  // Open filter drawer for final screenshot
  const filtersBtn = window.locator('text=FILTERS')
  if ((await filtersBtn.count()) > 0) {
    await filtersBtn.first().click()
    await window.waitForTimeout(500)
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'cohort-drawer-final.png') })
  }

  await app.close()
  console.log('Done! All screenshots saved.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
