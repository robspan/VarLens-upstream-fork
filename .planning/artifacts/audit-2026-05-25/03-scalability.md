# VarLens Scalability Audit — 1000-Genome Scale

**Date:** 2026-05-25
**Scope:** Storage, cohort aggregation, import throughput, renderer responsiveness, search,
multi-tenancy, and background-job framework, evaluated against a **1000 WGS case** target
(~5 billion variant rows, ~5 TB of genotype data).
**Method:** Static read of schema, repositories, workers, and the renderer. No code modified,
no `make` targets run. Numbers attributed to perf artifacts are quoted from
`.planning/docs/postgresql-wgs-query-budgets.md` and `AGENTS.md` Phase 16 notes.
**Repo state:** `main` @ `f23709db`.

---

## Executive Summary

VarLens has solid foundations for moderate-scale work: a clean storage facade,
dual SQLite/Postgres backends, a worker-based import pipeline, COPY-based PG ingest, and
server-paginated variant lists. At 1000 WGS, however, **six classes of architecture decisions
that look reasonable today become release-blockers**:

1. **No table partitioning anywhere.** The PG `variants` table is a single heap. At 5 B
   rows / ~3-4 TB it cannot be VACUUMed without weeks of wall time, cannot be ANALYZEd
   incrementally, and one runaway query can scan the whole heap. Today's btree
   `(case_id, …)` indexes balloon to hundreds of GB and stop fitting in
   `shared_buffers=2GB`.
2. **Cohort aggregation diverges by backend in a way that breaks at scale.** SQLite uses a
   pre-computed `cohort_variant_summary` table with incremental add/remove. **Postgres
   has none** — `PostgresCohortRepository.queryVariants` does a live `GROUP BY chr,pos,ref,alt`
   over the whole `variants` table on every cohort page-load
   (`src/main/storage/postgres/PostgresCohortRepository.ts:697-738`). At 5 B rows that is a
   minute-to-hour query, every click.
3. **Imports are strictly serialized.** Both `PostgresImportExecutor`
   (`src/main/storage/postgres/PostgresImportExecutor.ts:30-80`) and the batch path
   (`src/main/import/BatchImportService.ts:79`) take an `inProgress`/sequential lock. With
   the Phase 16.2 number of ~97 s per WGS-HG002 PG import, 1000 imports = ~27 hours
   single-threaded with **no way to parallelize**. The default `VARLENS_PG_POOL_MAX=4`
   would already support a few concurrent COPY streams.
4. **Filter option / column metadata queries are catastrophic at cohort scope.** Both
   backends compute `COUNT(DISTINCT col)` + per-column UNION ALL distinct-value pulls
   without any cache primed at the schema level. The PG cohort `getColumnMeta` even runs
   the grouped 5-B-row CTE twice (`PostgresCohortRepository.ts:378-450`).
5. **GeneBurdenTable and several cohort views render the entire result set.**
   `GeneBurdenTable.vue:4-12` uses non-server `v-data-table`. At 1000 genomes the gene
   burden table is ~20 000 rows; that's renderable but the cohort variant table at
   cohort scope will hit ~50-100 M unique variants — far past anything Vuetify will paint.
6. **No background-job framework.** Long-running imports, rebuilds, and exports each
   reinvent worker dispatch with an ad-hoc `inProgress` flag and an `onProgress` callback.
   There is no queue, no cancel/retry/resume primitive, no persistent job log. Restarting
   the app loses everything in flight.

The good news: the **storage facade is the right boundary**. Most of the work below can be
done behind `StorageSession`/`PostgresCohortRepository` without renderer churn. The work
*is* sprint-sized, but it is multiple sprints.

---

## Findings

### F1 — HIGH — `variants` table is unpartitioned

