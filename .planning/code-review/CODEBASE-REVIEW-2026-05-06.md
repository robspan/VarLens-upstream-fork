# VarLens Codebase Review

Date: 2026-05-06

## Executive Summary

VarLens is in good shape structurally, especially on `origin/main`: the PostgreSQL executor/session work has advanced well beyond the local checkout, and the renderer has already received targeted row-rendering and hidden-view work. Overall rating: **8.2/10**. The main constraint now is not architecture, it is **derived-data lifecycle discipline**: cohort summaries, FTS/search products, import finalization, and freshness metadata are still handled like maintenance tasks rather than online, observable data products. PostgreSQL is close enough to product parity that the remaining risks are now consistency, migration/CI gates, and backend-neutral ownership rather than basic feature absence. Renderer performance should continue from measurement, not by defaulting to virtualization. The largest maintainability issue is IPC contract drift: some renderer APIs are typed as raw values even though the main handlers return `IpcResult`. LLM-assisted development readiness is held back by stale local checkouts, stale comments/docs, and incomplete preflight checks.

## What Was Verified

Reviewed `AGENTS.md`, recent planning reviews, current local tree, and `origin/main`. Important caveat: local `main` was **38 commits behind** `origin/main` (`a8b99e3` local vs `3e181a0` upstream; latest release tag seen: `v0.59.0`). High-severity findings were verified against `origin/main` with `git show origin/main:<path>` where newer code mattered.

Commands/checks run:

- `git status -sb`, `git rev-parse HEAD`, `git rev-parse origin/main`, `git log --oneline --decorate`
- `.nvmrc`, `package.json` engines, `node -v`, `npm -v`, `Test-Path node_modules`
- targeted source inspection across renderer, import workers, cohort rebuild, SQLite FTS, PostgreSQL storage, IPC, Makefile, workflows, perf scripts
- subagent reviews for renderer performance, reindexing/data availability, PostgreSQL/storage, IPC/maintainability, and CI/workflow

Verification limit: `make ci` was attempted but failed before project code ran because `make` was not installed in the PowerShell environment. That shell had `Node v22.21.1` and `npm 10.9.4`, while VarLens requires `Node 24.14.1` and `npm >=11.11.0`; `node_modules` was also absent. This is an environment/tooling issue, not evidence of a code regression. A valid local run needs the pinned Node/npm, then `npm ci`, `make rebuild-node`, `make ci`, and `make rebuild` before app/package work.

## Scorecard

| Area | Rating |
|---|---:|
| Security / Electron boundary | 8.5 |
| Architecture | 8.2 |
| Maintainability | 7.4 |
| Renderer performance | 7.5 |
| Reindexing/data availability | 6.2 |
| PostgreSQL/backend readiness | 8.0 |
| WGS-scale readiness | 7.7 |
| Testability/CI trust | 7.2 |
| Release/supply-chain posture | 8.0 |
| LLM-assisted development readiness | 6.7 |

## Findings

### 1. High: Derived-data freshness is not a first-class contract

Evidence: SQLite multi-file import marks cohort summary stale after appends (`src/main/ipc/handlers/import-logic.ts`), but startup rebuild still only checks "summary empty + variants exist," not `is_stale=1` (`src/main/database/DatabaseService.ts`). Cohort rebuild SQL still rebuilds live summary products with `DELETE FROM cohort_variant_summary` and `DELETE FROM gene_burden_summary` (`src/shared/sql/cohort-summary-rebuild.ts`). Database overview embeds cohort summary data without freshness metadata (`src/main/database/DatabaseOverviewService.ts`).

Why it matters: users can continue querying variants, but cohort frequencies, burden summaries, and overview cards can be stale or rebuilding without a durable, user-visible contract.

Recommended fix: add `background_jobs` and `derived_artifact_state` metadata for products like `cohort_variant_summary`, `gene_burden_summary`, `variants_fts`, and `variant_frequency`. Return freshness metadata from read APIs and show "current / updating using previous index / stale / failed" in cohort and overview UI.

Validation: tests that `cohort:summary`, `cohort:variants`, `variants:query`, and `database:overview` remain usable during rebuild and report freshness; startup test where `is_stale=1` schedules rebuild; cancellation test where previous generation remains active.

### 2. High: SQLite FTS/index rebuilds are still in-place maintenance operations

Evidence: bulk import tears down FTS triggers and later runs `rebuildFts(db)` plus `rebuildCohortSummary(db)` during finalization (`src/main/workers/import-worker.ts`). `VariantRepository.beginBulkInsert()` tears down FTS triggers and `finishBulkInsertNoCount()` rebuilds all FTS indexes, restores triggers, runs `ANALYZE`, and optimizes FTS (`src/main/database/VariantRepository.ts`). Startup schema drift can drop and repopulate `variants_fts` directly (`src/main/database/schema.ts`).

