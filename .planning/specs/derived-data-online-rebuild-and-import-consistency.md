# Derived Data, Online Rebuild, Import Consistency, and IPC Contract Spec

Date: 2026-05-06

Status: proposed

Source review: `.planning/code-review/CODEBASE-REVIEW-2026-05-06.md`

Repository verification:

- `main` was fetched before this spec was written.
- `HEAD` and `origin/main` are both `3e181a0da29c8d09b2220b841b0341fa62309c12`.
- `git rev-list --left-right --count main...origin/main` returned `0 0`.
- Recent history relevant to this spec includes `6a7d987 perf(workers): commit per batch in postgres import worker` and `f87e91a test(e2e): add postgres VCF COPY cancellation + large-allele scenarios`.
- `.planning/` review material was treated as context only. Claims below were checked against the current tree.

## Summary

VarLens should treat derived products as observable data artifacts, not hidden maintenance side effects. The same contract should cover cohort summary, gene burden, search indexes, and variant frequency. Users must know whether a read is current, stale-but-servable, building, failed, or unavailable, and rebuilds must preserve existing reads until a new generation is ready.

This spec also defines PostgreSQL import failure and cancellation semantics so committed WGS-sized batches cannot leave visible, inconsistent partial data. Finally, it covers the IPC contract drift where renderer code can treat `SerializableError` as success data.

## Evidence

Derived data lifecycle:

- `cohort_summary_meta` stores only `is_stale` and `last_rebuilt_at`; see `src/main/database/migrations.ts` and `src/main/database/CohortSummaryService.ts`.
- `DatabaseService.needsStartupRebuild()` only checks whether `cohort_variant_summary` is empty while variants exist. It does not schedule a rebuild for `is_stale=1`.
- `src/shared/sql/cohort-summary-rebuild.ts` rebuilds live cohort and gene burden tables with `DELETE FROM ...; INSERT ...`.
- `rebuild-summary-worker.ts` emits transient phase messages but has no durable job id, heartbeat, cancellation state, or failed state.
- `VariantFrequencyService.recomputeAllFrequencies()` deletes and reinserts the live `variant_frequency` table.

SQLite FTS and rebuild availability:

- `VariantRepository.beginBulkInsert()` drops FTS triggers and `finishBulkInsertNoCount()` rebuilds all live FTS indexes, restores triggers, runs `ANALYZE`, and optimizes FTS.
- `import-worker.ts` drops FTS triggers and non-essential indexes up front, then runs `rebuildFts(db)` and `rebuildCohortSummary(db)` during finalization.
- `schema.ts` can drop and recreate the live `variants_fts` table during startup schema drift handling.
- Search SQL targets concrete live FTS names (`variants_fts`, `variant_sv_fts`, `variant_str_fts`), so online FTS rebuilds need an active-table resolver.

PostgreSQL import consistency:

- `postgres-import-worker.ts` commits per VCF batch for memory control. On per-file error it rolls back only the current transaction, records the file as `variantCount: 0`, and finalizes `cases.variant_count` from accumulated counters.
- Single-file cancellation can return `caseId: 0` and `variantCount: 0` while earlier committed batches remain.
- PostgreSQL `variants` currently has `case_id` but no `import_file_id` or batch ownership column.
- PostgreSQL has singleton `case_data_info`, but no `case_import_files` equivalent with per-file status.
- Existing cancellation tests allow loose outcomes and do not force failure after a committed batch.

IPC typing:

- `CaseMetadataDomainContract` and `RegionFilesDomainContract` return `IpcResult<T>`.
- `WindowAPI.caseMetadata` and `WindowAPI.regionFiles` still type many methods as raw success values.
- Renderer callers such as `useCaseMetadata`, `CaseDataInfoTab`, and `RegionFileImportDialog` mutate state from those raw values.
- Only `CasesAPI` and `DatabaseAPI` currently alias their shared domain contracts in `src/shared/types/api.ts`.

## Goals

- Make derived artifact freshness a first-class, durable contract.
- Preserve existing readable/searchable data while rebuilding new derived generations.
- Make rebuild progress, failure, cancellation, and restart recovery observable.
- Define exact PostgreSQL behavior for failed files, cancellation, finalization, and stale importing cases.
- Stop renderer code from treating `SerializableError` as success data.
- Keep the work incremental and PR-sized.

## Non-Goals