**Evidence:** `src/main/storage/postgres/migrations/sql/0003_create_variants.sql:4-48` —
the table is a plain `CREATE TABLE`. All five indexes are `btree`s on `(case_id, …)`
(lines 136-143). No `PARTITION BY` clause. `grep -rn "PARTITION" src/main/` returns
no production hits.

**Scaling concern:** 5 B rows × ~250 B/row stored + ~3× index overhead = **~3-4 TB heap, ~6-9 TB
indexes**. PostgreSQL VACUUM on a single 4 TB heap takes days and blocks autovacuum
elsewhere. Adding a new index requires a full rewrite. ANALYZE statistics on a single heap
are approximations of a single distribution — query plans will be wrong for rare
chromosomes.

**Recommendation:**

- **Partition `variants` by `LIST (chr) DEFAULT`** (or `RANGE` on a chromosome ordinal).
  Same for `variant_transcripts`, `variant_sv`, `variant_cnv`, `variant_str`.
  - Per-chromosome partitions are roughly equal-sized (~200 M rows for chr1 down to
    ~10 M for chr22), and almost every variant query is already chr-scoped or
    coord-scoped. Partition pruning will be automatic and large.
  - Use `LIST (chr) DEFAULT` so unknown chromosomes (`chrUn_*`, ALT contigs) still
    land somewhere.
- **Optional second level: sub-partition by `case_id` range** for chr1/chr2 partitions
  that are still too large.
- **`tablespaces` story:** allow the user to put cold partitions (chrY, chrM, unplaced
  contigs) on a slower disk; hot partitions (chr1-7) on NVMe. Not required for v1.

**Validation:** Extend `tests/perf/postgres-vcf-wgs-import.perf.test.ts` to populate at
least 8 cases on a partitioned schema and re-run the existing query-perf harness. Compare
plan cost and wall time on `exact coordinate lookup`, `gene query`, `cohort carrier query`.

---

### F2 — HIGH — `info_json` stored as TEXT, not JSONB

**Evidence:** `src/main/storage/postgres/migrations/sql/0003_create_variants.sql:32` —
`info_json TEXT`. No GIN or `jsonb_path_ops` index. `grep -n "info_json\|jsonb" .../migrations`
shows only the one TEXT declaration.

**Scaling concern:** Annotation back-fills, custom INFO field queries, or any "find variants
where `info_json->>'gnomAD_NFE_AF'` > X" become full table scans. At 5 B rows, full scans
are not an option. A migration to `JSONB` later requires rewriting the entire heap —
expensive. Doing it before partitioning amplifies pain.

**Recommendation:**

- Change the column type to `JSONB` and add `CREATE INDEX … USING GIN (info_json jsonb_path_ops)`
  on the partitioned table.
- For the handful of INFO fields VarLens actually queries on, prefer **STORED generated
  columns** (same pattern as `search_document` in
  `migrations/sql/0004_generated_search_documents.sql`) so the hot path stays btree-indexable.

**Validation:** Add to `tests/perf/postgres-wgs-query.perf.test.ts` an INFO-JSON range
query budget. Show it fails on TEXT, passes on JSONB+GIN.

---

### F3 — HIGH — No BRIN index on genomic coordinates

**Evidence:** `migrations/sql/0003_create_variants.sql:136-143` — only btree composites
involving `case_id`. No `CREATE INDEX … USING BRIN (chr, pos)` and no
`(pos)`-only index.

**Scaling concern:** `pos` is monotonic within a chromosome when imports are ordered by
input VCF (which is the norm). A BRIN index on `(chr, pos)` would be a few hundred KB,
fit entirely in cache, and accelerate range queries (gene-region scans, panel queries,
VEP look-ups). Without it, range queries either hit the heavy `(case_id, chr, pos)`
btree or scan the entire heap.

**Recommendation:** Add `CREATE INDEX idx_variants_chr_pos_brin ON variants USING BRIN
(chr, pos) WITH (pages_per_range = 32)` per partition. Combine with F1 partitioning so
the BRIN ranges are already chr-scoped.

