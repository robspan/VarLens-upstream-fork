/**
 * E2E test: Multi-variant-type filter, sort, and search smoke tests.
 *
 * Covers the new surface added by the 14-task multi-variant filter plan
 * (`.planning/plans/2026-04-10-multi-variant-filter-sort-search-plan.md`):
 *
 *   - `variants:typesPresent` IPC reports the distinct variant types in a
 *     case / cohort scope (Task 5 — replaces the old ad-hoc
 *     variant_type_counts path for the filter UI).
 *   - `variants:columnMeta` IPC returns per-column metadata for extension
 *     columns like `sv.sv_length` and `str.repeat_unit` (Task 5).
 *   - `variants:query` accepts `column_filters` with dotted extension keys
 *     (`sv.sv_type`, `str.repeat_unit`, ...) and narrows results via the
 *     shared `variant-where-builder` contract (Tasks 1 + 4).
 *   - FTS search expands across `variants_fts UNION variant_sv_fts UNION
 *     variant_str_fts` so a single search term can surface STR rows whose
 *     `repeat_unit` / `disease` tokens match (Task 9).
 *   - The renderer mounts `ExtensionColumnFilters` + `FilterTypeNarrowingChip`
 *     inside the case-view filter drawer once a case with extension rows is
 *     selected (Tasks 10/11/12).
 *
 * Most of the assertions go through the exposed `window.api` IPC surface
 * rather than brittle Vuetify selectors — this mirrors the established
 * pattern from `multi-variant-type.e2e.ts` and keeps the tests stable even
 * when the filter drawer DOM evolves. One UI smoke step verifies that the
 * shared `ExtensionColumnFilters` component actually mounts in the filter
 * drawer (via its stable `.extension-column-filters` class hook).
 *
 * Run with: xvfb-run --auto-servernum npx playwright test tests/e2e/multi-variant-filter.e2e.ts
 *
 * Requires: `electron-vite build` to have produced `out/main/index.js`, and
 * the `better-sqlite3-multiple-ciphers` native module rebuilt for Electron
 * (`make rebuild`).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'path'

const VCF_DIR = resolve(__dirname, '../test-data/vcf')
const CASE_PREFIX = 'E2EMultiFilter'

let app: ElectronApplication
let window: Page

interface VariantsApi {
  query: (
    caseId: number,
    filters: Record<string, unknown>,
    offset: number,
    limit: number
  ) => Promise<{ data: Array<Record<string, unknown>>; total_count: number }>
  typesPresent: (payload: {
    caseId?: number
    caseIds?: number[]
  }) => Promise<string[]>
  columnMeta: (payload: {
    caseId?: number
    caseIds?: number[]
    columnKey: string
  }) => Promise<{ dataType: string; distinctCount: number } & Record<string, unknown>>
}

interface WindowApi {
  api: {
    cases: {
      list: () => Promise<Array<{ id: number; name: string }>>
      delete: (id: number) => Promise<void>
    }
    import: {
      start: (
        filePath: string,
        caseName: string
      ) => Promise<{ caseId: number; variantCount: number }>
    }
    variants: VariantsApi
  }
}

async function cleanupTestCases(): Promise<void> {
  await window.evaluate(async (prefix: string) => {
    const w = window as unknown as WindowApi
    const cases = await w.api.cases.list()
    for (const c of cases) {
      if (c.name.startsWith(prefix)) await w.api.cases.delete(c.id)
    }
  }, CASE_PREFIX)
}

async function importVcf(filePath: string, caseName: string): Promise<number> {
  return await window.evaluate(
    async ([path, name]: [string, string]) => {
      const w = window as unknown as WindowApi
      const result = await w.api.import.start(path, name)
      return result.caseId
    },
    [filePath, caseName] as [string, string]
  )
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  window = await app.firstWindow()
  await window.waitForSelector('.v-application', { timeout: 15000 })

  const disclaimerBtn = window.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(500)
  }

  await cleanupTestCases()
})

test.afterAll(async () => {
  if (app) {
    try {
      await cleanupTestCases()
    } catch {
      // Ignore cleanup failures during teardown — the test process is
      // about to exit anyway.
    }
    await app.close()
  }
})

test('import SV + STR VCFs so later filter/search steps have data', async () => {
  const svCaseId = await importVcf(resolve(VCF_DIR, 'synthetic-sv.vcf'), `${CASE_PREFIX}_SV`)
  const strCaseId = await importVcf(resolve(VCF_DIR, 'synthetic-str.vcf'), `${CASE_PREFIX}_STR`)

  expect(svCaseId).toBeGreaterThan(0)
  expect(strCaseId).toBeGreaterThan(0)

  // Stash IDs for later tests via window globals so we don't re-import.
  await window.evaluate(
    ([sv, str]: [number, number]) => {
      ;(window as unknown as { __svCaseId: number; __strCaseId: number }).__svCaseId = sv
      ;(window as unknown as { __svCaseId: number; __strCaseId: number }).__strCaseId = str
    },
    [svCaseId, strCaseId] as [number, number]
  )
})

test('variants:typesPresent returns the case-scoped variant type set', async () => {
  const strCaseId = await window.evaluate(
    () => (window as unknown as { __strCaseId: number }).__strCaseId
  )

  const types = await window.evaluate(async (id: number) => {
    const w = window as unknown as WindowApi
    return await w.api.variants.typesPresent({ caseId: id })
  }, strCaseId)

  // STR fixture should register the `str` extension type. The backend is
  // free to also report `snv`/`indel` for any base rows, so we only assert
  // that `str` is present — that's the new Task 5 contract the filter
  // drawer depends on for auto-hiding inactive accordions.
  expect(Array.isArray(types)).toBe(true)
  expect(types).toContain('str')
})

test('variants:columnMeta returns metadata for an STR extension column', async () => {
  const strCaseId = await window.evaluate(
    () => (window as unknown as { __strCaseId: number }).__strCaseId
  )

  // `str.repeat_unit` is a text column — the handler should report
  // `text` affinity and a non-zero distinct count (two rows in the
  // fixture: CTG and GCGGGGC).
  const meta = await window.evaluate(async (id: number) => {
    const w = window as unknown as WindowApi
    return await w.api.variants.columnMeta({
      caseId: id,
      columnKey: 'str.repeat_unit'
    })
  }, strCaseId)

  expect(meta).toBeTruthy()
  expect(meta.dataType).toBe('text')
  expect(typeof meta.distinctCount).toBe('number')
  expect(meta.distinctCount).toBeGreaterThanOrEqual(1)
})

test('variants:query accepts a column_filters extension filter (Path 1)', async () => {
  const strCaseId = await window.evaluate(
    () => (window as unknown as { __strCaseId: number }).__strCaseId
  )

  // Filter for STR rows with repeat_unit=CTG. The fixture has exactly
  // one such row (ATXN3 / MJD). A broken extension filter pipeline
  // would either throw (unknown column) or drop the narrowing and
  // return the full STR set.
  const filtered = await window.evaluate(async (id: number) => {
    const w = window as unknown as WindowApi
    return await w.api.variants.query(
      id,
      {
        column_filters: {
          'str.repeat_unit': { operator: '=', value: 'CTG' }
        }
      },
      0,
      100
    )
  }, strCaseId)

  expect(filtered.total_count).toBeGreaterThanOrEqual(1)
  for (const row of filtered.data) {
    const ru = row._str_repeat_unit as string | undefined
    // Only STR rows should come back. Non-STR rows without the field
    // should not be included — the where-builder AND-chain guarantees
    // this via the EXISTS subquery.
    expect(row.variant_type).toBe('str')
    if (ru !== undefined && ru !== null) {
      expect(ru).toBe('CTG')
    }
  }
})

test('variants:query search expands via UNION across variant_str_fts (Task 9)', async () => {
  const strCaseId = await window.evaluate(
    () => (window as unknown as { __strCaseId: number }).__strCaseId
  )

  // `MJD` is only present in the STR disease column — it cannot match
  // via the primary `variants_fts` index. If the search-clause emitter
  // is correctly emitting a UNION subquery across every present FTS
  // table, this query should surface the ATXN3 STR row. If the UNION
  // was dropped (regression to Path-1-only search), this returns 0.
  const result = await window.evaluate(async (id: number) => {
    const w = window as unknown as WindowApi
    return await w.api.variants.query(id, { search_term: 'MJD' }, 0, 100)
  }, strCaseId)

  expect(result.total_count).toBeGreaterThanOrEqual(1)
  const strHits = result.data.filter((v) => v.variant_type === 'str')
  expect(strHits.length).toBeGreaterThanOrEqual(1)
})

test('filter drawer mounts ExtensionColumnFilters when an STR case is selected', async () => {
  // Navigate to the Case view and pick the STR fixture case. We use the
  // sidebar search input the same way multi-variant-type.e2e.ts does to
  // avoid scrolling through the list.
  const caseNavBtn = window.locator('button:has(.v-btn__content:has-text("Case"))').first()
  if ((await caseNavBtn.count()) > 0) {
    await caseNavBtn.click()
    await window.waitForTimeout(300)
  }

  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.click()
    await searchInput.fill(`${CASE_PREFIX}_STR`)
    await window.waitForTimeout(800)
  }

  const caseItem = window
    .locator('.v-list-item')
    .filter({ hasText: `${CASE_PREFIX}_STR` })
    .first()
  if ((await caseItem.count()) > 0) {
    await caseItem.click()
    await window.waitForTimeout(1500)
  }

  // Wait for the filter toolbar to render (indicates the case loaded).
  await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })

  // Click the "Filters" button in SlimFilterToolbar to open the drawer.
  const filtersBtn = window.locator('button:has-text("Filters")').first()
  await filtersBtn.click()
  await window.waitForTimeout(500)

  // The drawer wraps ExtensionColumnFilters, which renders
  // `<div class="extension-column-filters">` unconditionally — the
  // stable hook we rely on. Either the STR accordion renders (Task 10
  // integration) or the "no structural variants" fallback shows. Both
  // prove the component is mounted in the drawer.
  const extContainer = window.locator('.extension-column-filters')
  await expect(extContainer.first()).toBeVisible({ timeout: 10000 })
})

test('cleanup: delete test cases created during this run', async () => {
  await cleanupTestCases()
})
