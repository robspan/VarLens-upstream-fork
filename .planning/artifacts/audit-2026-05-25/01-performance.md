# VarLens Performance Audit — 2026-05-25

Repo state: `f23709db` (chore: bump version to 0.59.4). Scope: renderer hot paths, IPC chattiness, SQLite and PostgreSQL query patterns, VCF import pipeline, worker-thread topology. Static analysis only — no `make` targets executed.

## Executive Summary

The codebase has already absorbed most of the obvious renderer-perf work (offset pagination with prefetch cache, row view-model caching, `shallowRef`/`markRaw` on variant arrays, debounced filter emissions, generation guards on annotation batches). The remaining wins are concentrated in **main-process query shapes and IPC-side batching**, not Vue rendering:

1. The per-variant annotation batch hidden inside `AnnotationRepository.getBatch` issues 3 SQLite calls per row (`O(n)` with `n = page size`). This is the single largest fixable hot path on every page load and case switch.
2. `cloneForIpc` is implemented as `JSON.parse(JSON.stringify(value))` and is run on **every** `variants:query` filter argument from the renderer. Structured clone via `structuredClone()` or a targeted plain-object copier would eliminate a full double serialization round-trip on every page request.
3. The SQLite multi-column meta scan (`getAllColumnMetas`) issues `COUNT(DISTINCT col)` for every base column on every case switch, which is a full table scan regardless of column cardinality. The pre-existing v25 `idx_variants_type_case ON (variant_type, case_id)` is column-ordered for the opposite usage pattern; queries that filter `case_id` first cannot lead-scan it.
4. The renderer keeps the per-type FilterToolbar + VariantTable mounted under `v-show` while the default Shortlist tab is the user-visible panel (`CaseView.vue:360`). FilterToolbar's `useFilterState` then immediately fires `getFilterOptions` and `loadTags` for the hidden case as part of its lifecycle watcher. Concrete deferred work survives the 2026-05-06 review's call-out.
5. PostgreSQL queries use ad-hoc `pool.query(text, params)` everywhere with no `name:` field, so `pg` cannot promote any query to a server-side prepared statement. Combined with a 16-thread Vuetify SPA pattern that fires many small reads on a case switch, this leaves substantial parse/plan cost on the table.
6. The Piscina pool's `pragma 'read_uncommitted = ON'` on workers is good, but each worker opens its own SQLite handle and re-runs `prepare()` for every query — there is no statement cache on the *worker* side, only inside `CohortService`. Hot pages pay parse cost for every IPC call.

Recommended sequencing: start with finding 1 (annotation batch JOIN), then 2 (clone replacement), then 4 (defer hidden FilterToolbar work). 3 and 6 are mid-effort but unlock WGS perf. 5 is the highest-leverage PG-side change.

---

## Findings

### 1. HIGH — `AnnotationRepository.getBatch` does 3 SQLite calls per variant in a JS loop

**File**: `src/main/database/AnnotationRepository.ts:181-215`

**Evidence**:
```ts
for (const vk of variantKeys) {
  const key = `${vk.chr}:${vk.pos}:${vk.ref}:${vk.alt}`
  const global = this.getGlobalAnnotation(vk.chr, vk.pos, vk.ref, vk.alt)  // SELECT #1
  if (caseId !== null) {
    const variant = this.execFirst<{ id: number }>(...)  // SELECT #2 (case_id+chr+pos+ref+alt → id)
    if (variant) {
      perCase = this.getPerCaseAnnotation(caseId, variant.id)  // SELECT #3
    }
  }
  result[key] = { global, perCase }
}
```

On every page change `useVariantData` calls `loadAnnotationsBatch(caseId, newVariants)` (`src/renderer/src/components/variant-table/useVariantData.ts:189-204`), which dispatches `annotations:batchGet` through the worker pool. For the default 50-row page that is **150 sequential prepared-statement executions** every page navigation. On a 1000-row export it is 3000 calls.

The right shape is a single SQL query that joins `variants → case_variant_annotations` + `variant_annotations` keyed on (chr,pos,ref,alt) for the full set in one round-trip. SQLite handles `(case_id, variant_id)` lookups well — `idx_cva_case_starred` and `idx_va_coords_starred` already exist. The per-row variant_id lookup is also redundant when the caller already holds the `variant.id` for the visible page (the variants array does carry `id`); see also the schema: passing the array of ids would avoid the second SELECT entirely.