**Validation:** Per the existing `postgresql-wgs-query-budgets.md` harness, the
`gene query` budget is 1.5 s. Today's number is 152 ms but with no annotation rows. Add
a populated-annotation rerun showing BRIN improves plan stability under cohort scope.

---

### F4 — HIGH — Postgres cohort aggregation has no summary table

**Evidence:** `src/main/storage/postgres/PostgresCohortRepository.ts:697-738` builds a
live `GROUP BY chr,pos,ref,alt` over `variants` on every cohort page request, including
window-function-free `COUNT(DISTINCT v.case_id)` and HET/HOM filters. SQLite uses
`cohort_variant_summary` populated by `CohortSummaryService` (`src/main/database/CohortSummaryService.ts`)
with **incremental add/remove** primitives (`shared/sql/cohort-summary-rebuild.ts:134-194`).

**Scaling concern:** At 1000 cases × 5 M variants = 5 B rows, the live GROUP BY is at
minimum tens of seconds and at worst many minutes — once per cohort interaction (filter
change, page change, sort change, column-meta refresh). The Phase 16.2 cohort carrier
query at 4 cases was already 3.0 s on a single-coord lookup.

**Recommendation:**

- **Materialize `cohort_variant_summary` in Postgres** behind the same shared SQL contract,
  partitioned by `chr` so incremental upserts are partition-local.
- **Switch to incremental maintenance** matching the SQLite path: `INCREMENTAL_ADD_SQL`
  fires post-import per case, `INCREMENTAL_REMOVE_SQL` pre-delete.
- For the **carrier-count / cohort_frequency** aggregates, consider a
  **PG 13+ materialized view** with `REFRESH MATERIALIZED VIEW CONCURRENTLY` as a
  fallback when the incremental path drifts.
- The existing `rebuild-summary-worker.ts` pattern (off-thread, progress-emitting
  worker) generalizes cleanly to PG via a `pg` `Client` and the same shared SQL.

**Validation:** Build a `tests/perf/postgres-cohort-summary.perf.test.ts` with a 100-case
seed and assert page-load < 500 ms cold, < 50 ms warm. Compare against today's SQLite
times.

---

### F5 — HIGH — Imports are strictly serialized; no concurrent workers

**Evidence:**

- `src/main/storage/postgres/PostgresImportExecutor.ts:30-80` — single `inProgress` flag
  with `throw new Error('An import is already in progress')`.
- `src/main/storage/sqlite/SqliteImportExecutor.ts:112,220` — same guard for SQLite.
- `src/main/import/BatchImportService.ts:79-93` — single `for` loop, file-by-file,
  awaiting `importService.importVariants` each time.
- `src/main/storage/config.ts:31` — `DEFAULT_PG_POOL_MAX = 4` but only one worker
  uses the pool.

**Scaling concern:** Phase 16.2 number: **97.28 s per HG002 WGS import on PG**. 1000 cases
sequential ≈ **27 hours**. On a typical workstation with 8-16 cores and a fast SSD,
**4-8 concurrent COPY streams** should bring this to 4-7 hours (close to SSD
write-bandwidth bound, not CPU bound). The pool is already sized for 4 connections.

**Recommendation:**

- For **PG**: lift the `inProgress` lock and spawn a pool of N=`min(poolMax-1, cpuCount)`
  postgres-import-worker threads, dispatched round-robin from `BatchImportService`. Each
  worker owns its own COPY stream against its own dedicated PG connection. Reserve one
  pool slot for read traffic so the UI does not stall during bulk import. Add a queue
  in front so the rest of the queue is observable / cancellable.
- For **SQLite**: concurrency is bounded by the single writer lock, but **parsing and
  mapping** are CPU-bound and can run in parallel. Have N parser workers feed one
  serializer that drains into the writer. Realistic 2-3× improvement on parse-heavy
  formats (VEP-annotated VCFs).
