# PostgreSQL Parity Phase 9: VCF Import and PostgreSQL Import Worker

**Date:** 2026-04-25
**Status:** Implemented in v0.56.14 (PR #179, merged 2026-04-26)
**Depends on:**

- [Storage Session Boundary Design](../archive/completed-specs/2026-04-23-storage-adapter-boundary-design.md)
- [PostgreSQL Parity Phase 7: Variants Read Parity](../archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md)
- [PostgreSQL Parity Phase 8: Import and Dataset Creation](../archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md)

**Goal:** Bring PostgreSQL mode to import parity with SQLite by adding VCF import (single-file, single-sample-per-file, multi-file/append-within-import, BED filter, extension tables) and by moving the existing JSON import path off the main thread into a `worker_threads`-based PostgreSQL import worker. PG mode must be non-blocking under all import workloads, including WGS-scale, and must match SQLite's existing IPC result and partial-success semantics.

## Background and Motivation

Phase 8 shipped single-file JSON import on PostgreSQL but ran the parsing pipeline and `pg.Client` calls directly in the Electron main process. That works for small JSON imports but is a regression compared to the SQLite path, which has always run import in `worker_threads` (`src/main/workers/import-worker-client.ts` → `import-worker.ts`). Per Electron's official performance guidance, "for long running CPU-heavy tasks, make use of worker threads … under no circumstances should you block the main process and the UI thread with long-running operations." VCF imports — especially WGS-scale ones — must not block the renderer.

VCF is the format clinical and research users actually have. Without VCF support on PostgreSQL, PG mode is a demo. Phase 9 closes both gaps in a single PR: a new `worker_threads`-based PostgreSQL import worker that handles JSON and VCF, with full single-sample, multi-file/append-within-import, BED filter, and extension-table support that matches SQLite's existing IPC result shapes.

## Goals

1. PG mode supports VCF import end-to-end with the same per-call feature set as SQLite (single-file VCF, single sample per call, multi-file append-within-import, BED filter, pre-mapping import filters on multi-file, extension tables for SV/CNV/STR).
2. All PG imports — JSON and VCF — run in `worker_threads`. The Electron main process never blocks on parsing or batched writes.
3. PG transaction scope matches the SQLite contract:
   - Single-file `import:start` (JSON or VCF) → one transaction; atomic commit/rollback for the call.
   - Multi-file `import:startMultiFile` → one transaction **per file**; per-file errors are caught and surfaced through the existing `MultiFileImportResult.files[].error` field; later files continue running. Final post-loop bookkeeping (`variant_frequency` rebuild, `cases.variant_count` refresh, cohort summary stale flag) runs once after the loop, in its own transaction, regardless of per-file outcomes.
   - Cancellation rolls back the in-flight transaction and stops the multi-file loop.
4. SQLite VCF and JSON imports continue to behave identically — same code paths, same return shapes.
5. Renderer-responsiveness during large imports is verifiable in tests.
6. WGS-scale perf is measurable for both SQLite and PostgreSQL through a gated, opt-in benchmark using GIAB open data; baselines and budgets live in `.planning/artifacts/perf/wgs-import/` (not in `AGENTS.md`).

## Non-Goals

- Multi-sample VCF in one `import:start` call. The active IPC contract is `selectedSample?: string` (singular) and `src/main/workers/import-pipeline.ts` rejects more than one sample per call. Phase 9 enforces the same on PG (worker rejects with the same message). Multi-sample-in-one-call requires both an IPC contract extension and case-naming semantics; both are out of scope.
- Single-file `import:start` filters (`bedFile`, `passOnly`, `minQual`, `minGq`, `minDp`). The current IPC exposes filters only on `import:startMultiFile`. Phase 9 matches that — single-file `import:start` carries no filter payload. Extending single-file with filters is a separate IPC change.
- Append-into-pre-existing case via multi-file. SQLite's per-file error handling makes this work incidentally, but that is not a deliberately specified contract. Phase 9 explicitly rejects multi-file imports whose `caseName` already exists in the schema; the case must be created within the multi-file call. This avoids the variant-frequency double-count edge case that SQLite handles only because its repository runs `decrementFrequencies` before the post-loop `updateFrequencies` call (see `src/main/ipc/handlers/import-logic.ts:364`). PG keeps it simple by forbidding the input shape that requires that workaround.
- Replacing `jsonb_to_recordset` with `COPY FROM STDIN`. Phase 9 keeps the Phase 8 batch-insert pattern; escalation to `COPY` is a Phase 16 polish item gated on the WGS benchmark.
- Cohort summary refresh after PG VCF import. `variant_frequency` is rebuilt; cohort summary remains a Phase 11 concern. The cohort-summary stale flag is set on PG once the relevant migration ships; until then PG has no cohort summary table to mark.
- Export, delete, rebuild-summary, `database:overview`, secondary read domains, schema-per-workspace, renderer storage-backend selector. Tracked as Phases 10–15.

## Architectural Decisions (Locked)

1. **Worker-threads on PG path.** Phase 9 introduces `src/main/workers/postgres-import-worker.ts` (a `worker_threads` worker, mirroring `import-worker.ts`) and `src/main/storage/postgres/PostgresImportWorkerClient.ts` (mirroring `ImportWorkerClient`). Phase 8's main-process `PostgresImportExecutor` body is deleted; the executor becomes a thin worker dispatcher.

2. **Repositories become transaction-scoped.** `PostgresJsonImportRepository.runJsonImport(...)` currently calls `pool.connect()`, runs `BEGIN`/`COMMIT`/`ROLLBACK`, and releases the client itself (`PostgresJsonImportRepository.ts:202`). Phase 9 splits transaction lifecycle out of the repository: the worker owns the `pg.Client` and runs `BEGIN`/`COMMIT`/`ROLLBACK`, and the repositories accept an open `Client` parameter and perform only schema/SQL work inside it. The Phase 8 method is refactored:
   - **Before:** `runJsonImport(request, writeVariants): Promise<...>` with the repo opening and managing the transaction.
   - **After:** `writeJsonImport(client, request, writeVariants): Promise<...>` with no `pool.connect()`, no `BEGIN`/`COMMIT`, no `release()`. The new `PostgresVcfImportRepository.writeVcfFile(client, request, ...)` follows the same shape.
   - The Phase 8 unit tests for `runJsonImport` are restructured to drive the new client-accepting API; the SQL the tests assert against is unchanged.

3. **Worker is shared between JSON and VCF.** One worker, one start message, format detection inside. JSON dispatches to the refactored `PostgresJsonImportRepository.writeJsonImport(...)`; VCF dispatches to `PostgresVcfImportRepository.writeVcfFile(...)`. Both consume the same `pg.Client` and the worker's outer transaction.

4. **One `pg.Client` per import call, not a pool inside the worker.** A single import is a single transaction (single-file) or a sequence of one-transaction-per-file (multi-file). A pool inside the worker is unnecessary indirection. The worker creates a `pg.Client` on `start`, runs transactions on it, and closes the client on completion/cancel/error.

5. **Single-file = one transaction; multi-file = one transaction per file.** Single-file `import:start` (JSON or VCF) wraps the entire call in one transaction; any failure rolls everything back. Multi-file `import:startMultiFile` runs each file as its own transaction; per-file failures are caught and surfaced through `MultiFileImportResult.files[].error`; subsequent files still run. The post-loop bookkeeping (frequency rebuild, `variant_count` refresh, cohort-stale marker) runs in a final separate transaction at the end of the call, regardless of per-file outcomes. This matches SQLite's existing behavior at `src/main/ipc/handlers/import-logic.ts:300-399`.

6. **Cancellation is cooperative and checked between batches and between files.** On cancellation: `ROLLBACK` the in-flight transaction, exit any remaining multi-file loop, run the post-loop bookkeeping for whatever did successfully commit (so cross-case state is consistent), close the client, and post `error` with the SQLite-equivalent cancellation message.

7. **`jsonb_to_recordset` for batched writes.** Reuses Phase 8's pattern. Batches of 1000 rows. Base-row inserts return `(input_ordinal, variant_id)` pairs to drive extension-row inserts. Performance gated by an opt-in WGS benchmark; escalation to `COPY` is a Phase 16 polish decision.

8. **Worker receives full PG client config, not just `{ connectionString, schema }`.** The worker constructs a `pg.Client` using the same fields `buildPostgresPoolConfig` (in `src/main/storage/config.ts:187`) computes for the main-process pool, minus pool-only fields:
   - `connectionString`, `schema`, `application_name`, `connectionTimeoutMillis`, `statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `keepAlive`, `ssl`.
   - Pool-only fields (`max`) are dropped because the worker uses a single `Client`, not a `Pool`.
   - The main-process executor exposes a helper `buildPostgresClientConfig(config)` that derives this shape from the existing `PostgresStorageConfig`, used by the worker on `start`.

9. **VCF parsing modules unchanged.** `src/main/import/vcf/*` are already main-thread-callable; the worker imports them directly.

10. **Schema-aware SQL via `${schemaName}`.** Phase 8 already parameterizes the schema; Phase 9 inherits this. Phase 14 (schema-per-workspace) becomes a non-disruptive change.

11. **WGS perf baselines live in `.planning/artifacts/perf/wgs-import/`.** Per repo convention, `AGENTS.md` stays lean. AGENTS.md gains only a brief "WGS perf benchmarks" subsection that documents the run command, the gate env var, and where the artifact lives. The actual baseline numbers and per-backend `BUDGET_S` thresholds are recorded in the artifact directory.

## Architecture

### Boundary placement

```
import:start, import:startMultiFile (existing IPC)
        |
  src/main/ipc/handlers/import-logic.ts
   - format detection (JSON vs VCF) for single-file
   - filter payload normalization for multi-file (BedFilter built from path)
   - dispatch to session executor
        |
  StorageSession.getImportExecutor()
   /                                          \
SqliteImportExecutor                           PostgresImportExecutor
(existing — uses ImportWorkerClient)           (Phase 9 — uses PostgresImportWorkerClient)
                                                       |
                                         PostgresImportWorkerClient
                                         - new Worker(postgres-import-worker.js)
                                         - relays start/cancel/progress/file-complete/complete/error
                                                       |
                                         postgres-import-worker.ts (worker_threads)
                                         - one pg.Client (full client config)
                                         - format detection
                                         - single-file: one BEGIN/COMMIT
                                         - multi-file:  per-file BEGIN/COMMIT, post-loop bookkeeping txn
                                         - JSON: PostgresJsonImportRepository.writeJsonImport(client, ...)
                                         - VCF:  PostgresVcfImportRepository.writeVcfFile(client, ...)
                                         - cancellation between batches and between files
```

### `StorageImportExecutor` (extended)

```ts
export interface StorageImportExecutor {
  /** Single-file import (JSON or VCF). Format is detected by the executor or worker. */
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>

  /** Multi-file append-within-import. Each file in its own transaction; per-file errors surfaced. */
  importMultiFile(params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult>

  cancel(): void
}
```

The Phase 8 surface is collapsed: `importSingleFile` now handles both JSON and VCF (the worker detects format). A separate `importVcfFile` is unnecessary because the IPC contract already varies its payload via `vcfOptions` instead of by method. SQLite implements both methods by delegating to the existing `ImportWorkerClient`. PostgreSQL implements both methods by spawning `PostgresImportWorkerClient`.

`StorageImportSingleFileParams` keeps Phase 8's shape and grows the optional VCF field set:

```ts
type StorageImportSingleFileParams = {
  filePath: string
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string } // selectedSample required for VCF
  throttleMs?: number
  onProgress?: (event: ImportProgressEvent) => void
}
```

`StorageImportMultiFileParams` mirrors `import:startMultiFile`'s IPC contract:

```ts
type StorageImportMultiFileParams = {
  caseName: string
  files: MultiFileImportSpec[]
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  filters?: ImportFilters // pre-built BedFilter instance, not a path
  throttleMs?: number
  onProgress?: (event: ImportProgressEvent) => void
  onFileComplete?: (event: ImportFileCompleteEvent) => void
}
```

### Worker contract

Start message (main → worker). Filters and BED metadata are only present in the multi-file branch:

```ts
type PostgresImportWorkerStartMessage = {
  type: 'start'
  client: PostgresClientConfig // mirrors buildPostgresPoolConfig output minus pool-only fields
  schema: string
  mode: 'single-file' | 'multi-file'
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }

  // Single-file:
  filePath?: string
  format?: 'json' | 'vcf' // optional; worker re-detects if absent

  // Multi-file:
  files?: MultiFileImportSpec[]
  filters?: {
    bedFilePath?: string | null // worker loads BedFilter via BedFilter.fromFile inside the worker
    bedPadding?: number
    passOnly?: boolean
    minQual?: number | null
    minGq?: number | null
    minDp?: number | null
  }

  batchSize?: number
  throttleMs?: number
}
```

Worker → main messages:

```ts
type PostgresImportWorkerMessage =
  | { type: 'progress'; phase: 'parsing' | 'inserting' | 'finalizing'; rowsProcessed: number; rowsTotal?: number; filePath?: string }
  | { type: 'file-complete'; filePath: string; caseId: number; variantCount: number } // multi-file only
  | { type: 'complete'; result: StorageImportSingleFileResult | StorageImportMultiFileResult }
  | { type: 'error'; message: string; cause?: string }
