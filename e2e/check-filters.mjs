import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(__dirname, '..')

console.log('Launching Electron from built app...')
const app = await electron.launch({
  args: [path.join(projectDir, 'out/main/index.js')],
  cwd: projectDir,
  executablePath: path.join(projectDir, 'node_modules/.bin/electron')
})

const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(3000)

// Dismiss disclaimer
try {
  const btn = win.locator('button', { hasText: 'I Understand' })
  if (await btn.isVisible({ timeout: 3000 })) {
    await btn.click()
    console.log('Dismissed disclaimer')
  }
  await win.waitForTimeout(500)
} catch (e) {
  console.log('No disclaimer or already dismissed')
}

await win.screenshot({ path: path.join(projectDir, 'e2e/screenshots/fix-01-initial.png') })
console.log('Screenshot 01 saved')

// Find and click first case
const listItems = win.locator('.v-list-item')
const count = await listItems.count()
console.log(`Found ${count} list items`)

for (let i = 0; i < Math.min(count, 8); i++) {
  const text = await listItems.nth(i).textContent()
  console.log(`  [${i}]: ${text?.trim().substring(0, 80)}`)
}

// Click the first real case item (skip header items)
try {
  const caseItem = win
    .locator('.v-list-item')
    .filter({ hasText: /variant/i })
    .first()
  if (await caseItem.isVisible({ timeout: 2000 })) {
    await caseItem.click()
    await win.waitForTimeout(3000)
    console.log('Clicked case item')
  }
} catch (e) {
  console.log('No case found, trying first item:', e.message)
  try {
    await listItems.first().click()
    await win.waitForTimeout(3000)
  } catch {}
}

// Screenshot case view at multiple resolutions
for (const [w, h] of [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [1024, 768]
]) {
  await win.setViewportSize({ width: w, height: h })
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(projectDir, `e2e/screenshots/fix-02-${w}x${h}.png`) })
  console.log(`Screenshot ${w}x${h} saved`)
}

// Try the star filter button
try {
  const starBtn = win.locator('.annotation-toggles button').first()
  if (await starBtn.isVisible({ timeout: 2000 })) {
    console.log('Found star toggle button in annotation-toggles')
    await starBtn.click()
    await win.waitForTimeout(2000)
    await win.screenshot({ path: path.join(projectDir, 'e2e/screenshots/fix-03-after-star.png') })
    console.log('Screenshot after star filter saved')

    const chips = await win.locator('.results-chip').allTextContents()
    console.log('Result chips:', chips)

    await starBtn.click()
    await win.waitForTimeout(1000)
  } else {
    console.log('Star toggle button NOT visible')
  }
} catch (e) {
  console.log('Star filter error:', e.message)
}

// Check toolbar at 1024
await win.setViewportSize({ width: 1024, height: 768 })
await win.waitForTimeout(500)

try {
  const toolbar = win.locator('.filter-toolbar-container')
  if (await toolbar.isVisible({ timeout: 2000 })) {
    await toolbar.screenshot({
      path: path.join(projectDir, 'e2e/screenshots/fix-04-toolbar-1024.png')
    })
    console.log('Toolbar screenshot at 1024 saved')
  }

  await win.setViewportSize({ width: 1920, height: 1080 })
  await win.waitForTimeout(500)
  await toolbar.screenshot({
    path: path.join(projectDir, 'e2e/screenshots/fix-04-toolbar-1920.png')
  })
  console.log('Toolbar screenshot at 1920 saved')
} catch (e) {
  console.log('Toolbar screenshot error:', e.message)
}

// Results section layout info
try {
  const resultsSection = win.locator('.results-section')
  if (await resultsSection.isVisible({ timeout: 2000 })) {
    const box = await resultsSection.boundingBox()
    console.log('Results section box:', JSON.stringify(box))
  }
} catch (e) {
  console.log('Results section error:', e.message)
}

console.log('All done!')
await app.close()