- No application rewrite and no new backend service.
- No binary COPY, resumable imports, or broader PostgreSQL performance redesign.
- No SQLite/PostgreSQL storage abstraction rewrite.
- No discriminated `{ ok: true | false }` IPC envelope migration in this effort.
- No performance claims without the existing WGS and renderer perf harnesses.
- No weakening Electron security defaults.

## Derived Artifact Model

### Artifact Keys

Use shared artifact keys:

- `cohort_summary`
- `gene_burden`
- `search_index`
- `variant_frequency`

Each artifact is scoped by backend and scope key:

- `backend`: `sqlite` or `postgres`
- `scope_key`: `global` for current artifacts, with room for future case/build scoped products

### Artifact States

Use these states in storage, IPC, and UI:

- `current`: active generation matches the latest source sequence.
- `stale`: an active generation exists, but source data has advanced.
- `building`: a job is building a newer generation while the active generation remains visible.
- `failed`: the last job failed. If an active generation exists, reads continue with stale metadata.
- `unavailable`: no usable generation exists.

### Source Sequence

Add a monotonic source sequence per backend workspace.

- Increment the sequence inside the same transaction as imports, deletes, and annotation changes that affect derived products.
- Derived artifact freshness compares `source_sequence_built` with `source_sequence_required`.
- Rebuild jobs capture `source_sequence_required` at claim time.
- A swap is allowed only when the captured source sequence still matches, or when the job can prove it has caught up.

This avoids timestamp races and makes startup recovery deterministic.

### Durable Tables

Add `derived_artifact_state`:

- `artifact_key`
- `backend`
- `scope_key`
- `state`
- `active_generation`
- `target_generation`
- `active_slot`
- `source_sequence_built`
- `source_sequence_required`
- `last_current_at`
- `last_build_started_at`
- `last_build_finished_at`
- `last_failed_at`
- `last_error_code`
- `last_error_message`
- `row_count`
- `schema_version`
- `artifact_version`
- `updated_at`

Add `background_jobs`:

- `job_id`
- `job_type`
- `artifact_key`
- `backend`
- `scope_key`
- `requested_generation`
- `requested_source_sequence`
- `status`: `queued`, `running`, `cancel_requested`, `cancelled`, `succeeded`, `failed`, `abandoned`
- `phase`
- `phase_index`
- `phase_total`
- `progress_completed`
- `progress_total`
- `progress_unit`
- `can_cancel`
- `created_at`
- `started_at`
- `heartbeat_at`
- `finished_at`
- `cancel_requested_at`
- `worker_owner_id`
- `attempt`
- `error_code`
- `error_message`

`cohort_summary_meta` remains during migration. It should be written as a compatibility mirror until all readers move to `derived_artifact_state`.

## Freshness Payload

Expose a shared payload:

```ts
type DerivedArtifactState =
  | 'current'
  | 'stale'
  | 'building'
  | 'failed'
  | 'unavailable'

interface DerivedArtifactFreshness {
  artifact: 'cohort_summary' | 'gene_burden' | 'search_index' | 'variant_frequency'
  state: DerivedArtifactState
  is_current: boolean
  serving_generation: number | null
  target_generation: number | null
  source_sequence_built: number | null
  source_sequence_required: number
  last_current_at: number | null
  job?: {
    job_id: string
    status: string
    phase?: string
    phase_index?: number
    phase_total?: number
    progress_completed?: number
    progress_total?: number
    can_cancel: boolean
  }
  failure?: {
    at: number
    code: string
    message: string
    retryable: boolean
  }
}
```

Read APIs should expose freshness where the current return shape can accept it additively:

- `cohort:getVariants`: add `freshness.cohort_summary`.
- `variants:query`: add `freshness.variant_frequency` when `internal_af` is projected or filtered, and `freshness.search_index` when FTS search is used.
- `database:getOverview`: add `derived_artifacts` with at least cohort summary and gene burden freshness.
- `cohort:getSummaryStatus`: replace the narrow boolean payload with artifact freshness while preserving `is_stale` and `last_rebuilt_at` during migration.

Array-returning methods such as `cohort:getGeneBurden` should move to an envelope in a dedicated PR, or gain a parallel V2 method, so renderer callers are updated deliberately.

## Lifecycle IPC

Add a domain-module IPC surface:

- `derived-artifacts:getStatus(keys?)`
- `derived-artifacts:listJobs(filters?)`
- `derived-artifacts:retry(artifactKey)`
- `derived-artifacts:cancelJob(jobId)`
- `derived-artifacts:onJobUpdated(callback)`