```

Cancel message (main → worker):

```ts
{ type: 'cancel' }
```

The worker validates that filter payloads only appear in multi-file mode; if filters are passed in single-file mode, the worker rejects with a clear `Filters are only supported on import:startMultiFile`. The main-process executor enforces this same rule before sending the message.

### Transaction / cancellation model

**Single-file:**
- Worker opens `pg.Client`, `BEGIN`.
- Repository write call (JSON or VCF) on the same client.
- `COMMIT` on success; `ROLLBACK` on any failure.
- `client.end()`. Post `complete` or `error`.

**Multi-file:**
- Worker opens `pg.Client`.
- For each file in `files`:
  - `BEGIN`.
  - For file 1: create case (reject with `Cannot multi-file import into pre-existing case 'X' in Phase 9` if the case already exists). For file 2+: look up the case created by file 1 and append.
  - Repository write call for the file's variants and provenance.
  - `COMMIT` on success; `ROLLBACK` on per-file failure.
  - On per-file failure: catch the error, append `{ filePath, variantType, variantCount: 0, error: message }` to the result list, continue to the next file.
  - Post `file-complete` or per-file error progress to main.
- Post-loop bookkeeping: `BEGIN`. Refresh `cases.variant_count` for the case. Rebuild `variant_frequency` for the case (single SQL, scoped to the case_id, fresh upsert — see Repository design below). `COMMIT`.
- `client.end()`. Post `complete` with `MultiFileImportResult { caseId, variantCount, files: [...] }`.

**Cancellation:**
- Cancellation flag is checked between every batch insert, between samples (for the future multi-sample case), and between files.
- On cancellation during a batch: `ROLLBACK` the in-flight transaction and skip the rest of the file. For multi-file, also skip remaining files but still run the post-loop bookkeeping for whatever committed.
- On cancellation before any commit: post `error` with `'Import cancelled by user'`. For multi-file with some commits already, return `MultiFileImportResult` with an `error` entry on the cancelled file plus a top-level cancellation marker on subsequent unprocessed files.
- Match Phase 8 / SQLite cancellation result shapes. (Phase 8's single-file cancellation result is the canonical model; multi-file cancellation behavior is documented explicitly in tests since SQLite has no E2E covering it.)

### Repository design

`PostgresJsonImportRepository.writeJsonImport(client, request, writeVariants)` — refactored Phase 8 method that runs only the in-transaction work:

- Duplicate-name check (single-file only — multi-file's pre-existing-case rejection happens at file 1).
- `INSERT INTO cases ...` (single-file mode) or `SELECT id FROM cases WHERE name = $1` (multi-file file 2+).
- Drive `writeVariants(session)` to insert batches.
- `INSERT INTO case_data_info ...` per Phase 6 schema.
- `UPDATE cases SET variant_count = $1 WHERE id = $2` for the case.
- **Does not call** `pool.connect()`, `BEGIN`, `COMMIT`, `ROLLBACK`, or `release`. Those are the worker's responsibility.

`PostgresVcfImportRepository.writeVcfFile(client, request, ...)` — new method that mirrors the JSON shape for VCF:

- `createOrLookupCaseForMultiFile(client, name, fileIndex, ...)` — INSERT new case at file 1 (with pre-existing rejection), SELECT existing case at file 2+. Single-file mode just creates.
- For each batch produced by the parsing pipeline:
  - `INSERT INTO ${schemaName}."variants" (...) SELECT ... FROM jsonb_to_recordset($1::jsonb) RETURNING ordinal, id`.
  - Extension batches via `jsonb_to_recordset` keyed on the returned `(ordinal, variant_id)` pairs.
- `INSERT INTO case_data_info` per Phase 6 schema, one row per file.
- **Does not call** transaction lifecycle methods. The worker owns them.

`PostgresVariantFrequencyRebuild` — a small repository helper used by the worker's post-loop bookkeeping in multi-file mode and by single-file VCF/JSON paths:

```sql
INSERT INTO "schema"."variant_frequency" (chr, pos, ref, alt, case_count)
SELECT chr, pos, ref, alt, 1
FROM "schema"."variants"
WHERE case_id = $1
GROUP BY chr, pos, ref, alt
ON CONFLICT (chr, pos, ref, alt) DO UPDATE
  SET case_count = "schema"."variant_frequency".case_count + 1;
