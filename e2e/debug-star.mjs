import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');

const app = await electron.launch({
  args: [path.join(projectDir, 'out/main/index.js')],
  cwd: projectDir,
  executablePath: path.join(projectDir, 'node_modules/.bin/electron'),
});

const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(3000);

// Dismiss disclaimer
try {
  const btn = win.locator('button', { hasText: 'I Understand' });
  if (await btn.isVisible({ timeout: 3000 })) await btn.click();
  await win.waitForTimeout(500);
} catch {}

// Click case
const caseItem = win.locator('.v-list-item').filter({ hasText: /variant/i }).first();
await caseItem.click();
await win.waitForTimeout(3000);

// Check initial count
let chips = await win.locator('.results-chip').allTextContents();
console.log('Before star filter:', chips);

// Click star
const starBtn = win.locator('.annotation-toggles button').first();
await starBtn.click();
await win.waitForTimeout(3000); // wait longer for debounce + query

chips = await win.locator('.results-chip').allTextContents();
console.log('After star filter (3s wait):', chips);

// Check the active filters bar
const activeBar = await win.locator('.applied-filters-bar').textContent();
console.log('Active filters bar:', activeBar?.trim());

// Check if case_variant_annotations table has any data
const annotationCount = await win.evaluate(async () => {
  try {
    // Try to check via the API
    const result = await (window as any).api.variants.query(1, { starred_only: true, case_id: 1 });
    return `Query result: total=${result?.total_count}, items=${result?.items?.length}`;
  } catch(e) {
    return `Error: ${e.message}`;
  }
});
console.log('Direct query with starred_only:', annotationCount);

await app.close();