All methods must use `IpcResult<T>` and follow the domain-module pattern.

## UI Contract

UI states:

- `current`: no warning.
- `stale`: show that the view is using the previous generation and offer rebuild/retry when appropriate.
- `building`: keep reads enabled if an active generation exists. Show phase/progress and cancellation when supported.
- `failed`: keep stale data visible if available. Show failure text and retry.
- `unavailable`: disable dependent features and show recovery action.

The first UI slice should cover cohort and overview. Later slices cover search and `internal_af`.

## SQLite Online Rebuild Design

### Cohort Summary and Gene Burden

Move from live table mutation to generation-backed data:

- Add `generation` to cohort summary and gene burden storage, either directly or through `_data` tables.
- Reads filter by `active_generation`.
- Rebuild writes `target_generation` without deleting the active generation.
- Swap in one short transaction by updating `derived_artifact_state.active_generation`.
- Cleanup older generations after successful swap.

The existing SQL can be adapted with a generation value rather than replaced wholesale.

### Search Index

Use fixed two-slot FTS tables:

- `variants_fts_a` and `variants_fts_b`
- `variant_sv_fts_a` and `variant_sv_fts_b`
- `variant_str_fts_a` and `variant_str_fts_b`

Do not rely on runtime table renames for FTS.

Search code resolves the active slot per request and emits `MATCH` against the active slot names. The inactive slot is built in chunks while the active slot serves search. Swap requires a short write transaction:

1. Claim job and inactive slot.
2. Build inactive FTS from base tables.
3. Check source sequence.
4. If unchanged, drop stable trigger names.
5. Update `active_slot`.
6. Recreate triggers targeting the new active slot.
7. Mark `search_index` current.
8. Cleanup old slot when safe.

If source sequence changed during build, mark stale and retry rather than swapping stale shadow data.

### Locking and Cancellation

- Serialize SQLite writes, imports, deletes, and rebuild jobs through one coordinator.
- Use `BEGIN IMMEDIATE` only for job claim and swap.
- Build large artifacts in chunks so WAL readers keep moving.
- Poll cancellation between chunks and phases.
- The final swap is non-cancellable and must stay short.
- Cancellation before swap leaves active data untouched and records `cancelled` or `stale`.

### Variant Frequency

Treat `variant_frequency` as a derived artifact. The initial metadata PR may keep current incremental behavior, but it must expose freshness. A later PR can use generation-backed frequency rows or a contribution table if per-case exact refresh becomes expensive.

## PostgreSQL Import Consistency

### Chosen Semantics

Use file-granular cleanup, with partial finalization only at completed-file boundaries.

- Cases start as `import_status='importing'`.
- `importing` and `failed` cases are hidden from normal case list, cohort, overview, export, and frequency denominators.
- Each imported variant stores `import_file_id` and `import_batch_ordinal`.
- Each imported file has a `case_import_files` row with `status`, `variant_count`, and `error`.
- File failure rolls back the current transaction, deletes all committed rows for that file id, marks the file failed, and continues remaining files.
- Cancellation cleans up the current file and stops.
- If no file completed successfully, delete the case and return `caseId: 0`.
- If at least one file completed successfully, finalize completed files only and mark the case `partial`.
- A case is `ready` only when all requested files completed successfully.
- Finalization is non-cancellable once started.
- Finalization recomputes `cases.variant_count` from persisted rows, updates successful file counts from persisted rows, rebuilds frequency for the finalized case, and then marks the case `ready` or `partial`.
- If finalization fails, delete the case if possible. If deletion fails, mark it `failed` and keep it hidden.

### PostgreSQL Schema Additions

Add to `cases`:

- `import_status`: `importing`, `ready`, `partial`, `failed`
- `import_started_at`
- `import_finished_at`
- `import_error`

Backfill existing rows as `ready`.

Add `case_import_files`, aligned with SQLite but status-aware:

- `id`
- `case_id`
- `file_path`
- `file_size`
- `variant_type`
- `caller`
- `annotation_format`
- `variant_count`
- `status`: `importing`, `ready`, `failed`, `cancelled`
- `error`
- `file_index`
- `imported_at`

Add to `variants`:

- `import_file_id`
- `import_batch_ordinal`

Extension rows remain owned through `variant_id`.

### Read Path Rules