```

The increment is `+ 1` per case (matching Phase 8's existing JSON SQL), not `+ EXCLUDED.case_count`. This is correct under Phase 9's "no append-to-pre-existing-case" non-goal: the rebuild is called at most once per case per import call. SQLite's `decrementFrequencies + updateFrequencies` workaround in `import-logic.ts:374` is unnecessary on PG because the input shape that requires it (multi-file into a pre-existing case) is forbidden in Phase 9.

### Multi-file pre-existing-case rejection

When a multi-file `import:startMultiFile` arrives with a `caseName` that already exists in the schema, the worker rejects on file 1 before any inserts:

```
Multi-file import requires a new case name. Case '${caseName}' already exists in this schema.
```

The error surfaces to the renderer as a normal IPC failure. SQLite continues to allow this input (with the `decrementFrequencies` workaround), so the renderer flow today doesn't actually exercise it; explicit rejection on PG is a tightening of the input contract for the PG path only and is documented as such. Adding append-to-pre-existing-case support is a future phase that requires either matching SQLite's decrement workaround or designing a proper post-merge frequency reconciliation.

### Genome-build resolution

- VCFs typically declare `##reference=` or contig length headers; `vcf-header-parser` extracts this.
- If headers carry a recognizable build (`GRCh37`, `GRCh38`), use it.
- Else if `vcfOptions.genomeBuild` is set, use it.
- Else reject before opening the transaction with: `VCF lacks a recognizable genome build header; supply genomeBuild explicitly`.
- JSON imports continue to default to `GRCh38` per Phase 8.