**Why it matters**: Every case switch issues `loadAnnotationsBatch` from `useVariantData.ts:194` and again from the `active` watcher at line 212. The pool is single-task-per-thread, so this serializes on one worker connection. Even at sub-ms per query, 100-300 ms of round-trips per page navigation are entirely unnecessary.

**Recommended fix**: Replace the loop with a single JOIN. Two reasonable shapes:

- **Caller-side simplification**: change the IPC payload from `Array<{chr,pos,ref,alt}>` to `Array<{id, chr, pos, ref, alt}>`. Drop `getBatch`'s second SELECT entirely; build perCase via `SELECT * FROM case_variant_annotations WHERE case_id = ? AND variant_id IN (...)` and global via `SELECT * FROM variant_annotations WHERE (chr,pos,ref,alt) IN ((?,?,?,?), ...)`. Two queries total instead of `3n`.
- **Single-query option**: one SELECT that LEFT JOINs both annotation tables and returns one row per variant key.

**Validation**: micro-benchmark `annotations:batchGet` with 50/200/1000 keys against current vs JOIN; the existing perf E2E `renderer-perf-phase1.e2e.ts` should pick up the case-switch / page-flip improvement directly.

---

### 2. HIGH — `cloneForIpc` is `JSON.parse(JSON.stringify(...))` on every variants:query

**File**: `src/shared/utils/cloneForIpc.ts:1-6`, called from `src/renderer/src/components/variant-table/useVariantData.ts:85`

**Evidence**:
```ts
// cloneForIpc.ts (entire file)
export function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
```

In `useVariantData.fetchPage` (line 85) every page request runs `cloneForIpc({ ...rawFilters, ... })` on the whole filter object — typically a small object, but it still pays the cost of a full stringify + parse on every page click and every debounced filter change. The same pattern repeats in `FilterToolbar.vue:460` for preset saves and elsewhere.

The renderer is on Chromium, so it has `structuredClone()` built-in. `structuredClone` is a single C++ copy with no string serialization step, and Electron IPC's structured-clone boundary will run the *same* algorithm on the way out, so doing it explicitly in JS first is genuinely redundant.

**Why it matters**: For the typical variant filter (a 20-key object with a few arrays), the overhead is ~50-200 µs per call, which sounds tiny — but it runs on every page change, sort change, filter tweak, and pre-fetch. Combined with finding 1 and the cohort-side analogue, it shows up in any flame graph.

**Recommended fix**: Replace the implementation with `structuredClone(value)`. The current call sites are correct (strip reactive proxies) — only the implementation needs to change. Add a fast-path for primitives/`null`.

**Validation**: micro-bench in `tests/shared/utils/`. The renderer perf E2E will pick up case-switch / filter-apply micro-improvements.

---

### 3. HIGH — Hidden FilterToolbar+VariantTable runs filter-options & tag loads when Shortlist is the default tab

**Files**: `src/renderer/src/views/CaseView.vue:360-394`, `src/renderer/src/composables/useFilterLifecycle.ts:80-94`, `src/renderer/src/composables/useFilterOptionsCache.ts:110-167`

**Evidence**: `CaseView.vue:360` keeps the per-type region rendered with `v-show="selectedVariantType !== 'shortlist'"`. The component is mounted, so all its lifecycle hooks fire. `useFilterLifecycle.ts:80-94` calls `loadFilterOptions(newCaseId)` immediately on case-id change without checking visibility. `useFilterOptionsCache.loadFilterOptionsAndTags` performs two parallel IPC calls (`getFilterOptions` + `loadTags`).

`getFilterOptions` triggers `VariantRepository.getAllColumnMetas` (`src/main/database/VariantRepository.ts:448-530`), which runs a wide `COUNT(DISTINCT col)` over **every** sortable base column plus a UNION ALL over low-cardinality columns — a full table scan keyed on `case_id`. On a WGS case with hundreds of thousands of variants this is the slowest single read in the case-open flow. The user does not see any of it when the default tab is `shortlist`.

The 2026-05-06 review identified this hidden-preload problem in finding 6 and recommended deferring or idle-scheduling. The active code does not yet defer.

**Why it matters**: 100% of the cost is paid for users on `defaultCaseTab='shortlist'` (the documented default). The cost falls on the same SQLite worker the shortlist itself uses, so visible Shortlist data is delayed waiting for hidden FilterOptions metadata.