- Document the per-worker memory cost so the user-visible default is conservative.

**Validation:** Extend the existing gated `VARLENS_RUN_WGS_PERF` harness to import N=4
files concurrently; assert wall-time < 1.4× single-file wall time at N=4 (target:
≥ 2.5× throughput).

---

### F6 — HIGH — Filter-options / column-metadata catastrophic at cohort scope

**Evidence:**

- `src/main/database/VariantRepository.ts:448-530` — `getAllColumnMetas` builds a
  multi-`COUNT(DISTINCT)` aggregate over the *whole* `variants` table at case scope. The
  per-case path is fine. **The cohort path at multi-case scope** (`getBaseColumnMeta` line
  561, called with `{ caseIds: [...] }`) scans `variants WHERE case_id IN (?, ?, …)`. At
  1000 cases that includes the entire 5-B-row table.
- `src/main/storage/postgres/PostgresCohortRepository.ts:378-450` — `getColumnMeta`
  *first* runs the entire `buildGroupedSelect` once for `COUNT(DISTINCT)`, *then* a
  second time inside a `WITH MATERIALIZED` CTE for low-cardinality distinct values.
- `getColumnMeta` is cached in-process (`columnMetaCache`) but invalidated on any
  cohort change (and the SQLite path explicitly invalidates on summary rebuild —
  `cohort.ts:451`).

**Scaling concern:** Opening the cohort filter drawer at 1000-genome scope would fire a
~5 B-row grouped scan, twice. At 5 ms/100 K rows that's ~5 minutes — and it blocks the
drawer from rendering. Once invalidated (e.g. a new case imported), the next open pays
this again.

**Recommendation:**

- Move column-metadata computation into the cohort summary refresh path (see F4) and
  materialize it as `cohort_column_meta`:
  `(scope_key, column_key, distinct_count, min, max, distinct_values_json)`.
- For the case view, the per-case cost is bounded (≤5 M rows / case), so keep it as-is
  but ensure the per-extension `getExtensionColumnMeta` query
  (`VariantRepository.ts:631-696`) carries a `LIMIT` or `EXISTS`-trim path for
  high-cardinality columns.
- Add **statement_timeout** guards (already configured in `config.ts:117` at 30 s) so
  a runaway metadata query cannot wedge the UI.

**Validation:** Add a perf test `tests/perf/cohort-column-meta.perf.test.ts` that
asserts `getColumnMeta()` < 200 ms warm, < 2 s cold at 100-case scope. Add an artifact
under `.planning/artifacts/perf/postgres-query/`.

---

### F7 — MEDIUM — Case list is server-paginated but not virtualized

**Evidence:** `src/renderer/src/components/CaseList.vue:45-100` uses `v-infinite-scroll`
with `PAGE_SIZE` server pages (good) but renders accumulated cases into a `v-list`
without virtualization (lines 69-100). `grep "v-virtual-scroll"` in the renderer only
matches `LogViewer.vue`.

**Scaling concern:** Scrolling to case #1000 keeps all 1000 `v-list-item` instances mounted.
Vuetify list-item is heavy (chips, icons, slots). The DOM holds 1000 × ~30 nodes ≈ 30 K
DOM nodes — that hits Vue/Vuetify reactivity thresholds, scrolling visibly stutters,
and search/filter resets re-render the whole list.

**Recommendation:**

- Swap `v-list` inside `v-infinite-scroll` for `v-virtual-scroll`. Vuetify supports it
  with the same item-slot shape; the infinite-scroll wrapper can be kept for page
  fetching.
- For multi-select operations on huge case sets ("apply panel to all 1000 cases"),
  switch from `Set<caseId>` to a **server-side filter spec** so the renderer never
  enumerates the whole id set.

**Validation:** Add a Playwright perf test under `tests/e2e/` that opens a 1000-case
fixture and scrolls to the bottom; assert FPS > 30 and DOM node count < 1500.