## IPC Surface

Unchanged from existing contracts. `import:start`, `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`, `import:cancel`, `import:selectFile`, `import:selectFiles`, `import:selectBedFile` all keep their current shapes. Only the implementation behind `import:start` (when format is VCF on a PG session) and `import:startMultiFile` (on a PG session) changes.

Filter payload remains exclusive to `import:startMultiFile`. The main-process handler for `import:startMultiFile` continues to build a `BedFilter` instance from the path via `BedFilter.fromFile(...)` (per `src/main/ipc/handlers/import.ts:42`) for SQLite, but for PG the BED file path is passed through to the worker, which calls `BedFilter.fromFile(...)` itself inside worker context. This avoids transferring the parsed `BedFilter` object across the worker message boundary.

## File Inventory

### New files

- `src/main/workers/postgres-import-worker.ts` — the worker_threads worker.
- `src/main/storage/postgres/PostgresImportWorkerClient.ts` — main-process spawner.
- `src/main/storage/postgres/PostgresVcfImportRepository.ts` — VCF transaction-scoped writes (`writeVcfFile(client, ...)`, no transaction lifecycle).
- `src/shared/types/postgres-import-worker.ts` — start/cancel/progress/file-complete/complete/error message types and `PostgresClientConfig`.
- `tests/main/storage/postgres-vcf-import-repository.test.ts`
- `tests/main/storage/postgres-import-worker-client.test.ts`
- `tests/main/workers/postgres-import-worker.test.ts`
- `tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-renderer-responsive.e2e.ts` — non-blocking proof: import a multi-file VCF while issuing renderer IPCs (`cases:list`); assert each IPC completes within budget.
- `tests/perf/postgres-vcf-wgs-import.perf.test.ts` — gated PG WGS import.
- `tests/perf/sqlite-vcf-wgs-import.perf.test.ts` — gated SQLite WGS import (parity baseline).
- `scripts/perf/compare-wgs-import.mjs` — runs both perf tests and writes a comparison artifact.
- `scripts/postgres/download-wgs-fixture.sh` — idempotent GIAB HG002 download with checksum verification.