Why it matters: existing committed rows are generally readable under WAL, but search can be stale, finalization is hard to cancel, and large-case query performance can degrade while indexes/triggers are absent.

Recommended fix: move FTS/search rebuilds to side-by-side/shadow artifacts with a short transactional swap. Track freshness separately from cohort freshness. Add cancellation checkpoints around finalization phases.

Validation: E2E/import test that an existing large case remains searchable while another case is importing; FTS freshness test showing new rows appear only after swap; WGS finalization timing and read p95 latency during rebuild.

### 3. High: PostgreSQL import cancellation/failure can leave inconsistent partial data

Evidence: on `origin/main`, PostgreSQL VCF import commits per batch for WGS memory control (`src/main/workers/postgres-import-worker.ts`). In multi-file import, a later file failure rolls back only the current transaction, records that file with `variantCount: 0`, and final case counts use `totalVariantCount`; already committed batches from that failed file can remain. Single-file cancellation can return `caseId: 0` / `variantCount: 0` while committed partial rows may exist.

Why it matters: WGS-scale imports can leave queryable partial cases with wrong `variant_count` or stale frequency data. That is worse than an import failure because it looks successful enough to use.

Recommended fix: define explicit semantics. Either clean up committed rows for failed/cancelled files using `import_file_id`/batch ownership, or finalize partial imports with real case id, counts, frequency rebuild, and visible "partial/cancelled" state. Hide `importing` cases by default until final bookkeeping succeeds.

Validation: forced failure after a committed batch asserts `cases.variant_count = count(variants)` and no orphan rows; cancellation E2E asserts either zero persisted rows or internally consistent partial case/frequency data.

### 4. High: IPC API typing drift can treat `SerializableError` as success data

Evidence: `CaseMetadataDomainContract` returns `IpcResult` for writes/lookups (`src/shared/ipc/domains/case-metadata.ts`), but `WindowAPI.caseMetadata` still types many methods as raw values (`src/shared/types/api.ts`). `RegionFilesDomainContract` is also `IpcResult`, while `WindowAPI.regionFiles` is raw. Renderer code then consumes raw values, e.g. `useCaseMetadata` writes `updated` into cache and `RegionFileImportDialog` uses `created.id`.

Why it matters: `wrapHandler` returns structured error results; if the renderer type says raw success, error payloads can corrupt UI state instead of taking the error path.

Recommended fix: alias `CaseMetadataAPI`, `RegionFilesAPI`, `ImportAPI`, and similar wrapped domains directly to their domain contracts. Unwrap with `unwrapIpcResult` at every renderer edge.

Validation: renderer tests where handlers return `SerializableError` and state is not updated; preload contract test that discovers every `src/shared/ipc/domains/*` contract, not only a small allowlist.

### 5. Medium: IPC runtime validation is uneven on import and worker-control paths

Evidence: database/profile/tag handlers increasingly parse `unknown` with schemas, but import handlers still accept typed runtime payloads for `import:start`, `import:startMultiFile`, `import:vcfPreview`, and `import:vcfMultiPreview` (`src/main/ipc/handlers/import.ts`). Batch import file/zip handlers also take typed arrays/strings directly (`src/main/ipc/handlers/batch-import.ts`). `system:setWorkerThreads` accepts `count: number` and passes it to `Math.floor`, which can produce `NaN` for malformed payloads (`src/main/ipc/handlers/system.ts`, `src/main/ipc/dbPoolManager.ts`).

Why it matters: these are file IO and worker-control entry points. TypeScript annotations do not validate renderer-originating runtime data.

Recommended fix: add Zod schemas for import paths/options, multi-file specs, zip params, and worker-thread count; treat IPC args as `unknown`.

Validation: direct handler tests for invalid payloads returning `SerializableError` and not invoking import/worker logic.

### 6. Medium: Renderer performance has concrete risks, but the next phase needs measurements

Evidence: default `defaultCaseTab` is `shortlist` (`src/renderer/src/stores/settingsStore.ts`), yet `CaseView` keeps the per-type `FilterToolbar` and `VariantTable` mounted under `v-show` (`src/renderer/src/views/CaseView.vue`). `FilterToolbar` loads filter options on mount, and SQLite `VariantRepository.getFilterOptions()` performs broad `COUNT(DISTINCT ...)` metadata scans. `useOffsetPagination.loadPage()` commits async results without a request-generation guard (`src/renderer/src/composables/useOffsetPagination.ts`), unlike the guarded Shortlist query path.

Why it matters: selecting a case into the default Shortlist view can still trigger hidden per-type metadata/table work. Rapid filter/sort/pagination can let slower old requests overwrite newer rows.

Recommended fix: first PR should enable perf-mode trace spans in production perf runs, include trace summaries in `renderer-perf-phase1` artifacts, and add a default-Shortlist workflow. Then defer or idle-schedule hidden per-type preloads and add a request id to `useOffsetPagination`.

