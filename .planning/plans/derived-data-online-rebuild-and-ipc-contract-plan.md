# Derived Data, Online Rebuild, Import Consistency, and IPC Contract Plan

Date: 2026-05-06

Status: proposed

Spec: `.planning/specs/derived-data-online-rebuild-and-import-consistency.md`

Repository verification:

- `HEAD == origin/main == 3e181a0da29c8d09b2220b841b0341fa62309c12`.
- The local branch is not behind `origin/main`.
- No implementation code has been changed for this planning pass.

## Planning Principles

- Keep each PR small enough to review independently.
- Preserve existing reads before optimizing rebuild speed.
- Add metadata and contracts before changing heavy rebuild mechanics.
- Prefer compatibility shims over breaking all renderer callers at once.
- Every PR must include proof: unit tests, integration tests, E2E tests, or perf measurements.

## Recommended First PR

Start with freshness metadata plus observable stale/building UI and read contracts.

Rationale:

- It is the smallest user-visible slice.
- It does not require two-slot FTS or generational cohort rewrites.
- It gives later rebuild and import-consistency PRs a common status surface.
- It can prove that existing data remains visible while a rebuild is pending.

## PR 1: Freshness Metadata and Stale/Building Read Contract

Scope:

- Add shared types for `DerivedArtifactFreshness`, artifact keys, artifact states, and job statuses.
- Add SQLite lifecycle tables:
  - `derived_artifact_state`
  - `background_jobs`
  - source sequence metadata
- Seed lifecycle rows from existing `cohort_summary_meta`.
- Keep `cohort_summary_meta` as a compatibility mirror.
- Update `DatabaseService.needsStartupRebuild()` and startup rebuild logic to consider `is_stale=1` and lifecycle `stale`, `failed`, or `unavailable` states.
- Expand `cohort:getSummaryStatus` from `{ is_stale, last_rebuilt_at }` to include artifact freshness while preserving old fields.
- Add `database:getOverview` freshness metadata for cohort summary and gene burden.
- Add freshness to object-shaped read responses where additive:
  - `cohort:getVariants`
  - `variants:query`
- Add renderer state for `current`, `stale`, `building`, `failed`, and `unavailable` in cohort/overview surfaces.
- Do not change FTS table shape or cohort rebuild SQL yet.

Out of scope:

- No two-slot FTS.
- No generation-backed cohort tables.
- No PostgreSQL import ownership changes.
- No array-returning API envelope migration.

Tests:

- Migration test: existing `cohort_summary_meta` with `is_stale=0` seeds `current`.
- Migration test: existing `cohort_summary_meta` with `is_stale=1` seeds `stale`.
- Startup test: stale summary schedules or records rebuild need, not only empty-summary databases.
- Integration test: existing cohort summary rows remain readable while lifecycle state is `stale` or `building`.
- IPC/preload type test for the new freshness payloads.
- Renderer tests for stale/building/failed labels and stale data still shown.

Validation gate:

- `make rebuild-node`
- `make ci`

Acceptance criteria:

- Existing cohort/overview data remains visible when a rebuild is pending.
- Freshness metadata is durable across app restart.
- Existing callers that only read `is_stale` still work.

## PR 2: IPC Contract Aliases and High-Risk Renderer Unwraps

Scope:

- Alias these `WindowAPI` domains to their shared contracts:
  - `CaseMetadataAPI`
  - `RegionFilesAPI`
  - `ImportAPI` with event listener intersection
  - `AuthAPI`
  - `AuditLogAPI`
  - `GeneListsAPI`
  - `PanelsAPI`
  - `AnalysisGroupsAPI`
- Remove or reduce preload casts that hide mismatches.
- Add `unwrapIpcResult` at affected renderer edges:
  - `useCaseMetadata`
  - `CaseDataInfoTab`
  - `RegionFileImportDialog`
  - auth store/login
  - import wizard/preview paths
  - batch import dialogs
  - cohort rebuild/cancel controls
- Keep preload as a transport boundary. Do not unwrap in preload by default.

Out of scope:

- No IPC channel rename.
- No discriminated IPC envelope rewrite.
- No runtime validation changes unless needed by touched tests.

Tests:

- Expand `tests/shared/types/preload-contract.test.ts` so every `src/shared/ipc/domains/*` contract is discovered or explicitly exempted.
- Type assertions that aliased domains return `IpcResult<T>`.
- Renderer negative tests where `SerializableError` does not update metadata cache.
- Renderer negative test where `RegionFileImportDialog` does not call `importBed` or emit imported payload when `regionFiles.create` returns `SerializableError`.
- Auth negative test that transport errors are not treated as invalid credentials.