### Modified files

- `src/main/storage/postgres/PostgresImportExecutor.ts` — both methods become thin worker-client dispatchers; Phase 8's main-process body removed; new helper `buildPostgresClientConfig(config)`.
- `src/main/storage/postgres/PostgresJsonImportRepository.ts` — split transaction lifecycle out: rename `runJsonImport(...)` to `writeJsonImport(client, ...)`; remove `pool.connect()`/`BEGIN`/`COMMIT`/`ROLLBACK`/`release`. Constructor stops requiring a `Pool` reference.
- `src/main/storage/import-executor.ts` — add `importMultiFile` method to interface; add its param/result types; update `importSingleFile` params/result types if needed for VCF coverage.
- `src/main/storage/sqlite/SqliteImportExecutor.ts` — implement `importMultiFile` by delegating to existing `ImportWorkerClient` multi-file path.
- `src/main/ipc/handlers/import-logic.ts` — VCF detection routes through `session.getImportExecutor().importSingleFile(...)`; multi-file routes through `session.getImportExecutor().importMultiFile(...)`. The post-loop bookkeeping currently inline at lines 348–399 stays in `import-logic.ts` for SQLite (already SQLite-specific) but is delegated to the worker for PG.
- `src/main/ipc/handlers/import.ts` — pass storage session to multi-file path; for PG, defer `BedFilter.fromFile` to the worker.
- `tests/main/storage/import-executor-contract.test.ts` — extend contract for `importMultiFile`.
- `tests/main/storage/sqlite-import-executor.test.ts` — assert new method delegates.
- `tests/main/storage/postgres-import-executor.test.ts` — replace main-process expectations with worker-client expectations; add VCF/multi-file coverage.
- `tests/main/storage/postgres-json-import-repository.test.ts` — updated to drive `writeJsonImport(client, ...)`; assert no transaction-lifecycle SQL is issued.
- `tests/main/handlers/import-logic.test.ts` — VCF + multi-file routing on both backends; pre-existing-case rejection on PG.
- `electron-vite.config.ts` — register `postgres-import-worker.ts` in the main-process worker entry list.
- `AGENTS.md` — new "WGS perf benchmarks" subsection: run command, gate env var, artifact location. No baseline numbers in `AGENTS.md`.
- `.gitignore` — add `tests/.cache/wgs/` and `.planning/artifacts/perf/wgs-import/`.

