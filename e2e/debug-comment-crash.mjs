import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

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
  const cohortTab = window.locator('text=Cohort')
  if ((await cohortTab.count()) > 0) {
    await cohortTab.first().click()
    await window.waitForTimeout(1000)
  }

  // Listen for console errors
  window.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text())
    }
  })

  window.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message)
  })

  // Try clicking comment toggle
  console.log('Clicking comment filter...')
  const commentBtn = window.locator('button:has(.mdi-comment-text-outline)').first()
  if ((await commentBtn.count()) > 0) {
    await commentBtn.click()
    await window.waitForTimeout(3000)

    const resultsText = await window.evaluate(() => {
      const chip = document.querySelector('.results-chip')
      return chip ? chip.textContent.trim() : 'not found'
    })
    console.log('Results:', resultsText)
  } else {
    console.log('Comment button not found')
  }

  // Check if app is still alive
  try {
    const title = await window.title()
    console.log('App still alive, title:', title)
  } catch (e) {
    console.log('App crashed:', e.message)
  }

  // Also test via IPC directly
  console.log('Testing IPC directly...')
  const ipcResult = await window.evaluate(async () => {
    try {
      const result = await window.api.cohort.getVariants({
        has_comment: true,
        limit: 10,
        offset: 0,
        sort_order: 'desc'
      })
      return { success: true, count: result.total_count }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  console.log('IPC result:', JSON.stringify(ipcResult))

  await app.close()
  console.log('Done')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
