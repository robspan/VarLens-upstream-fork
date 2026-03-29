# Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI blocking from synchronous database queries, optimize the worst query bottlenecks, and improve renderer reactivity performance.

**Architecture:** Piscina worker pool for all database reads, consolidated SQL queries for filter options, shallowRef for large data arrays, LRU-bounded annotation cache. Writes stay on main thread. Existing `WindowAPI` interface unchanged.

**Tech Stack:** Piscina, better-sqlite3-multiple-ciphers, Vue 3 (shallowRef/toRaw), Kysely, Vitest

**Spec:** `.planning/specs/2026-03-25-performance-optimization-design.md`

---

## Parallelization Map

Tasks within the same wave touch **different files** and can run as parallel subagents in isolated git worktrees. Waves must complete before the next wave starts.

```
Phase 1 - Wave 1A (4 parallel tasks):
  Task 1: getFilterOptions consolidation  [VariantRepository.ts, schema.ts]
  Task 3: shallowRef at source            [useOffsetPagination.ts]
  Task 4: IPC serialization + watcher + columnMeta shallowRef  [useVariantData.ts]
  Task 5: Annotation cache LRU           [useAnnotations.ts]

Phase 1 - Wave 1B (after Task 1 merges):
  Task 2: FTS5 rebuild fix                [VariantRepository.ts]

  NOTE: Tasks 1 & 2 both touch VariantRepository.ts — sequential.
  Task 3 shallowRef for columnMeta moved INTO Task 4 (same file).
  Plotly cleanup (spec 4.4) already implemented — verified in codebase.

Phase 2 - Wave 2 (3 parallel tasks):
  Task 6: Fix rollup inputs              [electron.vite.config.ts]
  Task 7: Deferred startup rebuild       [DatabaseService.ts, CohortSummaryService.ts]
  Task 8: Rebuild UI indicator           [renderer - new component]

Phase 3 - Wave 3 (sequential foundation):
  Task 9:  Install Piscina + createRepositories factory  [new file + DatabaseService.ts]
  Task 10: db-worker + DbPool                           [new files, electron.vite.config.ts]

Phase 3 - Wave 4 (3 parallel handler migrations):
  Task 11: Migrate variant handlers      [handlers/variants.ts]
  Task 12: Migrate cohort read handlers  [handlers/cohort.ts]
  Task 13: Migrate remaining read handlers [handlers/cases.ts, annotations.ts, case-metadata.ts, ...]

Phase 4 - Wave 5:
  Task 14: Pagination count caching      [useVariantData.ts]
  Task 15: Wire up statistics WorkerPool [AssociationEngine.ts, handlers/cohort.ts]
```

---

## Phase 1: Quick Wins

### Task 1: Consolidate `getFilterOptions()` from ~55 queries to ~5

**Files:**
- Modify: `src/main/database/VariantRepository.ts:586-701` (getColumnMeta + getFilterOptions)
- Modify: `src/main/database/schema.ts:68-77` (add covering index)
- Modify: `tests/main/database/variants.test.ts` (add/update filter options tests)

- [ ] **Step 1: Write test for consolidated filter options**

Add a test in `tests/main/database/variants.test.ts` that verifies `getFilterOptions()` returns correct structure with consequences, funcs, clinvars, numeric ranges, and column metadata for a case with known test data.

```typescript
describe('getFilterOptions - consolidated', () => {
  it('returns all filter metadata in consolidated response', () => {
    // Insert test variants with known values
    // Call getFilterOptions(caseId)
    // Assert: consequences array contains expected values
    // Assert: funcs array contains expected values
    // Assert: clinvars array contains expected values
    // Assert: cadd range has correct min/max
    // Assert: gnomad_af range has correct min/max
    // Assert: columnMeta has entries for all SORTABLE_COLUMNS
    // Assert: each columnMeta entry has distinctCount, and values if count <= 50
  })
})
```

- [ ] **Step 2: Run test to verify it fails or establishes baseline**

Run: `npm run rebuild:node && npx vitest run tests/main/database/variants.test.ts -t "consolidated"`
Expected: Test runs against current implementation (establishes baseline output shape)

- [ ] **Step 3: Add covering index to schema**

In `src/main/database/schema.ts`, add after line 77:

```sql
CREATE INDEX IF NOT EXISTS idx_variants_case_numeric ON variants(case_id, cadd, gnomad_af);
```

- [ ] **Step 4: Rewrite `getColumnMeta()` to use single aggregate query**

In `src/main/database/VariantRepository.ts`, replace the `getColumnMeta()` method (lines 586-642) with a consolidated approach:

1. **Query 1 — Single aggregate scan:** Build one SQL query that computes `COUNT(DISTINCT col)` for all 16 sortable columns AND `MIN(col), MAX(col)` for the 5 numeric columns, all in a single `SELECT ... FROM variants WHERE case_id = ?`.

2. **Query 2 — Distinct values for low-cardinality columns:** For each column where Query 1 showed count <= 50 (`DISTINCT_THRESHOLD`), collect them all into one UNION ALL query:
   ```sql
   SELECT 'consequence' as col, consequence as val FROM variants WHERE case_id = ? GROUP BY consequence
   UNION ALL
   SELECT 'func' as col, func as val FROM variants WHERE case_id = ? GROUP BY func
   -- ... only columns with count <= 50
   ```
   Parse the result by grouping on the `col` discriminator.

3. Build and return the `ColumnFilterMeta[]` array from the two result sets.

- [ ] **Step 5: Rewrite `getFilterOptions()` to use new `getColumnMeta()`**

Replace the 5 top-level queries (lines 644-689) with a call to the consolidated `getColumnMeta()`, which now returns all the data. The consequences/funcs/clinvars/ranges are just specific columns in the column metadata. Map them into the `FilterOptions` return shape.

- [ ] **Step 6: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/database/variants.test.ts -v`
Expected: All existing + new tests pass. Filter options return same data structure.

- [ ] **Step 7: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/database/schema.ts tests/main/database/variants.test.ts
git commit -m "perf: consolidate getFilterOptions from ~55 queries to ~5

Single aggregate scan for all COUNT DISTINCT + MIN/MAX, then one
UNION ALL query for distinct values of low-cardinality columns.
Adds idx_variants_case_numeric covering index."
```

---

### Task 2: Fix FTS5 rebuild-per-batch (run AFTER Task 1 merges)

**Files:**
- Modify: `src/main/database/VariantRepository.ts:49-148` (insertVariantsBatch)
- Modify: `tests/main/database/variants.test.ts` (add bulk insert lifecycle test)

- [ ] **Step 1: Write test for bulk insert lifecycle**

```typescript
describe('bulk insert lifecycle', () => {
  it('beginBulkInsert/insertBatch/finishBulkInsert rebuilds FTS once', () => {
    // Insert variants using lifecycle methods
    // Verify FTS search works after finishBulkInsert
    // Verify triggers exist after finishBulkInsert
  })

  it('insertVariantsBatch still works for single-batch calls', () => {
    // Backward compat: single call still drops/rebuilds
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rebuild:node && npx vitest run tests/main/database/variants.test.ts -t "bulk insert lifecycle"`
Expected: FAIL — `beginBulkInsert` not defined

- [ ] **Step 3: Extract lifecycle methods from `insertVariantsBatch()`**

In `src/main/database/VariantRepository.ts`:

1. Create `beginBulkInsert()` — extracts lines 55-60 (drop FTS triggers)
2. Create `insertBatch(variants)` — extracts lines 63-115 (insert data in transaction, no FTS logic)
3. Create `finishBulkInsert()` — extracts lines 119-145 (rebuild FTS, recreate triggers, ANALYZE, optimize)
4. Refactor `insertVariantsBatch()` to call all three in sequence (backward compat)

- [ ] **Step 4: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/database/variants.test.ts -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/VariantRepository.ts tests/main/database/variants.test.ts
git commit -m "perf: split insertVariantsBatch into begin/insert/finish lifecycle

Allows callers to drop FTS triggers once, insert N batches, then
rebuild FTS once at the end instead of per-batch."
```

---

### Task 3: `shallowRef` for pagination items (parallel with Tasks 1, 4, 5)

**Files:**
- Modify: `src/renderer/src/composables/useOffsetPagination.ts:60` (items ref)
- Modify: `tests/renderer/composables/` (add/update pagination tests if they exist)

**Note:** `columnMeta` shallowRef change is in Task 4 (same file — `useVariantData.ts`).

- [ ] **Step 1: Check for existing pagination tests**

Run: `find tests/renderer -name '*pagination*' -o -name '*Pagination*'`

- [ ] **Step 2: Write test verifying shallowRef behavior**

If tests exist, add a test. If not, create `tests/renderer/composables/useOffsetPagination.test.ts`:

```typescript
import { useOffsetPagination } from '@renderer/composables/useOffsetPagination'
import { isReactive } from 'vue'