### Explicitly unchanged

- `src/main/import/vcf/*` — VCF parsing modules consumed unchanged.
- `src/main/workers/import-worker.ts` and `src/main/workers/import-worker-client.ts` — SQLite worker stays as is.
- `import:vcfPreview`, `import:vcfMultiPreview` — already backend-agnostic main-process file inspection.
- IPC contracts in `src/shared/ipc/domains/import.ts` — payload shapes unchanged.

## Testing

### Default (`make test`)

Mocked `pg.Client` and mocked `Worker`:

- `tests/main/storage/postgres-vcf-import-repository.test.ts` — exercises `writeVcfFile(client, ...)` with a mocked Client. Asserts no transaction-lifecycle SQL is issued. Covers single-sample, multi-file create-then-append within one call, extension tables (transcripts, sv, cnv, str), `case_data_info` per file, multi-sample-rejection, missing-genome-build rejection, and multi-file pre-existing-case rejection.
- `tests/main/storage/postgres-json-import-repository.test.ts` — refactored to drive `writeJsonImport(client, ...)`; existing SQL assertions preserved; new assertion that `BEGIN`/`COMMIT`/`ROLLBACK`/`pool.connect`/`release` are never issued from the repository.
- `tests/main/workers/postgres-import-worker.test.ts` — worker logic with mocked Client and mocked parsing pipeline: format dispatch, single-file vs multi-file branch, single-file BEGIN/COMMIT, per-file BEGIN/COMMIT, post-loop bookkeeping transaction, batch loop, progress events, cancellation flag (mid-batch and mid-file), connection failure pre-flight, full-config plumbing (statement_timeout, query_timeout, lock_timeout, idle_in_transaction_session_timeout, application_name, ssl, keepAlive).
- `tests/main/storage/postgres-import-worker-client.test.ts` — start/progress/file-complete/complete/error/cancel/exit relays with a mocked Worker constructor.
- `tests/main/storage/postgres-import-executor.test.ts` — replace Phase 8's main-process expectations; assert both methods spawn the worker client; assert filters are rejected on `importSingleFile`.
- `tests/main/storage/sqlite-import-executor.test.ts` — extend for `importMultiFile`.
- `tests/main/storage/import-executor-contract.test.ts` — extend contract.
- `tests/main/handlers/import-logic.test.ts` — JSON-on-PG, VCF-on-PG (single-sample), multi-file-on-PG, JSON-on-SQLite, VCF-on-SQLite, multi-file-on-SQLite routing; pre-existing-case rejection on PG.