---

### F8 — MEDIUM — GeneBurdenTable is not server-paginated

**Evidence:** `src/renderer/src/components/GeneBurdenTable.vue:4-12` — `v-data-table`
(not `-server`), data fetched via `api.cohort.getGeneBurden()` returning the entire result
(`cohort.ts:435-445`). The PG path
(`PostgresCohortRepository.ts:355-376`) returns the whole gene burden in one round trip.

**Scaling concern:** At 1000 genomes the gene-burden table is ~20 K-25 K genes. Renderable,
but the underlying PG query is a `GROUP BY gene_symbol` over 5 B rows on every cohort
load. SQLite reads from `gene_burden_summary`; PG does it live. Cost: minutes at 1000-genome
scale.

**Recommendation:**

- Mirror the SQLite `gene_burden_summary` materialization in PG (see F4).
- Convert `GeneBurdenTable.vue` to `v-data-table-server` with sort/filter pushed to
  the backend.
- Add a "min affected cases" pre-filter so the default view trims the long tail of
  single-carrier genes.

**Validation:** Same harness as F4; assert burden load < 500 ms warm at 100-case scope.

---

### F9 — MEDIUM — Search latency budgets not validated at 1000-genome scale

**Evidence:** `migrations/sql/0004_generated_search_documents.sql:99-124` adds GIN
indexes on STORED `search_document tsvector`. `postgresql-wgs-query-budgets.md:38` shows
text-search at 695 ms p95 against an unannotated 4-case fixture, marked "unavailable"
because annotation fields are empty.

**Scaling concern:** GIN over a 5-B-row table is ~50-200 GB. Cold-cache queries will be
slow even with the index. Combined with no partitioning (F1), search times will degrade
non-linearly with corpus size.

**Recommendation:**

- After F1 partitioning, **make each partition's GIN index local** (PG handles this
  automatically with `CREATE INDEX ON … USING GIN` on the partitioned parent).
- Validate the existing text-search budget (≤3 s p95) against a 100-case
  **annotated** fixture before declaring readiness. The current artifact explicitly
  cannot.
- Consider adding `pg_trgm` GIN indexes for gene-symbol-prefix search (HGVS-style
  partial input) as a separate column.

**Validation:** Extend `tests/perf/postgres-wgs-query.perf.test.ts` to use a
VEP-annotated WGS fixture (one already exists in `tests/test-data/vcf/`, just needs to
be replicated to scale). Re-run text-search budget.

---

### F10 — MEDIUM — Multi-tenancy / project sharding model not designed for scale

**Evidence:** `src/main/services/DatabaseManager.ts:152-196` — `switchDatabase` closes
the current session and opens the new one. SQLite is per-file; PG is per-schema (see
`config.ts:DEFAULT_PG_SCHEMA = 'public'`). `RecentDatabasesService` keeps a list. There
is no model of "project A" + "project B" co-resident with isolated cohort caches.