Validation: controlled-promise unit tests for stale pagination commits; before/after `renderer-perf-phase1.e2e.ts` artifacts and `compare-phase1.mjs` output. Do not add virtualization by default: current tables already use server pagination and VariantTable row view models are improved.

### 7. Medium: PostgreSQL parity is much improved, but consistency and capability edges remain

Evidence: on `origin/main`, PostgreSQL now has migrations, overview, tags, annotations, comments, panels, presets, analysis groups, export, filter options, and column metadata through executors (`src/main/storage/postgres/PostgresReadExecutor.ts`, `src/main/storage/postgres/PostgresWriteExecutor.ts`). Capabilities are much more explicit (`src/main/storage/postgres/PostgresStorageSession.ts`). Remaining edges include `deleteMany/deleteAll: false`, `cohort.rebuild: false`, legacy search disabled while query search is enabled, and the compatibility escape hatches `getDatabaseService()` / `getDbPool()` still exist but throw for Postgres.

Why it matters: the adapter boundary is now usable, but future work can regress by reaching for SQLite-shaped APIs that still exist in the interface.

Recommended fix: continue removing or narrowing compatibility escapes. Add tests that common app domains do not call `getDatabaseService()` under a Postgres session. Gate unsupported UI operations from capabilities, especially batch/all delete and rebuild.

Validation: Postgres E2E for case open, filters, tags, annotations, panels, export, delete-one, and capability-gated unavailable operations.

### 8. Medium: CI/release gates have narrow but important holes

Evidence: `build.yml` CI aggregator only fails on `failure`, not `cancelled` or unexpected `skipped`; its path filter includes `.github/workflows/build.yml` but not all workflow files. Release extracts the version from tag but does not compare it with `package.json`. Packaged smoke still runs only on Linux. WGS/query perf scripts compute budget status or ratios but do not consistently fail opt-in commands on budget failure.

Why it matters: release confidence is strong, but specific classes of workflow, versioning, platform-launch, and perf regressions can pass.

Recommended fix: make the aggregator require success for required jobs when code changed; include `.github/workflows/**` in the code filter; compare tag version to `package.json`; add minimal macOS/Windows packaged smoke; make opt-in perf compare commands fail on failed budgets.

Validation: workflow test PR touching `release.yml`, synthetic skipped/cancelled matrix case, mismatched tag/package dry run, and seeded failing perf threshold.

## Resolved Since Prior Reviews

- PostgreSQL COPY import and generated `search_document` are shipped; the old per-batch bulk-update search path is gone.
- PostgreSQL migration lifecycle now exists with `schema_migrations`, advisory lock, transactional migration, and rollback handling (`src/main/storage/postgres/migrations/PostgresMigrationRunner.ts`).
- PostgreSQL executor parity moved substantially forward on `origin/main`: overview, tags, annotations, comments/metrics, panels, presets, analysis groups, cohort reads, export, filter options, and column metadata are now routed through storage executors.
- Renderer table work is not an obvious virtualization problem: VariantTable and CohortDataTable use server pagination, and VariantTable now has row view-model and stable render-row caching.
- The domain-module IPC rollout is mostly complete; remaining flat handlers are documented as legacy.
- GitHub Actions are SHA-pinned with tag comments, and release still gates on the Build workflow passing for the tagged SHA.

## Revised Priorities

1. **Make rebuilds online and observable.** First PR: expose cohort/overview freshness metadata, schedule rebuild when `is_stale=1`, and show stale/building UI state.
2. **Fix import consistency before deeper perf tuning.** First PR: PostgreSQL failed-file/cancel cleanup or explicit partial-import state, with count/frequency invariants.
3. **Repair IPC contract drift.** First PR: alias `CaseMetadataAPI` and `RegionFilesAPI` to domain contracts and unwrap renderer calls.
4. **Choose renderer perf work from traces.** First PR: perf-mode trace spans plus default-Shortlist workflow; then fix hidden preload and stale pagination if confirmed.
5. **Keep PostgreSQL parity backend-neutral.** First PR: tests that Postgres app workflows do not touch `DatabaseService` escape hatches; gate unsupported batch/all delete.
6. **Tighten CI and agent preflight.** First PR: fail fast on wrong Node/npm/missing make or behind-upstream checkout, and fix release tag/package-version check.

## Bottom Line

Next work should start with **derived-data freshness/job state** and **PostgreSQL import consistency**, because those directly affect whether users can trust data while the app is rebuilding or importing. Do not start a rewrite, and do not jump to virtualization or binary COPY work until current perf harnesses show those are the limiting factors. The gating evidence should be: current `renderer-perf-phase1` artifacts, WGS import/query artifacts, direct stale/rebuild/cancel tests, and a clean `make ci` from a checkout fast-forwarded to `origin/main` under Node `24.14.1` / npm `11.11.0`.
