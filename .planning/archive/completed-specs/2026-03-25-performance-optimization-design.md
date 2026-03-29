# Performance Optimization Design

## Context

VarLens is an Electron desktop app for offline genetic variant analysis. As datasets grow (1500 cases x 7k variants = ~10.5M total variants), four areas exhibit noticeable slowness: app startup, case loading, cohort view, and importing.

A future thin client with PostgreSQL backend is planned. The Electron fat client will remain. Both will share the same Vue renderer and `WindowAPI` interface — the existing API abstraction layer already supports this.

### Pain Points (User-Reported)

| Area | Root Cause |
|---|---|
| App startup | Cohort summary rebuild runs on main thread (10-30s) |
| Case loading | `getFilterOptions()` executes ~21-53 sequential queries on main thread |
| Cohort view | Queries run synchronously on main thread, blocking UI |
| Importing | FTS5 index rebuilt per batch instead of once at end |

### Architectural Decision: Piscina Worker Pool

All database **read** queries will move off the Electron main thread into a Piscina worker pool. Write operations remain on the main thread to avoid WAL write contention with existing import/delete workers. Piscina was selected over alternatives (Tinypool, workerpool, custom) because:

- Zero production dependencies, ~800KB install
- Official Electron + electron-vite documentation
- Maintained by Node.js core team (James Snell, Matteo Collina)
- CJS support required for Electron worker module loading
- Proven pattern with `better-sqlite3-multiple-ciphers` (one connection per worker)
- Used in production: Yelp, PostHog, Angular CLI

**PostgreSQL migration note:** Piscina solves synchronous better-sqlite3 blocking. An async PostgreSQL driver would not need a worker pool — async queries don't block the event loop. The worker pool is kept as an internal implementation detail behind the existing `WindowAPI` interface, making it easy to swap out when the server-side API backend is built.

---

## Section 1: Piscina Worker Pool for Database Queries

### Architecture

```
Renderer (Vue)
    |
    v (IPC invoke)
Main Process (thin dispatcher)
    |  reads: pool.run()
    |  writes: direct on main thread
    v
Piscina Worker Pool (1-4 threads, read-only)
    | each worker owns its own better-sqlite3-multiple-ciphers connection
    v
SQLite database (WAL mode)
```

### Worker design

A single worker file (`src/main/workers/db-worker.ts`) that:

1. Opens its own `better-sqlite3-multiple-ciphers` connection on startup (DB path + encryption key via `workerData`)
2. **Sets encryption key FIRST** (`PRAGMA key=`) before any other pragma — required for encrypted databases
3. Sets WAL mode + PRAGMAs (same as current `DatabaseService`: `synchronous=NORMAL`, `cache_size=-32MB`, `mmap_size=1GB`, `busy_timeout=5000`)
4. Optionally sets `PRAGMA read_uncommitted = ON` to reduce lock contention with import worker
5. Instantiates repositories via a `createRepositories()` factory function
6. Exports a `run(task)` function that dispatches by task type

```typescript
// Worker initialization sequence (critical order)
import Database from 'better-sqlite3-multiple-ciphers'
import { workerData } from 'worker_threads'

const { dbPath, encryptionKey } = workerData

// 1. Open connection
const db = new Database(dbPath)

// 2. Encryption key MUST be first pragma (escape single quotes per codebase pattern)
if (encryptionKey) {
  const safeKey = encryptionKey.split("'").join("''")
  db.pragma(`key='${safeKey}'`)
}

// 3. Performance pragmas
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = -32768')
db.pragma('mmap_size = 1073741824')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')
db.pragma('read_uncommitted = ON')

// 4. Create repositories via shared factory
const repos = createRepositories(db)

// 5. Export task handler
export default function run(task: DbTask): unknown {
  switch (task.type) {
    case 'variants:query':
      return repos.variants.getVariants(task.params)
    // ... all READ operations
  }
}
```

### Repository factory function

Extract a `createRepositories(db)` factory from `DatabaseService` to avoid duplicating the dependency wiring:

```typescript
// src/main/database/createRepositories.ts
export function createRepositories(db: DatabaseType) {
  const kysely = createKysely(db)
  const caseRepo = new CaseRepository(db, kysely)
  const variantRepo = new VariantRepository(db, kysely, caseRepo)
  const cohortService = new CohortService(db)          // takes only db
  const cohortSummary = new CohortSummaryService(db)    // takes only db
  // ... all repositories
  return { cases: caseRepo, variants: variantRepo, cohort: cohortService, cohortSummary, ... }
}
```

Both `DatabaseService` (main thread) and `db-worker.ts` use this factory.

### electron-vite bundling

The worker file **must** be registered as a rollup input in `electron.vite.config.ts`.

**Pre-existing gap:** `export-worker.ts` and `rebuild-summary-worker.ts` are also missing from rollup inputs (only `index`, `statistics-worker`, `import-worker`, `delete-worker` are listed). These likely work in dev but may fail in production builds. Fix all at once:

```typescript
// electron.vite.config.ts
main: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/main/index.ts'),
        'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts'),
        'import-worker': resolve(__dirname, 'src/main/workers/import-worker.ts'),
        'delete-worker': resolve(__dirname, 'src/main/workers/delete-worker.ts'),
        'export-worker': resolve(__dirname, 'src/main/workers/export-worker.ts'),           // FIX
        'rebuild-summary-worker': resolve(__dirname, 'src/main/workers/rebuild-summary-worker.ts'), // FIX
        'db-worker': resolve(__dirname, 'src/main/workers/db-worker.ts'),                   // NEW
      }
    }
  }
}
```

At runtime, the worker path is resolved as: `resolve(__dirname, 'db-worker.js')` — same pattern as existing workers.

### Pool configuration

| Setting | Value | Rationale |
|---|---|---|
| `minThreads` | 1 | Always one warm worker ready |
| `maxThreads` | 4 | More doesn't help — SQLite serializes writes, reads are fast |
| `idleTimeout` | 30000 | Reclaim idle workers after 30s |
| DB path | via `workerData` | Avoids re-opening connections per task |
| Encryption key | via `workerData` | Required for encrypted database support |

### DbPool service

A `DbPool` class wraps Piscina lifecycle:

- `init(dbPath, encryptionKey?)` — create pool, pass path + key via `workerData`
- `run<T>(task: DbTask): Promise<T>` — submit task
- `destroy()` — graceful shutdown (close pool + connections)

This service is the single point where Piscina is referenced. IPC handlers call `dbPool.run(...)` instead of repository methods directly.

### Error propagation

Custom error classes (`DatabaseError`, `TransactionError` from `src/main/database/errors.ts`) may not survive structured clone across worker boundaries. The worker wraps all task execution in a try/catch that converts custom errors to plain `Error` objects with the original message and a `code` property:

```typescript
try {
  return handler(task)
} catch (err) {
  const plain = new Error(err.message)
  plain.name = err.constructor.name
  throw plain
}
```

The `wrapHandler()` utility in IPC handlers catches these as normal errors.

### Write operation strategy

**Reads** go through the Piscina pool. **Writes** stay on the main thread to avoid WAL write contention:

- Read operations: `variants:query`, `variants:filterOptions`, `variants:search`, `cohort:summary`, `cohort:variants`, `cases:list`, all `get*` handlers
- Write operations: `annotations:update*`, `cases:delete*`, `tags:*`, `case-metadata:update*`, `cohort:rebuildSummary`

This avoids contention with the import worker (which sets `synchronous=OFF` and `wal_autocheckpoint=0` during heavy writes). Only one writer at a time in SQLite — the main thread serializes writes naturally.

### Migration strategy

Refactor IPC handlers one domain at a time:
1. `variants` read handlers (highest impact — `getFilterOptions` is the worst bottleneck)
2. `cohort` read handlers (including `cohort:rebuildSummary` trigger — stays on main thread but delegates to existing rebuild worker)
3. `cases` read handlers
4. `annotations` read handlers
5. `case-metadata` read handlers

The `WindowAPI` interface stays unchanged — the renderer sees no difference.

### What stays on the main thread