**Scaling concern:** A user running "project A: 1000 trios" and "project B: 200
singletons" must close one to look at the other. Switching does a full session
teardown and rebuild — losing the warm pool, the prepared-statement cache, and any
in-flight worker. For SQLite, switching mid-import is illegal (the inProgress flag is
per-session). There is no design hook for cross-project queries (e.g. "is this variant
seen in any of my last 5 projects?").

**Recommendation:**

- Treat **PG `schema` as the project boundary** and allow the manager to hold N hot
  sessions, one per project, with shared pool config but isolated cohort caches.
- For SQLite, allow `ATTACH DATABASE` for cross-project read-only queries; reject
  cross-project writes.
- Make the renderer aware of "active project" vs "visible projects" so cohort widgets
  can render aggregates across multiple projects when the user explicitly opts in.
- This is the right time to introduce a **`projects` registry** with metadata
  (description, default genome build, owner) instead of treating each DB file as
  ad-hoc.

**Validation:** No perf harness needed; design-doc deliverable. Add an architecture
test that asserts `DatabaseManager` holds ≥ 1 session and `switchDatabase` does not tear
down the pool.

---

### F11 — HIGH — No background-job framework

**Evidence:**

- Each long-running task has its own `inProgress` flag, its own progress callback shape,
  and its own cancellation token: `PostgresImportExecutor`, `SqliteImportExecutor`,
  `rebuild-summary-worker.ts`, `delete-worker.ts`, `export-worker.ts`, `BatchImportService`.
- `RebuildWorkerResponse` (`rebuild-summary-worker.ts:46-55`) is bespoke.
- No persistent job log. App restart loses everything in flight.
- `audit_log` (`migrations/sql/0006_create_audit_log.sql`) only logs *user actions*,
  not background jobs.

**Scaling concern:** At 1000-genome scale, every routine action is a job: bulk import (hours),
cohort summary rebuild (minutes), full export (minutes), enrichment back-fill (hours),
annotation refresh (hours). Without a job framework:

- The user has no system-wide "what is running" view.
- Crash-restart loses in-flight imports (they don't checkpoint).
- There is no way to **queue** "import these 1000 VCFs overnight" with cancel/resume.
- There is no way to **retry** the 7 files that failed in a batch without re-running
  the 993 that succeeded (today's `BatchImportService.processBatch` already has the
  result detail to support this — but no UI uses it).

**Recommendation:**

- Introduce a **`Job`** primitive: `{id, kind, params, status, progress, error,
  created_at, started_at, finished_at, cancelled_at}` stored in a
  `jobs` table (SQLite *and* PG) per session.
- Build a thin **`JobRunner`** service in `src/main/services/jobs/` that wraps worker
  dispatch with: enqueue, claim, progress-update, heartbeat, cancel, retry. Workers
  publish status via a single typed IPC channel (`jobs:progress`).
- Render a global "jobs drawer" in the renderer that subscribes once and shows all
  in-flight + recent jobs across imports, rebuilds, exports.
- Sequence the rollout: (1) abstract over existing import + rebuild + export workers
  with no behavior change; (2) add persistence and resume; (3) add concurrency control
  (F5) and queue management.

**Validation:** Add a Vitest integration `tests/main/services/jobs/JobRunner.test.ts`
that asserts crash-restart resumes a partially-imported batch from the failed file.

---

### F12 — LOW — Minor: `coord_hash` is sha256

**Evidence:** `migrations/sql/0003_create_variants.sql:39-47` — `coord_hash BYTEA
GENERATED ALWAYS AS (digest(... 'sha256') STORED)`.

**Scaling concern:** SHA-256 is overkill for a coordinate hash (no adversarial input,
no collision-attack vector). At 5 B rows the digest computation alone is ~30 minutes
of import wall time, plus ~160 GB of stored hash. xxhash3 or murmur3-128 would be
~10× faster and half the size.

**Recommendation:** Defer — sha256 is correct, just slow. Revisit only if the F1+F5
fixes are landed and digest is on the import critical path.

**Validation:** Profile under `VARLENS_PG_IMPORT_PROFILE=1` after F5; if `digest` is
> 10% of wall time, swap.

---

## Architectural Roadmap for 1000-Genome Scale

The work is bigger than one phase. Sprint-sized chunks, in dependency order:

### Sprint A — "Foundations" (2-3 weeks)
- **F11 JobRunner skeleton** (no behavior change, just abstraction over today's workers).
- **F10 Multi-project model** (design doc + `projects` registry; no UI change yet).
- **F4 PG cohort_variant_summary** materialization with incremental add/remove. This is
  the unblocker for everything downstream — without it, cohort queries are O(5 B) on
  every click.
- **F6 cohort_column_meta** materialized alongside F4.

**Exit criterion:** PG cohort page-load < 500 ms warm at 100 cases (PG only). All
existing tests green. New perf artifact filed.

### Sprint B — "Storage shape" (3-4 weeks)
- **F1 Partition `variants`, `variant_transcripts`, `variant_sv/cnv/str`** by
  `LIST (chr) DEFAULT`. Migration is destructive in dev (already done for prior
  migrations); shipping path needs a one-time rewrite.
- **F2 `info_json` → JSONB** + GIN index, behind the partition rewrite to avoid a
  second rewrite.
- **F3 BRIN(chr, pos)** per partition.
- **F8 PG gene_burden_summary** + convert `GeneBurdenTable.vue` to server pagination.

**Exit criterion:** Re-run the existing WGS query perf harness on the 8-case fixture;
all five budgets pass with 25% margin. New artifact under
`.planning/artifacts/perf/postgres-query/`.

### Sprint C — "Throughput" (2 weeks)
- **F5 Concurrent imports** with PG worker pool. Single `inProgress` lock becomes a
  queue served by N workers.
- Cancel-resume on top of the F11 JobRunner.
- **F12 hash swap** if profile justifies.

**Exit criterion:** 1000 GIAB HG002 imports complete in < 8 h on the dev workstation.
WGS perf artifact comparison shows ≥ 2.5× speedup at N=4.

### Sprint D — "Renderer / UX" (2 weeks)
- **F7 CaseList virtualization** (`v-virtual-scroll`).
- **F9 Search budget validation** on annotated WGS fixture.
- Global job drawer (renderer half of F11).
- "Apply to all" → server-side filter spec instead of id enumeration.

**Exit criterion:** Playwright perf E2E covers a 1000-case fixture with FPS > 30 on
scroll, and a 100-case cohort page-load < 1 s end-to-end.

### Sprint E — "Multi-tenancy polish" (1-2 weeks)
- Finish F10 implementation: hot session pool, project picker UI, optional cross-project
  read-only queries.

**Total:** ~10-13 weeks of focused engineering. The Sprint A→C path is the critical one
for the 1000-genome target; Sprints D-E are quality-of-life improvements that follow
naturally.

---

## What Was NOT Confirmed

These are gaps in the audit that the user should validate before committing to the
roadmap above:

- **Actual 1000-case import wall time on PG.** Phase 16.2 number is from a single HG002
  fixture and is dominated by the COPY wire protocol vs SQLite in-process call overhead.
  The 27-hour extrapolation assumes linear scaling; in practice variant_frequency
  upsert contention and autovacuum noise will get worse with corpus size. A 100-case
  measurement would calibrate the F5 sprint estimate.
- **PG VACUUM and bloat behaviour at TB scale.** No artifact in the repo measures
  `pg_stat_user_tables.n_dead_tup` after a full import-delete cycle. Before partitioning
  is shipped, run a delete-50-cases-then-vacuum experiment to confirm the diagnosis.
- **Renderer behaviour at scale.** No 1000-case test fixture exists today
  (`tests/test-data/vcf/` is the chr22 GIAB Chinese Trio). All renderer concerns above are
  theoretical until measured. Sprint D should start with a fixture builder.
- **`info_json` query pattern survey.** Unknown how often users actually query
  custom INFO fields. If the answer is "almost never", F2's GIN index is overkill — a
  STORED generated column per documented INFO field would be enough.
- **Multi-user / network DB scenarios.** AGENTS.md states "no backend service — all
  data stays on the user's machine". Some 1000-genome customers will want shared PG
  on a NAS or cloud VM. That changes the threat model (auth, audit, RLS) and the pool
  sizing decisions in F5. Out of scope for this audit; flag for product review.
- **Encryption + Postgres.** SQLite uses `better-sqlite3-multiple-ciphers`. PG path
  defaults `sslMode=disable`. At-rest encryption on PG is the deployer's responsibility
  (filesystem-level or `pgcrypto`). Decide explicitly whether multi-tenant PG mode
  is in scope.