it('items array is not deeply reactive', async () => {
  const { items } = useOffsetPagination({
    fetchPage: async () => ({ items: [{ id: 1, name: 'test' }], totalCount: 1 })
  })
  // After loading, items should NOT be deeply reactive
  // (shallowRef means items.value is not proxied)
  await nextTick()
  expect(isReactive(items.value)).toBe(false)
  expect(isReactive(items.value[0])).toBe(false)
})
```

- [ ] **Step 3: Run test to verify current behavior (should show deep reactivity)**

Run: `npx vitest run tests/renderer/composables/useOffsetPagination.test.ts -v`

- [ ] **Step 4: Change `ref` to `shallowRef` in useOffsetPagination.ts**

In `src/renderer/src/composables/useOffsetPagination.ts` line 60, change:
```typescript
// Before
const items = ref<T[]>([]) as Ref<T[]>

// After
import { shallowRef } from 'vue'
const items = shallowRef<T[]>([]) as Ref<T[]>
```

- [ ] **Step 5: Run test to verify shallowRef behavior**

Run: `npx vitest run tests/renderer/composables/useOffsetPagination.test.ts -v`
Expected: PASS — items not deeply reactive

- [ ] **Step 6: Run full renderer test suite**

Run: `npx vitest run tests/renderer/ -v`
Expected: All tests pass. ShallowRef is a drop-in since items are replaced wholesale.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/composables/useOffsetPagination.ts
git commit -m "perf: use shallowRef for pagination items array

Prevents Vue from creating deep reactive proxies for every property
of every variant object on each page load."
```

---

### Task 4: Consolidate IPC serialization + deep watcher + columnMeta shallowRef (parallel with Tasks 1, 3, 5)

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts:52-61,82,126-130`

- [ ] **Step 1: Change `columnMeta` to `shallowRef`**

In `src/renderer/src/components/variant-table/useVariantData.ts` line 82, change:
```typescript
// Before
const columnMeta = ref<ColumnFilterMeta[]>([])

// After
import { shallowRef } from 'vue'
const columnMeta = shallowRef<ColumnFilterMeta[]>([])
```

- [ ] **Step 2: Consolidate serialization to single call**

In `src/renderer/src/components/variant-table/useVariantData.ts`, replace lines 52-61 with a single serialization pass:

```typescript
// Build plain filters with column_filters merged in one step
const colFilters = getColumnFiltersParam()
const rawFilters = filters.value
const plainFilters = JSON.parse(JSON.stringify({
  ...rawFilters,
  ...(colFilters !== undefined || rawFilters.column_filters !== undefined
    ? {
        column_filters: {
          ...(colFilters ?? {}),
          ...(rawFilters.column_filters ?? {})
        }
      }
    : {})
}))
```

This does one `JSON.parse(JSON.stringify())` instead of 2-3.

- [ ] **Step 3: Replace deep watcher with serialized filter key**

Replace the deep watcher at line 126:

```typescript
// Before
watch(filters, invalidateAndReload, { deep: true })

// After
import { toRaw } from 'vue'
const filterKey = computed(() => JSON.stringify(toRaw(filters.value)))
watch(filterKey, invalidateAndReload)
```

- [ ] **Step 4: Run renderer tests**

Run: `npx vitest run tests/renderer/ -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/variant-table/useVariantData.ts
git commit -m "perf: shallowRef columnMeta, consolidate IPC serialization, optimize watcher