- All write operations (annotations, tags, case metadata updates)
- Import (already has its own worker: `import-worker.ts`)
- Delete (already has its own worker: `delete-worker.ts`)
- Summary rebuild (already has its own worker: `rebuild-summary-worker.ts`)
- File dialogs, shell operations, auto-updater

---

## Section 2: Query Optimizations

### 2.1 Consolidate `getFilterOptions()` — ~21-53 queries to ~5-8

**Current:** `VariantRepository.getFilterOptions()` (line 644) runs:
- 5 top-level queries (3 DISTINCT + 2 MIN/MAX range)
- `getColumnMeta()` loop (line 586): 16 sortable columns x 1-3 queries each = 16-48 queries
  - Always: 1 COUNT DISTINCT per column
  - If numeric (5 columns): +1 MIN/MAX query
  - If count <= 50: +1 DISTINCT values query
- Total: 21-53 sequential synchronous queries depending on data

**New approach — three consolidated queries:**

**Query 1:** Single aggregate scan for all COUNT DISTINCT and numeric MIN/MAX:
```sql
SELECT
  COUNT(DISTINCT consequence) as consequence_n,
  COUNT(DISTINCT func) as func_n,
  COUNT(DISTINCT clinvar) as clinvar_n,
  COUNT(DISTINCT gene_symbol) as gene_n,
  COUNT(DISTINCT zygosity) as zygosity_n,
  -- ... all 16 sortable columns
  MIN(cadd) as cadd_min, MAX(cadd) as cadd_max,
  MIN(gnomad_af) as af_min, MAX(gnomad_af) as af_max,
  MIN(gnomad_af_popmax) as af_popmax_min, MAX(gnomad_af_popmax) as af_popmax_max
  -- ... all numeric columns
FROM variants WHERE case_id = ?
```

**Query 2:** Combined DISTINCT values for all low-cardinality columns (count <= 50) using UNION ALL:
```sql
SELECT 'consequence' as col, consequence as val FROM variants WHERE case_id = ? GROUP BY consequence
UNION ALL
SELECT 'func', func FROM variants WHERE case_id = ? GROUP BY func
UNION ALL
SELECT 'clinvar', clinvar FROM variants WHERE case_id = ? GROUP BY clinvar
-- ... only for columns where Query 1 showed count <= 50
```

**Query 3 (optional):** Any remaining columns that need separate handling.

**Result:** ~3-5 queries instead of 21-53. One full table scan (Query 1) + one scan for distinct values (Query 2).

**Index support:** Add a covering index for the consolidated query:
```sql
CREATE INDEX idx_variants_case_numeric ON variants(case_id, cadd, gnomad_af)
```

### 2.2 Fix FTS5 rebuild-per-batch

**Current:** `VariantRepository.insertVariantsBatch()` (line 49) drops FTS triggers, inserts one batch, then rebuilds FTS and recreates triggers. When called N times for a large import, FTS is rebuilt N times.

**Fix:** Split into explicit lifecycle methods:
- `beginBulkInsert()` — drop triggers once
- `insertBatch(data)` — insert data only (called N times)
- `finishBulkInsert()` — rebuild FTS + recreate triggers once

The import worker (`import-worker.ts`) already follows this pattern correctly. This aligns the non-worker code path.

### 2.3 Reduce IPC serialization overhead

**Current:** `JSON.parse(JSON.stringify(filters))` runs on every page load in `useVariantData.ts` (line 52) to strip Vue reactive proxies.

**Analysis:** The filters object contains nested arrays (`consequences`, `funcs`, `clinvars`, `tag_ids`) and objects (`column_filters`). A shallow `toRaw()` + spread would not strip proxies from nested structures. Since the filter object is small (~15 properties), `JSON.parse(JSON.stringify())` is actually the correct approach for deep reactive objects. The performance difference is negligible.

**Fix:** Keep `JSON.parse(JSON.stringify())` for the filters (correctness over micro-optimization). Instead, focus on removing unnecessary serialization cycles — the current code does 2-3 serialization rounds per page load (lines 52-61). Consolidate to a single `JSON.parse(JSON.stringify())` call that includes the merged `column_filters`.

---

## Section 3: Startup & Cohort Summary Optimization

