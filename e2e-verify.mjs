/**
 * E2E verification script for gene panel filter fixes.
 *
 * Launches the Electron app, accepts the disclaimer, opens the DemoCase,
 * opens the filter drawer, expands the Gene Panels section, and checks
 * if the panel dropdown has items.
 *
 * Usage: npx playwright test e2e-verify.mjs  (or just: node e2e-verify.mjs)
 * Requires: npm run rebuild:electron && npx electron-vite build
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, 'e2e-screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function screenshot(page, name) {
  const filePath = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`  Screenshot saved: ${filePath}`);
  return filePath;
}

async function main() {
  console.log('=== E2E Verification: Gene Panel Filter Fixes ===\n');

  // 1. Launch app
  console.log('1. Launching Electron app...');
  const app = await electron.launch({
    args: [path.join(__dirname, 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  const page = await app.firstWindow();
  console.log('   App launched, waiting for Vuetify...');
  await page.waitForSelector('.v-application', { timeout: 15000 });
  await screenshot(page, '01-app-loaded');

  // 2. Accept disclaimer if visible
  console.log('2. Checking for disclaimer dialog...');
  try {
    const disclaimerBtn = page.locator('button:has-text("I Understand")');
    if (await disclaimerBtn.isVisible({ timeout: 3000 })) {
      await disclaimerBtn.click();
      console.log('   Disclaimer accepted.');
      await page.waitForTimeout(500);
    }
  } catch {
    console.log('   No disclaimer dialog found, continuing.');
  }
  await screenshot(page, '02-after-disclaimer');

  // 3. Open DemoCase
  console.log('3. Looking for DemoCase...');
  try {
    // The case list should be visible; look for DemoCase or any case row
    const demoCase = page.locator('text=DemoCase').first();
    if (await demoCase.isVisible({ timeout: 5000 })) {
      await demoCase.click();
      console.log('   DemoCase clicked.');
    } else {
      // Try clicking the first case in the table
      const firstRow = page.locator('table tbody tr').first();
      if (await firstRow.isVisible({ timeout: 3000 })) {
        await firstRow.click();
        console.log('   Clicked first available case.');
      } else {
        console.log('   WARNING: No cases found in the list.');
      }
    }
  } catch (e) {
    console.log(`   Could not find DemoCase: ${e.message}`);
  }
  await page.waitForTimeout(2000);
  await screenshot(page, '03-case-opened');

  // 4. Open filter drawer
  console.log('4. Opening filter drawer...');
  try {
    // Look for the filter button in the toolbar
    const filterBtn = page.locator('[aria-label="Filter"]').or(
      page.locator('button:has-text("Filter")')
    ).or(
      page.locator('.mdi-filter').or(page.locator('[data-testid="filter-btn"]'))
    ).first();

    if (await filterBtn.isVisible({ timeout: 5000 })) {
      await filterBtn.click();
      console.log('   Filter button clicked.');
    } else {
      // Try finding filter icon button
      const icons = page.locator('button .v-icon');
      const count = await icons.count();
      console.log(`   Found ${count} icon buttons, looking for filter...`);
      // Fallback: look for navigation drawer toggle
      const navBtn = page.locator('.v-btn').filter({ hasText: /filter/i }).first();
      if (await navBtn.isVisible({ timeout: 2000 })) {
        await navBtn.click();
        console.log('   Filter nav button clicked.');
      }
    }
  } catch (e) {
    console.log(`   Could not open filter drawer: ${e.message}`);
  }
  await page.waitForTimeout(1000);
  await screenshot(page, '04-filter-drawer');

  // 5. Expand Gene Panels section
  console.log('5. Looking for Gene Panels expansion panel...');
  try {
    const panelSection = page.locator('text=Gene Panels').first();
    if (await panelSection.isVisible({ timeout: 5000 })) {
      await panelSection.click();
      console.log('   Gene Panels section clicked.');
      await page.waitForTimeout(1500); // Wait for panels to load
    } else {
      console.log('   WARNING: Gene Panels section not found.');
    }
  } catch (e) {
    console.log(`   Could not expand Gene Panels: ${e.message}`);
  }
  await screenshot(page, '05-gene-panels-expanded');

  // 6. Check if the dropdown has items
  console.log('6. Checking panel dropdown for items...');
  try {
    // Find the "Add panel..." select/dropdown
    const selectField = page.locator('.v-select').filter({ hasText: /Add panel|panel/i }).first()
      .or(page.locator('[placeholder="Add panel..."]').first());

    if (await selectField.isVisible({ timeout: 3000 })) {
      // Click to open the dropdown (force: true to bypass Vuetify overlay interception)
      await selectField.click({ force: true });
      await page.waitForTimeout(1500);
      await screenshot(page, '06-dropdown-opened');

      // Check for list items in the dropdown menu
      const menuItems = page.locator('.v-list-item');
      const itemCount = await menuItems.count();

      if (itemCount > 0) {
        console.log(`   SUCCESS: Panel dropdown has ${itemCount} items.`);
        // Get first few panel names
        for (let i = 0; i < Math.min(3, itemCount); i++) {
          const text = await menuItems.nth(i).textContent();
          console.log(`     - ${text?.trim()}`);
        }
      } else {
        console.log('   ISSUE: Panel dropdown appears empty (0 items).');
        console.log('   This may be expected if no panels are imported in the test DB.');
      }
    } else {
      console.log('   WARNING: Could not find the panel dropdown.');
    }
  } catch (e) {
    console.log(`   Error checking dropdown: ${e.message}`);
  }
  await screenshot(page, '07-final-state');

  // 7. Close app
  console.log('\n7. Closing app...');
  await app.close();
  console.log('   App closed.');

  console.log('\n=== E2E Verification Complete ===');
  console.log(`Screenshots saved to: ${screenshotsDir}`);
}

main().catch((err) => {
  console.error('E2E verification failed:', err);
  process.exit(1);
});