- Default reads include `ready` cases.
- `partial` cases may be visible only with an explicit UI signal. If the UI cannot yet show that signal, keep partial cases hidden until the UI lands.
- Cohort, overview, export, and frequency denominators must exclude `importing` and `failed`.
- Frequency refresh must only include finalized rows.

## IPC Contract Repair

### Contract Aliases

Prefer aliasing `WindowAPI` domain types to the shared domain contracts:

- `CaseMetadataAPI = CaseMetadataDomainContract`
- `RegionFilesAPI = RegionFilesDomainContract`
- `ImportAPI = ImportDomainContract & { onProgress: ... }`
- Extend the same pattern to `AuthAPI`, `AuditLogAPI`, `GeneListsAPI`, `PanelsAPI`, `AnalysisGroupsAPI`, and other domain-module APIs.

For legacy flat domains, either keep raw return types intentionally with tests, or convert to `IpcResult<T>` consistently.

### Renderer Unwrap Rule

Renderer code must unwrap `IpcResult<T>` at the edge before:

- writing caches
- emitting events
- reading ids from returned objects
- checking `success`
- updating optimistic state permanently

Affected first-pass callers include:

- `useCaseMetadata`
- `CaseDataInfoTab`
- `RegionFileImportDialog`
- auth store/login flow
- import wizard/preview selectors
- batch import dialogs
- cohort rebuild/cancel controls

### Runtime Validation

Add schema validation for high-risk IPC entry points:

- `import:start`
- `import:startMultiFile`
- `import:vcfPreview`
- `import:vcfMultiPreview`
- batch import start/check/zip paths
- `system:setWorkerThreads`

Handlers should accept `unknown`, parse at the boundary, and return `SerializableError` through `wrapHandler` on invalid input.

## Migration and Backward Compatibility

- Planning docs are additive and do not alter shipped behavior.
- First implementation PR must keep `cohort_summary_meta` working while seeding `derived_artifact_state`.
- Existing SQLite databases should initialize lifecycle rows from current tables:
  - no variants and no summary rows: `unavailable` or `current` with generation `0`, depending on artifact.
  - summary rows and `is_stale=0`: `current`.
  - summary rows and `is_stale=1`: `stale`.
  - variants but empty summary: `unavailable` and queued rebuild.
- Existing PostgreSQL cases are backfilled as `ready`; historical variants get null ownership unless a migration can cheaply create a synthetic import file.
- Read API envelope changes for array-returning methods must be done in dedicated PRs with all renderer callers migrated.
- IPC aliases are compile-time changes but require renderer unwrap fixes in the same PR to avoid TypeScript failures.

## Validation Gates

Every implementation PR must run `make ci` at minimum after `make rebuild-node`. PRs touching Electron lifecycle, workers, IPC, or packaging must run the relevant extended gates.

Required new tests and measurements:

- Migration tests for lifecycle rows seeded from `cohort_summary_meta`.
- Startup test where `is_stale=1` schedules or records a rebuild need.
- Read availability test proving old cohort summary remains visible while a rebuild is pending/building.
- Job transition tests: current to stale to building to current; failed with stale data; cancelled; abandoned running job on startup.
- SQLite integration test where search and cohort reads continue while inactive artifacts are being built.
- SQLite WGS validation: import timing, FTS build time, cohort build time, swap lock time, WAL size, and read/search p95 during finalization.
- PostgreSQL worker unit tests for failure after one committed batch, single-file cancellation after committed batch, and multi-file cancellation after one completed file.
- PostgreSQL integration test asserting `cases.variant_count = COUNT(*)` for visible finalized rows and `variant_frequency` matches distinct finalized case contribution.
- IPC type tests that discover all domain contracts, plus renderer negative tests where `SerializableError` responses do not mutate state.

## Risks and Open Questions

- SQLite FTS `MATCH` cannot be cleanly hidden behind ordinary views; search SQL must resolve active FTS table names.
- Two-slot FTS temporarily doubles derived index disk usage at WGS scale.
- Cancellation cannot interrupt a single long synchronous SQLite statement unless a safe interruption mechanism is introduced.
- All source-data write paths must bump the same source sequence or freshness becomes misleading.
- PostgreSQL backfill of import ownership for existing large databases may be expensive. A synthetic import file per existing case may be acceptable.
- Partial case UI must be clear before partial cases are visible by default.
- `IpcResult<T> = T | SerializableError` is structurally weak. Contract aliases reduce drift but cannot fully force unwrapping like a discriminated envelope would.