**Recommended fix** (small): gate `loadFilterOptions(newCaseId)` on a `visible` ref pushed down from CaseView. When the Shortlist tab is active, only call `loadFilterOptions` on the first transition to the per-type region (use `onActivated`/visibility watcher rather than the case-switch watcher). Tag loading is cheap and can stay eager.

**Recommended fix** (better): introduce a `requestIdleCallback`-style scheduler for "warm" loads so that the hidden FilterOptions fetch is queued behind the Shortlist's own IPC traffic.

**Validation**: extend `renderer-perf-phase1.e2e.ts` with a `case-switch (Shortlist default)` flow that measures Shortlist time-to-first-row. Should improve materially.

---

### 4. HIGH — SQLite column-meta scan re-walks every base column on every case switch

**File**: `src/main/database/VariantRepository.ts:448-530` (`getAllColumnMetas`)

**Evidence**: The single-aggregate query selects `COUNT(DISTINCT "col") AS cnt_<key>` for **every** entry in `BASE_SORTABLE_COLUMNS` — currently 21 columns — over `WHERE case_id = ?`. SQLite cannot use a leaf-page-only scan for `COUNT(DISTINCT)` and must hash-deduplicate each column. The follow-up `UNION ALL` issues another scan per low-cardinality column to collect distinct values.

This is fine on a 5,000-variant case (sub-50 ms). On a 200,000-variant case it dominates the case-switch flow. The result is cached in the renderer LRU after the first run, so it is amortized for revisits — but every fresh case pays it.

Adjacent finding: the index `idx_variants_type_case ON (variant_type, case_id)` (`migrations.ts:1429`) has the **wrong column order** for this query pattern. Every read in `getAllColumnMetas`, `getVariantTypeCounts`, `getVariantTypesPresent`, and `getFilterOptions` filters by `case_id` first. With `(variant_type, case_id)` the planner must either full-scan or use the index for narrow `variant_type=X` queries only. A `(case_id, variant_type)` index would also serve `getVariantTypeCounts(caseId) … GROUP BY variant_type` directly.

**Why it matters**: case-open latency on large cases. Combined with finding 3, both the visible (`typeCounts`) and hidden (`getFilterOptions`) reads compete for the same worker connection.

**Recommended fix**:

- Add `idx_variants_case_type ON variants(case_id, variant_type)` (the inverse direction) — leaves the existing index in place for any narrow variant_type-first reads.
- Split `getAllColumnMetas` into two passes: cheap fields (numeric MIN/MAX, fixed enums like `consequence`/`clinvar`/`func` which already have ANALYZE statistics) computed eagerly; high-cardinality fields (gene_symbol, transcript, cdna, aa_change) deferred and computed lazily by `getColumnMeta(scope, columnKey)` only when a user opens the per-column filter menu. The lazy code path already exists (`getColumnMeta`) — the change is to stop pre-computing the heavy columns in the bulk path.
- Alternative: drop the per-column distinct-value pull for columns where `distinctCount > DISTINCT_THRESHOLD` (50) and use only the lightweight aggregate. The lazy `getColumnMeta` handles the per-column drill-down.

**Validation**: case-switch perf E2E on a synthetic 100k-variant case, before/after. SQLite `EXPLAIN QUERY PLAN` on the aggregate select.

---

### 5. HIGH — PostgreSQL `pool.query(text, params)` uses no named/server-prepared statements

**Files**: every file under `src/main/storage/postgres/` (189 `pool.query` call sites verified by grep). Representative: `PostgresVariantReadRepository.ts:329`, `:363`, `:393`, `:413`, `:478`, `:507`, `:524`.

**Evidence**: every read call is `await this.pool.query(text, params)`. The `pg` driver promotes a query to a server-side prepared statement only when the call passes a `name:` field on the query config object. Without it, every read incurs full parse + analyze + plan on the PostgreSQL side.