columnMeta uses shallowRef (replaced wholesale, never mutated).
Single JSON serialization pass instead of 2-3 per page load.
Replace deep filter watcher with serialized key comparison."
```

---

### Task 5: Annotation cache LRU eviction (parallel with Tasks 1, 3, 4)

**Files:**
- Modify: `src/renderer/src/composables/useAnnotations.ts:23,109-116,154-157`
- Create: `tests/renderer/composables/useAnnotations.test.ts` (if not exists)

- [ ] **Step 1: Write test for LRU eviction**

```typescript
describe('annotation cache LRU eviction', () => {
  it('evicts oldest entries when cache exceeds MAX_CACHE_SIZE', () => {
    const { loadAnnotation, getAnnotations, clearCache } = useAnnotations()
    clearCache()
    // Load MAX_CACHE_SIZE + 10 entries
    // Verify oldest entries are evicted
    // Verify newest entries are present
  })

  it('re-accessing an entry moves it to end (prevents eviction)', () => {
    // Load entries, access an old one, add more
    // Verify the accessed entry survives eviction
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/composables/useAnnotations.test.ts -t "LRU"`
Expected: FAIL — no eviction behavior

- [ ] **Step 3: Add LRU eviction to annotation cache**

In `src/renderer/src/composables/useAnnotations.ts`:

Add constant near top:
```typescript
const MAX_CACHE_SIZE = 5000
```

Create helper function:
```typescript
function cacheSet(key: string, value: AnnotationCache): void {
  const cache = annotationCache.value
  // Move to end if exists (LRU touch)
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  // Evict oldest entries if over limit
  if (cache.size > MAX_CACHE_SIZE) {
    const keysToDelete = [...cache.keys()].slice(0, cache.size - MAX_CACHE_SIZE)
    for (const k of keysToDelete) {
      cache.delete(k)
    }
  }
}
```

Replace ALL `annotationCache.value.set(key, ...)` calls with `cacheSet(key, ...)`. Search for `.set(` in the file to find every call site — there are ~10 occurrences throughout the file (lines 116, 154, 201, 246, 288, 342, 388, 456, 524, 568 approximately). Use find-and-replace to ensure none are missed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/composables/useAnnotations.test.ts -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useAnnotations.ts tests/renderer/composables/useAnnotations.test.ts
git commit -m "perf: add LRU eviction to annotation cache (max 5000 entries)

Prevents unbounded memory growth when browsing many variants.
Uses Map insertion order for simple LRU without external deps."
```

---

## Phase 2: Startup & Rebuild Optimization

### Task 6: Fix rollup inputs for all workers (parallel with Tasks 7, 8)

**Files:**
- Modify: `electron.vite.config.ts:13-18`

- [ ] **Step 1: Add missing worker entries**

In `electron.vite.config.ts`, replace the `input` block (lines 13-18) with:

```typescript
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts'),
  'import-worker': resolve(__dirname, 'src/main/workers/import-worker.ts'),
  'delete-worker': resolve(__dirname, 'src/main/workers/delete-worker.ts'),
  'export-worker': resolve(__dirname, 'src/main/workers/export-worker.ts'),
  'rebuild-summary-worker': resolve(__dirname, 'src/main/workers/rebuild-summary-worker.ts')
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npx electron-vite build`
Expected: Build completes. `out/main/` contains `export-worker.js` and `rebuild-summary-worker.js`.

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts
git commit -m "fix: add missing worker entries to rollup inputs

export-worker and rebuild-summary-worker were missing from
electron.vite.config.ts rollup inputs. They work in dev but
may fail in production builds."
```

---

### Task 7: Deferred startup rebuild via worker (parallel with Tasks 6, 8)

**Files:**
- Modify: `src/main/database/DatabaseService.ts:201-224` (_deferredInit)
- Modify: `src/main/database/CohortSummaryService.ts` (add batch deferral)
- Modify: `tests/main/database/CohortSummaryService.test.ts`

- [ ] **Step 1: Write test for deferred rebuild**

In `tests/main/database/CohortSummaryService.test.ts`, add:

```typescript
describe('deferred rebuild', () => {
  it('does not block main thread during startup rebuild', () => {
    // Create a DatabaseService with variants but no summary
    // Call _deferredInit
    // Verify it returns immediately (not blocking)
    // Verify summary is eventually rebuilt
  })
})
```

- [ ] **Step 2: Modify `_deferredInit()` to use rebuild worker**

Move the startup rebuild logic OUT of `DatabaseService._deferredInit()` and INTO the IPC handler layer where `BrowserWindow` is accessible. `DatabaseService` does not extend `EventEmitter` and has no access to Electron's `BrowserWindow`.

**Approach:** Add a public method `needsStartupRebuild(): boolean` to `DatabaseService` that returns the check result (summary empty + variants exist). Then in the handler registration (where `BrowserWindow` is available), call this method and spawn the worker if needed.

In `src/main/database/DatabaseService.ts`:
```typescript
// Replace the rebuild call in _deferredInit with a status check only
needsStartupRebuild(): boolean {
  const summaryCount = this.db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()
  const variantCount = this.db.prepare('SELECT COUNT(*) as c FROM variants').get()
  return (summaryCount as any).c === 0 && (variantCount as any).c > 0
}
```

In the IPC handler registration (e.g., `src/main/ipc/handlers/cohort.ts` or a new startup handler):
```typescript
// After handler registration, check if startup rebuild is needed
if (db.needsStartupRebuild()) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('cohort:summaryRebuilding', true)

  const worker = new Worker(resolve(__dirname, 'rebuild-summary-worker.js'))
  worker.postMessage({ dbPath, encryptionKey })
  worker.on('message', (msg) => {
    if (msg.type === 'complete') {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('cohort:summaryRebuilding', false)
    }
  })
}
```

This follows the existing `safeEmit` pattern used in other handlers.

- [ ] **Step 3: Verify `rebuild-summary-worker.js` path resolves correctly**

In the compiled output (`out/main/`), all workers and index are flat in the same directory. So `resolve(__dirname, 'rebuild-summary-worker.js')` works in production. Verify by checking other worker spawns (e.g., `import-worker-client.ts`) for the path pattern used.

- [ ] **Step 4: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/database/CohortSummaryService.test.ts -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/DatabaseService.ts src/main/database/CohortSummaryService.ts tests/main/database/CohortSummaryService.test.ts
git commit -m "perf: defer startup cohort rebuild to worker thread

Route startup summary rebuild through rebuild-summary-worker
instead of blocking the main thread for 10-30s on large databases."
```

---

### Task 8: Rebuild UI indicator in renderer (parallel with Tasks 6, 7)

**Files:**
- Modify: `src/renderer/src/` — add indicator to cohort view or app layout
- Modify: `src/preload/index.ts` — add `onSummaryRebuilding` listener if needed

- [ ] **Step 1: Add IPC listener in preload for rebuild status**

In `src/preload/index.ts`, add to the `cohort` section:

```typescript
onSummaryRebuilding: (callback: (rebuilding: boolean) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, rebuilding: boolean) => {
    callback(rebuilding)
  }
  ipcRenderer.on('cohort:summaryRebuilding', handler)
  return () => ipcRenderer.removeListener('cohort:summaryRebuilding', handler)
}
```

- [ ] **Step 2: Add subtle indicator to CohortTable or app layout**

Use a Vuetify `v-banner` or `v-alert` with `type="info"` and `density="compact"`:

```vue
<v-banner v-if="isRebuilding" density="compact" color="info" icon="mdi-database-sync">
  Rebuilding cohort index...
</v-banner>
```

Wire `isRebuilding` ref to the IPC listener. Clean up listener on unmount.

- [ ] **Step 3: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/ src/preload/index.ts
git commit -m "feat: show rebuild indicator when cohort summary is updating

Subtle banner in cohort view during background summary rebuild."
```

---

## Phase 3: Piscina Worker Pool

### Task 9: Install Piscina + extract `createRepositories()` factory

**Files:**
- Create: `src/main/database/createRepositories.ts`
- Modify: `src/main/database/DatabaseService.ts:105-116` (use factory)
- Modify: `package.json` (add piscina dependency)

- [ ] **Step 1: Install Piscina**

Run: `npm install piscina`

- [ ] **Step 2: Create `createRepositories()` factory**

Create `src/main/database/createRepositories.ts`:

```typescript
import type Database from 'better-sqlite3-multiple-ciphers'
import { createKysely } from './kysely'
import { CaseRepository } from './CaseRepository'
import { VariantRepository } from './VariantRepository'
import { TranscriptRepository } from './TranscriptRepository'
import { AnnotationRepository } from './AnnotationRepository'
import { MetadataRepository } from './MetadataRepository'
import { TagRepository } from './TagRepository'
import { DatabaseOverviewService } from './DatabaseOverviewService'
import { AuditLogRepository } from './AuditLogRepository'
import { GeneListRepository } from './GeneListRepository'
import { AuthService } from '../services/auth/AuthService'
import { CohortSummaryService } from './CohortSummaryService'
import { FilterPresetRepository } from './FilterPresetRepository'
import { CohortService } from './cohort'

export function createRepositories(db: Database.Database) {
  const kysely = createKysely(db)
  const cases = new CaseRepository(db, kysely)
  const variants = new VariantRepository(db, kysely, cases)
  const transcripts = new TranscriptRepository(db, kysely)
  const annotations = new AnnotationRepository(db, kysely)
  const metadata = new MetadataRepository(db, kysely)
  const tags = new TagRepository(db, kysely)
  const overview = new DatabaseOverviewService(db, kysely)
  const auditLog = new AuditLogRepository(db, kysely)
  const geneLists = new GeneListRepository(db, kysely)
  const auth = new AuthService(db)
  const cohortSummary = new CohortSummaryService(db)
  const filterPresets = new FilterPresetRepository(db, kysely)
  const cohort = new CohortService(db)

  return {
    cases, variants, transcripts, annotations, metadata,
    tags, overview, auditLog, geneLists, auth,
    cohortSummary, filterPresets, cohort
  }
}

export type Repositories = ReturnType<typeof createRepositories>
```

Check exact constructor signatures by reading each repository's constructor before writing. The above is based on research — verify against actual code.

- [ ] **Step 3: Refactor DatabaseService to use factory**

In `src/main/database/DatabaseService.ts`, replace lines 105-116 (repository instantiation) with:

```typescript
import { createRepositories } from './createRepositories'

// In constructor, after migrations:
const repos = createRepositories(this.db)
this._cases = repos.cases
this._variants = repos.variants
// ... map all properties
```

- [ ] **Step 4: Run full test suite to verify refactor is clean**

Run: `make test`
Expected: All tests pass — no behavior change.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/createRepositories.ts src/main/database/DatabaseService.ts package.json package-lock.json
git commit -m "refactor: extract createRepositories factory, install piscina

Factory shared between DatabaseService and future db-worker.
Piscina installed for worker pool in next step."
```

---

### Task 10: Create db-worker + DbPool service

**Files:**
- Create: `src/main/workers/db-worker.ts`
- Create: `src/main/database/DbPool.ts`
- Create: `src/shared/types/db-task.ts`
- Modify: `electron.vite.config.ts` (add db-worker to rollup inputs)
- Create: `tests/main/database/DbPool.test.ts`

- [ ] **Step 1: Define DbTask type**

Create `src/shared/types/db-task.ts`:

```typescript
export interface DbTask {
  type: string
  params: unknown
}

export interface DbTaskResult<T = unknown> {
  data: T
}
```

- [ ] **Step 2: Create db-worker.ts**

Create `src/main/workers/db-worker.ts` following the spec's initialization sequence exactly:

1. Import `better-sqlite3-multiple-ciphers` and `worker_threads`
2. Get `dbPath` and `encryptionKey` from `workerData`
3. Open connection, set encryption key FIRST (with quote escaping)
4. Set all PRAGMAs: WAL, synchronous=NORMAL, cache_size, mmap_size, busy_timeout, foreign_keys, read_uncommitted
5. Call `createRepositories(db)`
6. Export default `run(task: DbTask)` function with switch/case dispatcher
7. Wrap in try/catch that converts custom errors to plain Error

Include all READ operation types from the IPC handler analysis:
- `variants:query`, `variants:filterOptions`, `variants:search`, `variants:geneSymbols`
- `cohort:variants`, `cohort:columnMeta`, `cohort:summary`, `cohort:carriers`, `cohort:geneBurden`, `cohort:summaryStatus`
- `cases:list`
- `annotations:getGlobal`, `annotations:getPerCase`, `annotations:getForVariant`
- `case-metadata:get`, `case-metadata:listCohorts`, `case-metadata:getCohortByName`, `case-metadata:getCaseCohorts`, `case-metadata:getHpoTerms`, `case-metadata:getDataInfo`, `case-metadata:listExternalIds`, `case-metadata:distinctPlatforms`, `case-metadata:distinctExternalIdTypes`, `case-metadata:getFullMetadata`

- [ ] **Step 3: Create DbPool.ts**

Create `src/main/database/DbPool.ts`:

```typescript
import Piscina from 'piscina'
import { resolve } from 'path'
import type { DbTask } from '../../shared/types/db-task'

export class DbPool {
  private pool: Piscina | null = null

  init(dbPath: string, encryptionKey?: string): void {
    this.pool = new Piscina({
      filename: resolve(__dirname, 'db-worker.js'),
      minThreads: 1,
      maxThreads: 4,
      idleTimeout: 30000,
      workerData: { dbPath, encryptionKey }
    })
  }

  async run<T>(task: DbTask): Promise<T> {
    if (!this.pool) throw new Error('DbPool not initialized')
    return this.pool.run(task) as Promise<T>
  }

  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy()
      this.pool = null
    }
  }
}
```

- [ ] **Step 4: Add db-worker to rollup inputs**

In `electron.vite.config.ts`, add to inputs:
```typescript
'db-worker': resolve(__dirname, 'src/main/workers/db-worker.ts'),
```

- [ ] **Step 5: Write integration test for DbPool**

Create `tests/main/database/DbPool.test.ts`:

```typescript
describe('DbPool', () => {
  it('executes variant query via worker pool', async () => {
    // Create test database with known data
    // Initialize DbPool with test database path
    // Run variants:query task
    // Verify results match direct query
    // Destroy pool
  })

  it('handles encrypted databases', async () => {
    // Create encrypted test database
    // Initialize DbPool with encryption key
    // Run a query
    // Verify results
  })

  it('propagates errors from worker', async () => {
    // Run task with invalid type
    // Verify error is thrown with descriptive message
  })
})
```

- [ ] **Step 6: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/database/DbPool.test.ts -v`
Expected: All tests pass.

- [ ] **Step 7: Verify build**

Run: `npx electron-vite build`
Expected: Build succeeds. `out/main/db-worker.js` exists.

- [ ] **Step 8: Commit**

```bash
git add src/main/workers/db-worker.ts src/main/database/DbPool.ts src/shared/types/db-task.ts electron.vite.config.ts tests/main/database/DbPool.test.ts
git commit -m "feat: add Piscina-based DbPool and db-worker for off-thread queries

Each worker opens its own SQLite connection with encryption support.
Pool configured: 1-4 threads, 30s idle timeout, read_uncommitted ON."
```

---

### Task 11: Migrate variant IPC handlers to DbPool (parallel with Tasks 12, 13)

**Files:**
- Modify: `src/main/ipc/handlers/variants.ts:23-205`
- Modify: `tests/main/handlers/variants-handlers.test.ts`

- [ ] **Step 1: Update handler registration to accept DbPool**

The variant handler registration function needs access to the DbPool. Follow the existing pattern for how handlers receive the DatabaseService reference, and add DbPool alongside it.

- [ ] **Step 2: Migrate read handlers to pool.run()**

For each read handler in `variants.ts`:

```typescript
// variants:query (line 23) - READ
// Before: db.variants.getVariants(caseId, filters, offset, limit, sortBy)
// After:  dbPool.run({ type: 'variants:query', params: { caseId, filters, offset, limit, sortBy } })

// variants:filterOptions (line 103) - READ
// Before: db.variants.getFilterOptions(caseId)
// After:  dbPool.run({ type: 'variants:filterOptions', params: { caseId } })

// variants:search (line 124) - READ
// Before: db.variants.search(caseId, query, limit)
// After:  dbPool.run({ type: 'variants:search', params: { caseId, query, limit } })

// variants:geneSymbols (line 170) - READ
// Before: db.variants.getGeneSymbols(caseId, query, limit)
// After:  dbPool.run({ type: 'variants:geneSymbols', params: { caseId, query, limit } })
```

- [ ] **Step 3: Update handler tests**

In `tests/main/handlers/variants-handlers.test.ts`, update the test setup to provide a DbPool instance (or mock). Verify all handlers still return correct data.

- [ ] **Step 4: Run handler tests**

Run: `npm run rebuild:node && npx vitest run tests/main/handlers/variants-handlers.test.ts -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/variants.ts tests/main/handlers/variants-handlers.test.ts
git commit -m "perf: migrate variant read handlers to Piscina worker pool

All 4 variant query handlers now run off the main thread via DbPool."
```

---

### Task 12: Migrate cohort read handlers to DbPool (parallel with Tasks 11, 13)

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts:37-137,185-190`
- Modify: `tests/main/handlers/cohort-handlers.test.ts`

- [ ] **Step 1: Identify read vs write handlers**

Read handlers to migrate:
- `cohort:variants` (line 37) — READ
- `cohort:columnMeta` (line 80) — READ
- `cohort:summary` (line 88) — READ
- `cohort:carriers` (line 102) — READ
- `cohort:geneBurden` (line 131) — READ
- `cohort:summaryStatus` (line 185) — READ

Stay on main thread:
- `cohort:geneBurdenCompare` (line 139) — WRITE (association engine, already has own worker potential)
- `cohort:geneBurdenCancel` (line 177) — WRITE
- `cohort:rebuildSummary` (line 193) — WRITE

- [ ] **Step 2: Migrate read handlers — handle serialization logic**

Same pattern as Task 11 — replace direct repository calls with `dbPool.run()`.

**Critical:** The cohort handlers perform post-query serialization that must be preserved:
- `cohort:variants` (lines 50-76): Maps each field explicitly for IPC serializability
- `cohort:summary` (lines 94-98): Uses `JSON.parse(JSON.stringify(..., BigInt converter))`
- `cohort:carriers` (lines 122-126): Same BigInt serialization pattern

**Strategy:** Keep this serialization in the IPC handler layer (NOT in the worker). The worker returns raw query results, and the handler applies the serialization before sending to the renderer. This is the natural place since the serialization is IPC-specific, not database-specific:

```typescript
// Example pattern for cohort:variants
ipcMain.handle('cohort:variants', async (_, params) => {
  const rawResult = await dbPool.run({ type: 'cohort:variants', params })
  // Post-query serialization stays in handler
  return rawResult.map(row => ({
    ...row,
    // field mapping / BigInt conversion as needed
  }))
})
```

- [ ] **Step 3: Update and run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/handlers/cohort-handlers.test.ts -v`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts tests/main/handlers/cohort-handlers.test.ts
git commit -m "perf: migrate cohort read handlers to Piscina worker pool

6 read handlers moved off main thread. Write handlers
(association, rebuild, cancel) remain on main thread.
Post-query serialization (BigInt, field mapping) stays in handler."
```

---

### Task 13: Migrate remaining read handlers to DbPool (parallel with Tasks 11, 12)

**Files:**
- Modify: `src/main/ipc/handlers/cases.ts` (cases:list only)
- Modify: `src/main/ipc/handlers/annotations.ts` (3 read handlers)
- Modify: `src/main/ipc/handlers/case-metadata.ts` (11 read handlers)
- Modify: `src/main/ipc/handlers/filter-presets.ts`, `gene-lists.ts`, `transcripts.ts`, `audit-log.ts`, `tags.ts` (any read handlers)
- Modify: corresponding test files

- [ ] **Step 1: Audit all remaining handler files for reads**

Check each handler file in `src/main/ipc/handlers/` for read-only operations. Focus on:
- `cases.ts`: `cases:list` (READ), delete operations (WRITE — stay)
- `annotations.ts`: `getGlobal`, `getPerCase`, `getForVariant` (READ), upsert/delete (WRITE — stay)
- `case-metadata.ts`: ~11 READ handlers identified in research

- [ ] **Step 2: Migrate read handlers**

Same pattern — replace direct repository calls with `dbPool.run()` for all reads.

- [ ] **Step 3: Run all handler tests**

Run: `npm run rebuild:node && npx vitest run tests/main/handlers/ -v`
Expected: All tests pass.

- [ ] **Step 4: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/ tests/main/handlers/
git commit -m "perf: migrate all remaining read handlers to Piscina worker pool

cases:list, 3 annotation reads, 11 case-metadata reads, and
other read handlers now run off the main thread via DbPool."
```

---

## Phase 4: Pagination & Polish

### Task 14: Cache total count on renderer side

**Files:**
- Modify: `src/renderer/src/composables/useOffsetPagination.ts`
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`

- [ ] **Step 1: Add count caching logic**

In `useOffsetPagination.ts`, track whether filters have changed:
- On page navigation (same filters): skip count query, reuse cached `totalCount`
- On filter change: re-query count

This requires the backend to support an optional `skipCount` parameter, or the pagination composable to manage count separately.

- [ ] **Step 2: Modify `fetchPage` to optionally skip count**

Add a `cachedTotalCount` ref that persists across page navigations. Only request a new count when `filterKey` changes (from Task 4's computed).

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/renderer/ -v`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useOffsetPagination.ts src/renderer/src/components/variant-table/useVariantData.ts
git commit -m "perf: cache pagination total count, skip re-query on page change

Only re-queries total count when filters change, not on every
page navigation."
```

---

### Task 15: Wire up existing statistics WorkerPool

**Files:**
- Modify: `src/main/statistics/AssociationEngine.ts`
- Modify: `src/main/ipc/handlers/cohort.ts` (geneBurdenCompare handler)
- Modify: `tests/main/statistics/integration.test.ts`

- [ ] **Step 1: Review existing WorkerPool and worker**

Read `src/main/statistics/WorkerPool.ts` and `src/main/statistics/worker.ts` to understand the existing API.

- [ ] **Step 2: Wire AssociationEngine to use WorkerPool**

Replace the sequential main-thread loop in `AssociationEngine.ts` (lines 57-91) with:

```typescript
const pool = new WorkerPool(workerPath, maxThreads)
const results = await pool.run(genes, config)
```

The WorkerPool already splits genes into batches and distributes across workers.

- [ ] **Step 3: Update cohort handler**

In `cohort.ts` `geneBurdenCompare` handler (line 139), pass the worker path and thread config to AssociationEngine.

- [ ] **Step 4: Run statistics tests**

Run: `npm run rebuild:node && npx vitest run tests/main/statistics/ -v`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/statistics/AssociationEngine.ts src/main/ipc/handlers/cohort.ts tests/main/statistics/
git commit -m "perf: wire AssociationEngine to existing WorkerPool

Gene-level statistical tests now run in parallel across CPU cores
using the already-implemented WorkerPool and worker.ts."
```

---

## Final Validation

- [ ] **Run full CI pipeline**

Run: `make ci`
Expected: lint + typecheck + all tests pass.

- [ ] **Build and verify**

Run: `make dist`
Expected: Electron app builds and packages successfully.