Validation gate:

- `make rebuild-node`
- `make ci`

Acceptance criteria:

- No hand-written `WindowAPI` domain can silently narrow `IpcResult<T>` to `T` for migrated domains.
- High-risk renderer callers unwrap before state mutation.

## PR 3: PostgreSQL Import Ownership and Case Status

Scope:

- Add PostgreSQL migration:
  - `cases.import_status`
  - `cases.import_started_at`
  - `cases.import_finished_at`
  - `cases.import_error`
  - `case_import_files`
  - `variants.import_file_id`
  - `variants.import_batch_ordinal`
- Backfill existing PostgreSQL cases as `ready`.
- Add repository helpers to create/update import file rows and clean rows by `import_file_id`.
- Thread `import_file_id` and `import_batch_ordinal` through:
  - `PostgresVcfImportRepository`
  - `PostgresJsonImportRepository`
  - `postgres-import-worker`
- Set new cases to `importing` before first committed batch.
- Hide `importing` and `failed` cases from default PostgreSQL read paths.
- Keep `partial` hidden unless this PR also includes a clear UI signal.

Out of scope:

- No binary COPY.
- No resumable imports.
- No SQLite import behavior changes.

Tests:

- Migration tests for new columns/tables and backfill.
- Repository tests that VCF COPY rows receive `import_file_id` and batch ordinal.
- Repository tests that JSON rows receive `import_file_id` and batch ordinal.
- Read executor tests that default case/cohort/overview/export reads exclude `importing` and `failed`.
- Postgres import worker test: failure after first committed batch of a file cleans that file's rows.

Validation gate:

- `make rebuild-node`
- Targeted PostgreSQL unit/integration tests.
- `make ci`

Acceptance criteria:

- A failed file has no committed visible variants after cleanup.
- Visible PostgreSQL cases have status and count invariants.

## PR 4: PostgreSQL Cancellation and Finalization Semantics

Scope:

- Implement exact cancellation behavior:
  - cancel before any completed file deletes the case and returns `caseId: 0`.
  - cancel during current file cleans current-file rows.
  - cancel after prior completed files finalizes those files and marks the case `partial`.
- Make finalization non-cancellable once started.
- Recompute `cases.variant_count` from persisted finalized rows.
- Refresh `variant_frequency` only for finalized rows.
- Mark final case `ready` only if all files succeeded.
- Mark final case `partial` if any file failed or cancellation stopped the file set after successful files.
- Add startup recovery for stale `importing` cases from crashed workers.

Out of scope:

- No partial-case UX beyond necessary status surfacing if PR 3 kept partial hidden.
- No cohort derived-artifact redesign.

Tests:

- Worker unit: single-file VCF cancellation after committed batch leaves no visible case/variants.
- Worker unit: single-file JSON cancellation after committed batch leaves no visible case/variants.
- Worker unit: multi-file cancellation after file 1 completed marks case `partial` and count equals persisted rows.
- Integration: `cases.variant_count = COUNT(*)` for finalized rows.
- Integration: `variant_frequency` equals distinct finalized case contribution.
- Update E2E cancellation tests to remove loose acceptance of inconsistent partial states.

Measurements:

- PG WGS import before/after finalization timing.
- Cleanup timing for a failed WGS-scale file, if fixture is available.

Validation gate:

- `make rebuild-node`
- PostgreSQL targeted suite.
- Opt-in PG E2E when Docker is available.
- `make ci`

Acceptance criteria:

- No cancellation path reports `caseId: 0` while leaving a visible partial case.
- No failed-file path can leave variants that are omitted from `case.variant_count`.

## PR 5: Generation-Backed Cohort Summary and Gene Burden

Scope:

- Add generation support to cohort summary and gene burden storage.
- Adapt rebuild SQL to insert target generation instead of deleting active data.
- Reads filter by active generation.
- Rebuild worker claims a job, writes target generation, reports progress durably, and swaps active generation in a short transaction.
- Cancellation before swap leaves active generation intact.
- Failed rebuild records failure and keeps stale data visible.
- Cleanup old generations after successful swap.

Out of scope:

- No FTS two-slot conversion.
- No PostgreSQL materialized cohort rebuild if PostgreSQL does not yet support it.

Tests:

- Unit: rebuild writes target generation without deleting active generation.
- Integration: `cohort:variants`, `cohort:summary`, and `cohort:geneBurden` keep serving old generation during build.
- Cancellation test: active generation unchanged after cancel.
- Failure test: active generation unchanged and status becomes `failed`.
- Startup recovery: abandoned running job becomes `abandoned` and artifact state is `stale` or `failed`.

Measurements:

- Rebuild duration.
- Swap lock time.
- Cohort read p95 during rebuild.

Validation gate:

- `make rebuild-node`
- `make ci`
- WGS-scale cohort timing when feasible.

Acceptance criteria:

- Cohort reads never observe an empty summary solely because a rebuild is in progress.

## PR 6: SQLite Search Index Two-Slot Online Rebuild

Scope:

- Add two-slot FTS tables for base and extension indexes.
- Add active-slot resolver to search clause composition.
- Generate FTS triggers for the active slot.
- Build inactive slot in chunks.
- Swap active slot and triggers in a short transaction.
- Remove duplicated live FTS rebuild paths where possible:
  - `worker-db.ts`
  - `VariantRepository`
  - `import-pipeline.ts`
  - `delete-worker.ts`
- Update startup schema drift handling so it builds a shadow slot rather than dropping the live search table.

Out of scope:

- No concurrent SQLite writes during rebuild.
- No broad search syntax changes.

Tests:

- Unit: active FTS table resolver produces current slot names.
- Unit: trigger SQL targets the active slot.
- Integration: search works from active slot while inactive slot is being built.
- Cancellation: active slot remains active and triggers remain valid.
- Startup schema drift: live search remains usable until replacement slot is ready.

Measurements:

- Extend SQLite WGS import perf to record:
  - insert time
  - FTS build time
  - swap lock time
  - WAL size
  - search p95 during rebuild

Validation gate:

- `make rebuild-node`
- `make ci`
- `VARLENS_RUN_WGS_PERF=1` SQLite import benchmark before/after when fixture is available.

Acceptance criteria:

- Existing committed cases remain searchable while a new search index is building.
- Search index swap is short and measured.

## PR 7: Variant Frequency Freshness and Online Recompute

Scope:

- Decide between generation-backed `variant_frequency` and a contribution table.
- Add freshness to all `internal_af` reads and filters.
- Ensure stale/unavailable frequency state is visible in the renderer.
- Disable or warn on `internal_af` filters when no usable frequency artifact exists.

Out of scope:

- No unrelated variant query optimization.

Tests:

- Frequency invariant after import/delete/recompute.
- Renderer test for stale/unavailable internal AF state.
- Query test for `internal_af` behavior when frequency is unavailable.

Measurements:

- Recompute time on WGS fixture.
- Variant query p95 with generation or contribution-table plan.

Validation gate:

- `make rebuild-node`
- `make ci`
- WGS query perf before/after when query shape changes.

Acceptance criteria:

- `internal_af` never silently uses unavailable or known-stale frequency data without metadata.

## PR 8: IPC Runtime Validation

Scope:

- Convert high-risk IPC handler arguments to `unknown` and validate with schemas:
  - import start and previews
  - batch import paths
  - zip import helpers
  - `system:setWorkerThreads`
- Ensure invalid payloads return `SerializableError` through `wrapHandler`.
- Add tests that invalid payloads do not invoke import or worker logic.

Out of scope:

- No domain contract aliasing if PR 2 already completed it.
- No import behavior changes.

Tests:

- Direct handler tests for invalid payloads.
- Regression test for `system:setWorkerThreads` rejecting malformed values and `NaN`.

Validation gate:

- `make rebuild-node`
- `make ci`

Acceptance criteria:

- Renderer-originating malformed payloads cannot reach file IO or worker-control logic.

## Cross-PR Validation Checklist

Before marking any implementation PR done:

- Run `make rebuild-node`.
- Run `make ci`.
- Run targeted tests listed for the PR.
- For PostgreSQL work, run the targeted PG tests and opt-in E2E when Docker is available.
- For WGS-scale rebuild/search/import work, capture before/after artifacts using the existing perf harness.
- Document any skipped gate with the exact environment blocker.

## Highest-Risk Open Questions

- Whether partial PostgreSQL cases should be visible by default or hidden until a dedicated UI lands.
- Whether existing PostgreSQL databases should get synthetic `case_import_files` rows during migration or leave historical variants with null ownership.
- Whether SQLite FTS rebuild can stay within acceptable disk usage when both slots exist at WGS scale.
- Whether generation-filtered cohort queries need extra covering indexes to preserve p95 latency.
- Whether `IpcResult<T>` should eventually become a discriminated envelope after the alias/unwrap repair.