**Note:** This section has NO dependency on the Piscina worker pool (Section 1). It uses the already-existing `rebuild-summary-worker.ts`. Can be implemented immediately after Phase 1 quick wins.

### 3.1 Deferred startup rebuild

**Current:** `DatabaseService._deferredInit()` (line 201) triggers cohort summary rebuild via `process.nextTick()` on the main thread — blocks UI for 10-30s on large databases.

**Fix:** Route through the existing `rebuild-summary-worker.ts`:
1. Main process spawns rebuild worker (same as post-import path)
2. UI becomes responsive immediately
3. Renderer shows a subtle "Rebuilding cohort index..." indicator
4. Worker posts completion → renderer clears indicator

**Pre-requisite check:** Verify `rebuild-summary-worker` is in the `electron.vite.config.ts` rollup inputs. If not, add it — it may work in dev but fail in production builds.

### 3.2 Smarter rebuild triggering

**Incremental by default:** `CohortSummaryService.incrementalAdd()` (line 64) exists and is faster than full rebuild. Ensure single-case imports always use this path.

**Batch import deferral:** When importing multiple cases sequentially, defer rebuild until the entire batch completes — one rebuild instead of N.

**Staleness flag:** Extend the existing `gene_burden_summary` staleness concept to `cohort_variant_summary`. The UI shows stale-but-usable data while rebuild runs in background.

---

## Section 4: Renderer Performance

### 4.1 `shallowRef` for large data arrays

**Current:** `variants` in `useVariantData.ts` (line 38) is `ref<Variant[]>` — Vue creates deep reactive proxies for every property of every variant on each page load.

**Fix:** The `shallowRef` change must happen at the **source** where the ref is created. If `useOffsetPagination` creates the `items` ref internally using `ref()`, the change must happen there — changing only the consumer side does nothing. Audit `useOffsetPagination` to ensure `items` uses `shallowRef<T[]>()`. Since variant data is replaced wholesale on each page fetch (never mutated in-place), `shallowRef` is safe.

Same treatment for `columnMeta` ref.

### 4.2 Annotation cache bounded cleanup

**Current:** Global `annotationCache` in `useAnnotations.ts` (line 23) grows indefinitely.

**Fix:** LRU eviction capped at ~5000 entries (~100 pages of browsing). Since JavaScript `Map` maintains insertion order, implement LRU by deleting and re-inserting on access (moves entry to end), then evicting from the front when size exceeds the limit. Simple and no external dependency.

### 4.3 Deep watcher optimization

**Current:** `watch(filters, invalidateAndReload, { deep: true })` (line 126) traverses entire filter tree on every reactivity pass.

**Fix:** Serialize filter state and watch the string:
```typescript
const filterKey = computed(() => JSON.stringify(toRaw(filters.value)))
watch(filterKey, invalidateAndReload)
```

Fires only on actual filter changes (string comparison), not on every Vue reactivity cycle.

### 4.4 Plotly chart cleanup

**Current:** `VolcanoPlot` and `ManhattanPlot` don't clean up Plotly instances on unmount.

**Fix:** Add `onUnmounted(() => Plotly.purge(containerRef))` to both chart components.

### 4.5 Intentional exclusions

| Excluded | Reason |
|---|---|
| Virtual scrolling | `v-data-table-virtual` has Vuetify bugs with wide tables (43+ cols = 12-20s, 2GB RAM). Server-side pagination with ~25 rows is robust. |
| Columnar IPC transfer | ~50 rows per page — structured clone overhead is negligible |
| SharedArrayBuffer | Association engine not a reported pain point; existing worker infra just needs wiring |

---

## Section 5: Implementation Phases

### Phase 1: Quick wins (low risk, high impact)

- Consolidate `getFilterOptions()` from ~21-53 to ~5-8 queries
- Fix FTS5 rebuild-per-batch in `VariantRepository`
- `shallowRef` for variant/columnMeta arrays (audit source in `useOffsetPagination`)
- Consolidate IPC serialization to single `JSON.parse(JSON.stringify())` call
- Plotly cleanup on unmount
- Annotation cache LRU eviction (Map insertion order)
- Deep watcher → serialized filter key