Existing JSON unit tests on the Phase 8 repository continue to pass after the `runJsonImport` → `writeJsonImport` rename — the SQL is identical.

### Gated Docker E2E (`VARLENS_RUN_POSTGRES_E2E=1`) — opt-in, never CI

Local loop:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-*.e2e.ts
make pg-down
```

- `postgres-vcf-single-sample-dev-mode.e2e.ts` — `tests/test-data/vcf/single-sample.vcf.gz` import + read-back via `cases:*`, `variants:*`, `case-metadata:*`.
- `postgres-vcf-bed-filter-dev-mode.e2e.ts` — multi-file with `tests/test-data/vcf/single-sample.vcf.gz` + `test-regions.bed`; verifies post-filter variant counts.
- `postgres-vcf-extensions-dev-mode.e2e.ts` — `synthetic-sv.vcf`, `synthetic-cnv.vcf`, `synthetic-str.vcf` populate the extension tables; reads verify joined queries.
- `postgres-vcf-multi-file-dev-mode.e2e.ts` — multi-file create-then-append-within-import across two single-sample VCFs.
- `postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts` — multi-file where file 2 fails (e.g., malformed); asserts file 1's transaction stays committed, `MultiFileImportResult.files[]` includes file 2's error, post-loop bookkeeping still runs.
- `postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts` — multi-file with a `caseName` that already exists; asserts the worker rejects with the documented message and no inserts happen.
- `postgres-import-cancellation-dev-mode.e2e.ts` — start a long import, cancel mid-way, assert no committed rows for the in-flight transaction; in multi-file mode, assert any earlier-committed files remain committed and the cancellation is surfaced.
- `postgres-import-renderer-responsive.e2e.ts` — start a multi-file import; while it runs, issue ten consecutive `cases:list` IPCs; assert each returns within a per-call budget (e.g., 250 ms). Proves the worker keeps the renderer responsive.

The existing `tests/e2e/postgres-json-import-dev-mode.e2e.ts` continues to pass — regression gate for the Phase 8 → worker migration.

### Gated WGS perf benchmark (`VARLENS_RUN_WGS_PERF=1`) — opt-in, never CI

Local loop:

```bash
scripts/postgres/download-wgs-fixture.sh   # one-time; idempotent
make pg-reset && make pg-up
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
node scripts/perf/compare-wgs-import.mjs
make pg-down
```

- Fixture: GIAB HG002 GRCh38 v4.2.1 high-confidence VCF (~4M variants) downloaded to `tests/.cache/wgs/` (gitignored). Checksum-verified.
- Each perf test imports the same fixture into a freshly-reset target (PG schema, SQLite file).
- Asserts elapsed time below `BUDGET_S` per backend. CI never runs these tests.
- `scripts/perf/compare-wgs-import.mjs` runs both, parses elapsed times, writes `.planning/artifacts/perf/wgs-import/<timestamp>-comparison.md`. Mirrors `scripts/perf/compare-phase1.mjs`.
- **Budget bootstrap procedure**: on first run, both perf tests record their elapsed times to `.planning/artifacts/perf/wgs-import/<timestamp>-baseline.md`. The Phase 9 PR adds a `.planning/artifacts/perf/wgs-import/baselines.md` index file that captures both baselines and sets `BUDGET_S` per backend at `1.5×` the baseline as the regression threshold. Subsequent runs flag any test that exceeds its `BUDGET_S`.
- **Escalation rule**: if the PG baseline exceeds the SQLite baseline by more than `2×`, open a follow-up phase to escalate PG to `COPY FROM STDIN` via `pg-copy-streams`. The decision is recorded alongside the baseline numbers in the artifact directory.
- AGENTS.md gains a "WGS perf benchmarks" subsection with the run command, the gate env var, a pointer to `.planning/artifacts/perf/wgs-import/`, and the escalation rule. No baseline numbers in AGENTS.md.

## Acceptance Criteria

- Phase 9 ships on a single branch (recommended: `feat/postgres-parity-phase-9-vcf-import-and-import-worker`) and one PR.
- All existing PostgreSQL E2Es continue to pass — the Phase 8 → worker migration is non-regressive.
- VCF + single-sample + multi-file (create-then-append-within-import) + BED + extension tables all import successfully on PG mode and read back correctly through `cases:*`, `case-metadata:*`, `variants:*`.
- Single-file `import:start` runs in one transaction; multi-file `import:startMultiFile` runs per-file transactions plus a final post-loop bookkeeping transaction; both behaviors are verified by E2E.
- Multi-file partial-failure E2E proves per-file errors surface through `MultiFileImportResult.files[]` and the post-loop bookkeeping still runs.
- Multi-file pre-existing-case rejection E2E proves the worker rejects with the documented message before any writes.
- Renderer-responsiveness E2E proves the worker keeps the main thread responsive during a multi-file import.
- Repository unit tests assert that `PostgresJsonImportRepository.writeJsonImport` and `PostgresVcfImportRepository.writeVcfFile` issue no transaction-lifecycle SQL.
- Worker unit tests verify the full `pg.Client` configuration is plumbed through (statement_timeout, query_timeout, lock_timeout, idle_in_transaction_session_timeout, application_name, ssl, keepAlive).
- `make ci` green.
- `VARLENS_RUN_POSTGRES_E2E=1` E2E suite green when Docker is available; PR notes when it isn't.
- WGS perf tests run successfully (manually) on both backends; first measurements recorded under `.planning/artifacts/perf/wgs-import/`.
- SQLite VCF and JSON behavior is unchanged — same code paths, no regressions in existing SQLite E2Es.

## Risks and Mitigations

- **Risk:** transaction-scope refactor of `PostgresJsonImportRepository` regresses Phase 8's JSON SQL behavior. **Mitigation:** the existing JSON unit tests assert the SQL; rename-only refactor preserves the SQL bytes. The existing JSON E2E is the regression gate at runtime.
- **Risk:** multi-file partial-failure semantics on PG diverge from SQLite. **Mitigation:** spec mirrors SQLite's `import-logic.ts:300-399` exactly (per-file try/catch, `MultiFileImportResult.files[].error`, post-loop bookkeeping in `finally`). E2E covers partial-failure path explicitly.
- **Risk:** pg.Client config drift between main-process pool and worker client (someone adds a new `pg` setting to `buildPostgresPoolConfig` and forgets the worker). **Mitigation:** introduce `buildPostgresClientConfig(config)` as the single source of truth; `buildPostgresPoolConfig` uses it and adds pool-only fields. Both call sites use the same shared helper.
- **Risk:** worker-loaded `pg` and the parsing modules increase the build matrix. **Mitigation:** `pg` is pure JS — no native build matrix. The new worker is `electron-vite`-built like `import-worker.ts`. Verify `make rebuild-node` and `make rebuild` both still produce the worker bundle.
- **Risk:** WGS-scale import using `jsonb_to_recordset` may exceed acceptable budget. **Mitigation:** WGS perf benchmark exists; escalation path to `COPY FROM STDIN` is a follow-up phase.
- **Risk:** PG rejecting multi-file pre-existing-case is stricter than SQLite. **Mitigation:** documented as a deliberate input-contract tightening on PG only; renderer flow today does not exercise this input shape; if a future use case needs append-to-pre-existing, a later phase implements it correctly with frequency reconciliation.

## Out of Scope (Tracked Elsewhere)

- Multi-sample VCF in one `import:start` call (requires IPC contract extension and case-naming semantics design).
- Single-file `import:start` filters (requires IPC contract extension).
- Multi-file append into a pre-existing case (requires variant-frequency reconciliation design analogous to SQLite's `decrementFrequencies + updateFrequencies`).
- Schema-per-workspace (Phase 14).
- Renderer storage-backend selector / connection management (Phase 15).
- PG export, delete, rebuild-summary (Phases 10–11).
- `database:overview` and Phase 7 filter metadata closure (Phase 12).
- Cohort summary refresh after PG import (Phase 11).
- Secondary read-domain parity (Phase 13).
- `COPY FROM STDIN` perf escalation (Phase 16).