For VarLens this is felt most on:
- Cohort browse (multiple `pool.query` calls per page),
- Annotation batch lookups (no batched `IN`-list version yet on the PG side; see finding 1's analog),
- `getColumnMeta` calls fired by the renderer filter UI as menus open.

For WGS query budgets (see `.planning/docs/postgresql-wgs-query-budgets.md`) parse-and-plan latency is non-trivial on plans that touch `variants` + GIN indexes + extension joins.

**Why it matters**: this is the single highest-leverage change for the Postgres read path. Named prepared statements turn the per-call cost into a one-time-per-connection cost; combined with the existing pool, that means parse-once-per-connection-per-query-shape.

**Recommended fix**: wrap repeated query shapes in a small helper that always supplies `name: 'variant_type_counts:v1'` etc. Bump the `v1` suffix when the SQL changes. Concrete starting list (highest-frequency):

- `variants:typeCounts`, `variants:typesPresent`, `variants:geneSymbols`
- `variants:columnMeta` numeric and categorical variants
- The COUNT/data pair in `queryVariants`
- `annotations:*` reads
- `cohort:carriers`

`pg`'s `connectionParameters.statement_cache_size` is unbounded by default and OK to leave alone.

**Validation**: opt-in `VARLENS_RUN_WGS_QUERY_PERF=1` perf script already exists. Compare named vs ad-hoc on the same query corpus.

---

### 6. MEDIUM — DbPool workers re-prepare statements on every IPC call

**Files**: `src/main/workers/db-worker.ts`, `src/main/workers/db-worker-dispatch.ts:112-180`

**Evidence**: each worker spins up its own SQLite connection (`db-worker.ts:29`), but the dispatcher calls into `repos.variants.getVariants(...)` which constructs a fresh Kysely query, `compile()`s it, then `db.prepare(sql).get(...)` — *not* a cached statement. Only `CohortService` (`cohort.ts:75`) maintains a `statementCache`. `VariantRepository.getVariants` calls `this.db.prepare(countSql).get(...)` *twice* per request (count + data), each with a fresh prepare.

Worker threads benefit from statement caching even more than the main thread because each worker holds its own connection. Better-sqlite3 prepare is fast (~100 µs) but on a Piscina rotation each worker re-pays that cost.

**Why it matters**: a 50-row page request fires the count and data SELECTs (`getVariants`), plus the annotation batch's `3 × 50` queries (finding 1), plus the per-column filter mode loads when a user opens a column header. With the suggestion in finding 1 the per-row cost vanishes, but the count/data prepares remain.

**Recommended fix**: extract `CohortService.getStatement` into a small `PreparedStatementCache` mixin/helper used by `VariantRepository` and `AnnotationRepository`. Cap the cache (LRU, size 64). Statement objects can be reused across query parameter sets — only the SQL text needs to match.

Also reuse: `VariantFilterBuilder.build` reuses the case-count subquery via a local `totalCaseCount` variable (line 140-148) — that pattern is good and should be replicated for FTS query plans.

**Validation**: integration test that the same `variants:query` filter shape compiles to the same SQL string, then assert `db.prepare` is hit only once across repeated calls in the same worker. Pair with the perf E2E.

---

### 7. MEDIUM — PostgreSQL queries miss BRIN/GIN opportunities; jsonb info_json is plain TEXT

**Files**: `src/main/storage/postgres/migrations/sql/0003_create_variants.sql`, `0004_generated_search_documents.sql`

**Evidence**:

- `info_json TEXT` (line 32) — never typed as `jsonb` despite the column carrying parsed VEP/SnpEff INFO blobs. JSONB indexing (`USING GIN(info_json jsonb_path_ops)`) would enable cheap path filters once the renderer exposes them; the May 2026 cohort UI already has plans for that.
- The variants table has B-tree indexes only. `pos` is monotonically growing per case and per chromosome — a perfect BRIN candidate for `(case_id, chr, pos)` on a WGS-sized table.  BRIN is 1-2 orders of magnitude smaller than the equivalent B-tree and is ideal for the range queries panel intervals produce (`pos BETWEEN ? AND ?`).
- The `coord_hash`-keyed cross-case index (`idx_variants_coord_hash_case`, line 143) is excellent for variant-frequency joins. No equivalent improvement is needed there.
- For panel-interval queries the OR-chain pattern emitted by SQLite (`VariantFilterBuilder.ts:374-388`) has no PostgreSQL equivalent; the PG side currently relies on the `(case_id, chr, pos)` B-tree alone. A BRIN index on `(chr, pos)` would let the planner consider a bitmap scan.

**Why it matters**: WGS query budgets are the gating concern of the postgres parity track. BRIN is the cheapest WGS-friendly index change; jsonb conversion is more invasive but unlocks future filter UIs.

**Recommended fix**:

- Add `CREATE INDEX idx_variants_pos_brin ON variants USING BRIN (chr, pos) WITH (pages_per_range = 16);` in a new migration. Measure with the existing query benchmark harness.
- Convert `info_json` to `jsonb` in a separate, gated migration with explicit performance evidence; defer until a renderer feature actually filters on it.

**Validation**: opt-in `VARLENS_RUN_WGS_QUERY_PERF=1` panel-interval queries; compare WGS query budgets doc thresholds before/after.

---

### 8. MEDIUM — Import worker rebuilds FTS twice per file (per-file + per-session)

**Files**: `src/main/workers/import-pipeline.ts:247-266` (`finishBulkInsert`), `src/main/workers/import-worker.ts:252` (`rebuildFts(db)`)

**Evidence**: in multi-file import, the worker calls `stmts.finishBulkInsert(caseId, variantCount)` inside the per-file loop (line 185), which runs `INSERT INTO variants_fts(variants_fts) VALUES('rebuild')` and `db.exec(createFTSTriggers)`. **Then**, after all files are done, `rebuildFts(db)` is called at line 252 — a second rebuild, plus presumably re-`ANALYZE`. The session-level `DROP_FTS_TRIGGERS` at line 42 already removed the triggers; the per-file `finishBulkInsert` immediately recreates them, so the next file pays per-row trigger overhead.

In single-file imports the per-file rebuild + the session-end rebuild are exactly redundant.

**Why it matters**: FTS rebuild on a large dataset is many seconds. Doing it `(N+1)` times for `N` files in a batch import is concretely worse than doing it once at the end.

**Recommended fix**: leave triggers down for the entire session; do **not** call `finishBulkInsert`'s `rebuild` / `createFTSTriggers` per file. Update `variant_count` per case still happens per file (correct). Only the session-end `rebuildFts` + `restoreFtsTriggers` should rebuild and restore.

`VariantRepository.finishBulkInsertNoCount` (`VariantRepository.ts:183-211`) already handles this correctly when used as `beginBulkInsert` → many `insertBatch` → single `finishBulkInsertNoCount`. The bug is in the worker's reuse pattern.

**Validation**: timing test importing 5 medium VCFs back-to-back, before/after. Should drop multi-file import wall time materially.

---

### 9. MEDIUM — `getVariantTypesPresent` and `getVariantTypeCounts` fire for every case open but only `typeCounts` is consumed

**Files**: `src/renderer/src/views/CaseView.vue:111-117` (`loadTypeCounts`), `src/main/database/VariantRepository.ts:292-307`, `:703-713`

**Evidence**: `CaseView.loadTypeCounts` only calls `api.variants.typeCounts(caseId)` — it never calls `typesPresent`. But the `typesPresent` IPC handler and worker dispatcher are wired up identically (`variants-logic.ts:329-354`), so there are *two* parallel implementations of "what variant types does this case have". `getVariantTypeCounts` already returns the answer (any key with `count > 0`); `getVariantTypesPresent` is redundant for the case-level case.

Cohort code does call `typesPresent` for cohort scope. So the function isn't dead — just one of its callers is overly chatty.

**Why it matters**: small but real — every cohort-tab open also hits `typesPresent` (a `SELECT DISTINCT … WHERE case_id IN (…)`), which is the second-most-expensive read after the column meta scan. If the cohort UI already has cohort summary data, it can derive the type set from there.

**Recommended fix**: in the cohort path, derive `typesPresent` from the cohort summary's already-loaded variant rows or from a single `SELECT variant_type, COUNT(*) FROM cohort_variant_summary GROUP BY variant_type`. Keep the per-case `getVariantTypeCounts` as the source of truth — it returns both counts and presence in one query.

**Validation**: count IPC calls during cohort open via the perf harness; should drop by one per open.

---

### 10. LOW — `idx_variants_type_case` direction mismatch (also called out in finding 4)

**File**: `src/main/database/migrations.ts:1429`

Statement: `CREATE INDEX IF NOT EXISTS idx_variants_type_case ON variants(variant_type, case_id)`. Should be `(case_id, variant_type)` to match how the query planner needs to use it (every consumer filters `case_id` first).

The covering index `idx_variants_filter_covering ON variants(case_id, consequence, func, clinvar)` (v5 migration) does NOT include `variant_type`, so even with that helper SQLite cannot satisfy `WHERE case_id = ? AND variant_type IN ('snv','indel')` with an index-only scan.

**Recommended fix**: add `(case_id, variant_type)` and keep the existing index if there are any single-type-first queries (there are not, per grep). Drop the redundant one in a follow-up migration.

---

### 11. LOW — `useOffsetPagination.loadPage` still has the request-generation race the May 6 review flagged

**File**: `src/renderer/src/composables/useOffsetPagination.ts:145-204`

The review explicitly called out: "`useOffsetPagination.loadPage()` commits async results without a request-generation guard". Re-reading the file confirms the issue: between the `await options.fetchPage(...)` and the `items.value = result.data` assignment, no `requestId !== currentId` check exists. If the user rapidly switches sort or filter while the previous fetch is in flight, the older fetch's `.then` can overwrite newer results. The Shortlist path elsewhere is guarded; this path is not.

The serialized `filterKey` watcher (`useVariantData.ts:168-178`) triggers a fresh `invalidateAndReload`, which calls `loadPage` again. The previous in-flight call will still resolve and write `items.value`, but only after the new call's `loadPage` has started, so the *last* assignment wins regardless of which one finished. In normal use this is fine; under contention it is racy.

**Recommended fix**: closure-capture a monotonically increasing `generation` integer at the top of `loadPage`; check it before every state write. Mirror the pattern already used in `useAnnotations.loadAnnotationsBatch` (`useAnnotations.ts:289-318`).

**Validation**: a controlled-promise unit test that simulates fast filter changes; existing pagination tests should be extended.

---

### 12. LOW — `cloneForIpc` runs on the *whole* filter on every prefetch and every page

**File**: `src/renderer/src/components/variant-table/useVariantData.ts:85-96`

Even after replacing JSON.parse/stringify with `structuredClone` (finding 2), the call still happens on every page-flip and on every pre-fetch trigger (the prefetch fires automatically after each successful page load). For a filter set that hasn't changed, the cloned object is identical to the prior call's. Memoize on the upstream `filterKey` (already a serialized JSON string), so that the cloned payload is computed once per filter change and reused for `n` pages of that filter.

This is small but easy.

---

### 13. INFO — `cloneForIpc` also called in FilterToolbar preset save and other places

`grep -rn cloneForIpc src/renderer/src/ | wc -l` ≈ 8 call sites. All are correct (strip reactivity), but the FilterToolbar preset save (`FilterToolbar.vue:460`) and the same pattern in cohort search params are visible candidates for the structuredClone swap. None are hot per-frame paths.

---

## Cross-cutting Recommendations

1. **Make "what the renderer asks for over IPC" cheaper before optimizing what main-process does with it.** Findings 1, 2, 12 are pure IPC-shape fixes — they save the most wall-clock time per change.
2. **Make hidden tabs cost zero unless they are about to become visible.** Finding 3 is the user-perceived case-switch latency win. Pair with the existing perf-trace harness so regressions are caught.
3. **PG read side needs a one-shot named-prepared-statement pass.** Finding 5. Single biggest unblock for WGS query budgets without touching SQL semantics.
4. **SQLite already has a `CohortService.getStatement` pattern — generalize it.** Finding 6 turns it into a shared utility for `VariantRepository` and `AnnotationRepository`.
5. **The column-meta bulk scan should become opportunistic.** Finding 4 splits the eager bulk path into "cheap now, deferred for the rest" and uses the existing per-column lazy path that already works.
6. **Multi-file imports should rebuild FTS exactly once.** Finding 8. Smallest code change with the largest import-wall-clock impact.
7. **The May 6 review's pagination request-id guard (finding 11) is still open.** Worth closing alongside the perf-trace work that's already planned.

---

## What Was NOT Confirmed

- I did not run `make typecheck`, `make test`, or any perf harness. All findings are static-analysis based.
- Postgres `WasmTrapHandlers` / fuse state, electron-builder behavior, and CI workflow paths are out of scope (these were already covered by the 2026-05-06 review).
- I did not measure actual `pool.query` parse-and-plan times on the PG side. The recommendation in finding 5 rests on standard `pg` behavior (named statements → server-prepared), not on a profiled hot path in this codebase.
- The BRIN-index suggestion in finding 7 is theoretical for VarLens's typical workload; needs measurement on a representative WGS case.
- `getVariantTypesPresent` cost claim in finding 9 assumes typical case sizes; on very small cases it's not measurable.
- I did not check `pdbe-molstar` / Mol* lazy loading, which is outside the perf scope this audit was scoped to.
- I did not verify the Postgres COPY/info_json profile path mentioned in AGENTS.md beyond reading the migration files — the existing 1.85× ratio claim and the search_document generated-column architecture were taken as given.
- Whether the `useOffsetPagination` race in finding 11 has ever caused a user-visible bug is unknown; the static issue is real but its empirical frequency is not.