**Rationale:** No architectural changes. Each fix is isolated and independently testable. Addresses the biggest query bottleneck immediately.

### Phase 2: Startup & rebuild optimization (no Piscina dependency)

- Verify `rebuild-summary-worker` is in rollup inputs
- Route startup cohort rebuild through `rebuild-summary-worker`
- Add "rebuilding" UI indicator in renderer
- Batch import deferred rebuild
- Staleness flag for `cohort_variant_summary`

**Rationale:** Uses already-existing worker infrastructure. No dependency on Piscina. Delivers startup improvement early.

### Phase 3: Piscina worker pool

- Add Piscina dependency
- Extract `createRepositories()` factory from `DatabaseService`
- Create `db-worker.ts` with proper initialization sequence (encryption key first)
- Add `db-worker` to `electron.vite.config.ts` rollup inputs
- Create `DbPool` service wrapping Piscina lifecycle
- Migrate read-only IPC handlers domain by domain: variants → cohort → cases → annotations → case-metadata
- Write operations remain on main thread
- Error serialization: convert custom errors to plain `Error` in worker
- Integration tests verifying query results match before/after migration

**Rationale:** Largest architectural change. Ships after Phases 1-2 are stable to reduce risk.

### Phase 4: Pagination & polish

- Cache total count on renderer side (re-query only on filter change)
- Wire up existing statistics `WorkerPool.ts` / `worker.ts` (already implemented, currently unused)
- Performance profiling pass to verify gains

**Rationale:** Smallest impact. Refinements and validation.

---

## Files Affected

### Phase 1
- `src/main/database/VariantRepository.ts` — query consolidation, FTS fix
- `src/main/database/schema.ts` — new covering index
- `src/renderer/src/components/variant-table/useVariantData.ts` — serialization, watcher
- `src/renderer/src/composables/useOffsetPagination.ts` — shallowRef at source
- `src/renderer/src/composables/useAnnotations.ts` — LRU cache
- `src/renderer/src/components/association/VolcanoPlot.vue` — cleanup
- `src/renderer/src/components/association/ManhattanPlot.vue` — cleanup

### Phase 2
- `electron.vite.config.ts` — verify rebuild-summary-worker in rollup inputs
- `src/main/database/DatabaseService.ts` — deferred init change
- `src/main/database/CohortSummaryService.ts` — batch deferral, staleness
- `src/renderer/src/` — rebuilding indicator component

### Phase 3
- `electron.vite.config.ts` — add db-worker to rollup inputs
- `src/main/workers/db-worker.ts` — new file
- `src/main/database/createRepositories.ts` — new file (factory extraction)
- `src/main/database/DbPool.ts` — new file
- `src/main/database/DatabaseService.ts` — use factory, pool lifecycle
- `src/main/ipc/handlers/*.ts` — read handlers migrated to pool.run()

### Phase 4
- `src/renderer/src/components/variant-table/useVariantData.ts` — count caching
- `src/main/statistics/AssociationEngine.ts` — wire up WorkerPool
- `src/main/ipc/handlers/cohort.ts` — use stats worker pool

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Piscina + electron-vite worker bundling | Add to rollup inputs explicitly; use `resolve(__dirname, 'db-worker.js')` at runtime |
| Encrypted database in workers | Pass `encryptionKey` via `workerData`; set `PRAGMA key=` before any other pragma |
| Native module loading in workers | `better-sqlite3-multiple-ciphers` is N-API/context-aware; pre-load in main thread |
| WAL write contention | Only reads go to pool; writes stay on main thread; import worker is sole heavy writer |
| WAL read contention during imports | Pool workers set `PRAGMA read_uncommitted = ON` for reduced lock contention |
| Error serialization across worker boundary | Convert custom errors to plain `Error` objects in worker catch handler |
| Query result differences after consolidation | Integration tests comparing old vs new output |
| `shallowRef` breaking reactivity | Variant data is always replaced wholesale, never mutated — safe; change at source ref |
| `rebuild-summary-worker` not in production build | Verify rollup input entry before Phase 2 implementation |
