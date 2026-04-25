# PostgreSQL Parity Phase 9: VCF Import and PostgreSQL Import Worker

**Date:** 2026-04-25
**Status:** Proposed
**Depends on:**

- [Storage Session Boundary Design](../archive/completed-specs/2026-04-23-storage-adapter-boundary-design.md)
- [PostgreSQL Parity Phase 7: Variants Read Parity](../archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md)
- [PostgreSQL Parity Phase 8: Import and Dataset Creation](../archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md)

**Goal:** Bring PostgreSQL mode to import parity with SQLite by adding VCF import (single-file, multi-sample, multi-file/append, BED filter, extension tables) and by moving the existing JSON import path off the main thread into a `worker_threads`-based PostgreSQL import worker. PG mode must be non-blocking under all import workloads, including WGS-scale, matching SQLite's current behavior.

## Background and Motivation

Phase 8 shipped single-file JSON import on PostgreSQL but ran the parsing pipeline and `pg.Client` calls directly in the Electron main process. That works for small JSON imports but is a regression compared to the SQLite path, which has always run import in `worker_threads` (`src/main/workers/import-worker-client.ts` → `import-worker.ts`). Per Electron's official performance guidance, "for long running CPU-heavy tasks, make use of worker threads … under no circumstances should you block the main process and the UI thread with long-running operations." VCF imports — especially WGS-scale ones — must not block the renderer.

VCF is the format clinical and research users actually have. Without VCF support on PostgreSQL, PG mode is a demo. Phase 9 closes both gaps in a single PR: a new `worker_threads`-based PostgreSQL import worker that handles JSON and VCF, with full multi-sample, multi-file/append, BED filter, and extension-table support.

## Goals

1. PG mode supports VCF import end-to-end with the same feature set as SQLite (single-file, multi-sample sample selection, multi-file append-to-case, BED filter, pre-mapping import filters, extension tables for SV/CNV/STR).
2. All PG imports — JSON and VCF — run in `worker_threads`. The Electron main process never blocks on parsing or batched writes.
3. PG import remains transactional: one transaction wraps the entire scope of a single `import:start` or `import:startMultiFile` call (multi-sample if a future caller passes multiple samples in one call; multi-file under the existing multi-file IPC). Any failure rolls everything back; cancellation rolls back cleanly.
4. SQLite VCF and JSON imports continue to behave identically.
5. Renderer-responsiveness during large imports is verifiable in tests.
6. WGS-scale perf is measurable for both SQLite and PostgreSQL through a gated, opt-in benchmark using GIAB open data.

## Non-Goals

- Export, delete, rebuild-summary, cohort, `database:overview`, secondary read domains (tag/annotation/transcript/etc.), schema-per-workspace, renderer storage-backend selector. These are tracked as Phases 10–15.
- Replacing `jsonb_to_recordset` with `COPY FROM STDIN`. Phase 9 keeps the Phase 8 batch-insert pattern; escalation to `COPY` is a Phase 16 polish item gated on the WGS benchmark.
- Supporting cohort summary refresh after PG VCF import. `variant_frequency` is rebuilt; cohort summary remains a Phase 11 concern.
- Decoupling renderer-side per-sample import loops. Today the renderer issues one `import:start` per selected sample; the contract stays unchanged. Multi-sample atomicity (Q5 below) is enforced at the PG side only when a single `import:start` selects multiple samples — current renderer flow remains one sample per call. The atomicity contract is documented for callers that pass multi-sample selections programmatically.

## Architectural Decisions (Locked)

1. **Worker-threads on PG path.** Phase 9 introduces `src/main/workers/postgres-import-worker.ts` (a `worker_threads` worker, mirroring `import-worker.ts`) and `src/main/storage/postgres/PostgresImportWorkerClient.ts` (mirroring `ImportWorkerClient`). Phase 8's main-process `PostgresImportExecutor` body is deleted; the executor becomes a thin worker dispatcher.
2. **Worker is shared between JSON and VCF.** One worker, one start message, format-detection inside. JSON dispatches to the existing `PostgresJsonImportRepository`; VCF dispatches to a new `PostgresVcfImportRepository`. Both consume the same `pg.Client` and transaction. This eliminates Phase 8's main-process regression in the same PR.
3. **One `pg.Client` per import, not a pool.** A single import is a single transaction; a pool inside the worker is unnecessary indirection. The worker creates a `pg.Client` on `start`, runs `BEGIN`, commits or rolls back, and closes the client on completion/cancel/error. This matches the node-postgres recommendation that workers own their own client lifecycle.
4. **One transaction per `import:start` / `import:startMultiFile` call.** A single call's full scope (one or more selected samples; one or more files in the multi-file flow) is atomic: if any insert, parse, or constraint check fails, the entire transaction rolls back. Cancellation is checked between samples and between batches and triggers the same rollback. The current renderer issues one `import:start` per selected sample, so each renderer-driven call is naturally one-sample-per-transaction; the atomic-batch behavior matters for multi-file calls and any future caller that passes multiple samples in one call.
5. **`jsonb_to_recordset` for batched writes.** Reuses Phase 8's pattern. Batches of 1000 rows. Base-row inserts return `(input_ordinal, variant_id)` pairs to drive extension-row inserts. Performance gated by an opt-in WGS benchmark; escalation to `COPY` is a Phase 16 polish decision.
6. **VCF parsing modules unchanged.** `src/main/import/vcf/*` are already main-thread-callable; the worker imports them directly. No fork between SQLite-worker and PostgreSQL-worker parsing.
7. **Schema-aware SQL via `${schemaName}`.** Phase 8 already parameterizes the schema; Phase 9 inherits this. Phase 14 (schema-per-workspace) becomes a non-disruptive change.

## Architecture

### Boundary placement

```
import:start, import:startMultiFile (existing IPC)
        |
  src/main/ipc/handlers/import-logic.ts
   - format detection (JSON vs VCF)
   - dispatch to session executor
        |
  StorageSession.getImportExecutor()
   /                                          \
SqliteImportExecutor                           PostgresImportExecutor
(existing — uses ImportWorkerClient)           (Phase 9 — uses PostgresImportWorkerClient)
                                                       |
                                         PostgresImportWorkerClient
                                         - new Worker(postgres-import-worker.js)
                                         - relays start/cancel/progress/complete/error
                                                       |
                                         postgres-import-worker.ts (worker_threads)
                                         - one pg.Client, one transaction
                                         - format detection, pipeline dispatch
                                         - JSON: PostgresJsonImportRepository
                                         - VCF:  PostgresVcfImportRepository
                                         - batched jsonb_to_recordset writes
                                         - cancellation between batches/samples
```

### `StorageImportExecutor` (extended)

```ts
export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  importVcfFile(params: StorageImportVcfFileParams): Promise<StorageImportVcfFileResult>
  importMultiFile(params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult>
  cancel(): void
}
```

`importSingleFile` is Phase 8's existing method; under Phase 9 its PG implementation routes through the worker. `importVcfFile` is the single-file VCF path. `importMultiFile` is the multi-file/append path. SQLite implements all three by delegating to the existing `ImportWorkerClient` (no behavior change). PostgreSQL implements all three by spawning `PostgresImportWorkerClient`.

### Worker contract

Start message (main → worker):

```ts
type PostgresImportWorkerStartMessage = {
  type: 'start'
  filePath: string
  format?: 'json' | 'vcf' // optional pre-detection from main; worker re-detects if absent
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  filters?: {
    bedFile?: string | null
    bedPadding?: number
    passOnly?: boolean
    minQual?: number | null
    minGq?: number | null
    minDp?: number | null
  }
  multiFile?: { files: MultiFileImportSpec[] } // present for multi-file imports
  pg: { connectionString: string; schema: string }
  batchSize?: number
  throttleMs?: number
}
```

Worker → main messages:

```ts
type PostgresImportWorkerMessage =
  | { type: 'progress'; phase: 'parsing' | 'inserting' | 'finalizing'; rowsProcessed: number; rowsTotal?: number }
  | { type: 'file-complete'; filePath: string; caseId: number; variantCount: number }
  | { type: 'complete'; caseIds: number[]; variantCounts: number[]; skipped: number; errors: string[]; elapsed: number }
  | { type: 'error'; message: string; cause?: string }
```

Cancel message (main → worker):

```ts
{ type: 'cancel' }
```

### Transaction / cancellation model

- Worker opens `pg.Client`, runs `BEGIN`.
- Cancellation flag is checked between every batch insert and between each sample iteration. On cancellation: `ROLLBACK`, `client.end()`, post `error` with `'Import cancelled by user'`. Match Phase 8 / SQLite cancellation result shape.
- Any thrown error inside the transaction triggers the same cleanup path: `ROLLBACK`, `client.end()`, post `error`. The main-process executor surfaces the message to the renderer as a normal IPC failure.
- Worker exit unexpectedly (`Worker.on('exit')` with non-zero code) is treated as an error in `PostgresImportWorkerClient` and surfaced through the `error` callback.

### Repository design

`PostgresVcfImportRepository`:

- `createOrAppendCase(name, genomeBuild, caller, multiFile)` — INSERT new case; if `multiFile` and case already exists, SELECT and return its `id`. Reject with `Case 'X' already exists` for non-multi-file when a duplicate name is found, matching Phase 8's single-file JSON behavior.
- `insertVariantBatch(caseId, batch)` — `INSERT INTO ${schemaName}."variants" (...) SELECT ... FROM jsonb_to_recordset($1::jsonb) RETURNING ordinal, id`.
- `insertVariantTranscriptsBatch(rows)` / `insertVariantSvBatch(rows)` / `insertVariantCnvBatch(rows)` / `insertVariantStrBatch(rows)` — batched extension inserts driven by the `(ordinal, variant_id)` mapping returned from the base insert.
- `insertCaseDataInfo(caseId, importMeta)` — Phase 6 schema, one row per imported sample.
- `refreshCaseVariantCount(caseIds)` — `UPDATE cases SET variant_count = (SELECT count(*) FROM variants WHERE case_id = cases.id) WHERE id = ANY($1)`.
- `rebuildVariantFrequency(caseIds)` — single statement scoped to imported case IDs:

  ```sql
  INSERT INTO "schema"."variant_frequency" (chr, pos, ref, alt, case_count)
  SELECT chr, pos, ref, alt, count(DISTINCT case_id)
  FROM "schema"."variants"
  WHERE case_id = ANY($1::bigint[])
  GROUP BY chr, pos, ref, alt
  ON CONFLICT (chr, pos, ref, alt) DO UPDATE
    SET case_count = "schema"."variant_frequency".case_count + EXCLUDED.case_count;
  ```

- All methods accept the worker's `pg.Client` so the repository never opens its own connection.

### Multi-file append semantics

- `import:startMultiFile(caseName, files, vcfOptions, filters)` is the existing IPC contract. PostgreSQL implementation:
  - First file with first selected sample creates the case (or fails if the case already exists outside the multi-file flow).
  - Subsequent files (or subsequent samples within a file) look up the case by name and append variants and `case_data_info` rows to the same `case_id`.
  - All files run inside the single multi-file transaction.
  - `variant_frequency` rebuild and `cases.variant_count` refresh happen once at the end.
- Append-to-existing-case from a single-file `import:start` is **not** supported — single-file `import:start` rejects on duplicate case names. Match the Phase 8 / SQLite contract.

### Genome-build resolution

- VCFs typically declare `##reference=` or contig length headers; the existing `vcf-header-parser` extracts this.
- If headers carry a recognizable build (`GRCh37`, `GRCh38`), use it.
- Else if `vcfOptions.genomeBuild` is set, use it.
- Else reject before opening the transaction with a clear message: `VCF lacks a recognizable genome build header; supply genomeBuild explicitly`.
- JSON imports continue to default to `GRCh38` per Phase 8.

## IPC Surface

Unchanged from existing contracts. `import:start`, `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`, `import:cancel`, `import:selectFile`, `import:selectFiles`, `import:selectBedFile` all keep their current shapes. Only the implementation behind `import:start` (when format is VCF on a PG session) and `import:startMultiFile` (on a PG session) changes.

## File Inventory

### New files

- `src/main/workers/postgres-import-worker.ts` — the worker_threads worker.
- `src/main/storage/postgres/PostgresImportWorkerClient.ts` — main-process spawner.
- `src/main/storage/postgres/PostgresVcfImportRepository.ts` — VCF write helpers.
- `src/shared/types/postgres-import-worker.ts` — start/cancel/progress/complete/error message types.
- `tests/main/storage/postgres-vcf-import-repository.test.ts`
- `tests/main/storage/postgres-import-worker-client.test.ts`
- `tests/main/workers/postgres-import-worker.test.ts`
- `tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-sample-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-renderer-responsive.e2e.ts` — non-blocking proof: import a multi-sample VCF while issuing renderer IPCs (`cases:list`); assert each IPC completes within budget.
- `tests/perf/postgres-vcf-wgs-import.perf.test.ts` — gated PG WGS import.
- `tests/perf/sqlite-vcf-wgs-import.perf.test.ts` — gated SQLite WGS import (parity baseline).
- `scripts/perf/compare-wgs-import.mjs` — runs both perf tests and writes a comparison artifact.
- `scripts/postgres/download-wgs-fixture.sh` — idempotent GIAB HG002 download with checksum verification.

### Modified files

- `src/main/storage/postgres/PostgresImportExecutor.ts` — three methods become thin worker-client dispatchers; Phase 8's main-process body is removed.
- `src/main/storage/postgres/PostgresJsonImportRepository.ts` — used inside the worker now; minor refactor only if needed for clean worker import.
- `src/main/storage/import-executor.ts` — add `importVcfFile` and `importMultiFile` to the interface; add their param/result types.
- `src/main/storage/sqlite/SqliteImportExecutor.ts` — implement new methods by delegating to existing `ImportWorkerClient`.
- `src/main/ipc/handlers/import-logic.ts` — VCF detection and `import:startMultiFile` route through `session.getImportExecutor()`.
- `src/main/ipc/handlers/import.ts` — pass storage session to multi-file path.
- `tests/main/storage/import-executor-contract.test.ts` — extend contract for new methods.
- `tests/main/storage/sqlite-import-executor.test.ts` — assert new methods delegate.
- `tests/main/storage/postgres-import-executor.test.ts` — replace main-process expectations with worker-client expectations; add VCF/multi-file coverage.
- `tests/main/handlers/import-logic.test.ts` — VCF + multi-file routing on both backends.
- `electron-vite.config.ts` — register `postgres-import-worker.ts` in the main-process worker entry list.
- `AGENTS.md` — new "WGS perf benchmarks" subsection; document `VARLENS_RUN_WGS_PERF=1` and the comparison script.
- `.gitignore` — add `tests/.cache/wgs/` and `.planning/artifacts/perf/wgs-import/`.

### Explicitly unchanged

- `src/main/import/vcf/*` — VCF parsing modules consumed unchanged.
- `src/main/workers/import-worker.ts` and `src/main/workers/import-worker-client.ts` — SQLite worker stays as is.
- `import:vcfPreview`, `import:vcfMultiPreview` — already backend-agnostic main-process file inspection.

## Testing

### Default (`make test`)

Mocked `pg.Client` and mocked `Worker`:

- `tests/main/storage/postgres-vcf-import-repository.test.ts` — single-sample, multi-sample, append-to-case, extension tables (transcripts, sv, cnv, str), `case_data_info` per sample, `cases.variant_count` refresh, `variant_frequency` rebuild scoped to imported case IDs, transaction rollback on insert failure, duplicate-name rejection on non-multi-file.
- `tests/main/workers/postgres-import-worker.test.ts` — worker logic with mocked Client and mocked parsing pipeline: format dispatch, batch loop, progress events, cancellation flag (mid-batch and mid-sample), connection failure pre-flight.
- `tests/main/storage/postgres-import-worker-client.test.ts` — start/progress/complete/error/cancel/exit relays with a mocked Worker constructor.
- `tests/main/storage/postgres-import-executor.test.ts` — replace Phase 8's main-process expectations; assert all three methods spawn the worker client.
- `tests/main/storage/sqlite-import-executor.test.ts` — extend for new methods.
- `tests/main/storage/import-executor-contract.test.ts` — extend contract.
- `tests/main/handlers/import-logic.test.ts` — JSON-on-PG, VCF-on-PG, multi-file-on-PG, JSON-on-SQLite, VCF-on-SQLite, multi-file-on-SQLite routing.

Existing JSON unit tests on the Phase 8 repository continue to pass — the repository moves contexts but the SQL is unchanged.

### Gated Docker E2E (`VARLENS_RUN_POSTGRES_E2E=1`) — opt-in, never CI

Local loop:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-*.e2e.ts
make pg-down
```

- `postgres-vcf-single-sample-dev-mode.e2e.ts` — `tests/test-data/vcf/single-sample.vcf.gz` import + read-back via `cases:*`, `variants:*`, `case-metadata:*`.
- `postgres-vcf-multi-sample-dev-mode.e2e.ts` — `trio-region.vcf.gz`, three selected samples, atomic transaction; injects a fault at the third sample to assert atomic rollback (no `cases` rows committed).
- `postgres-vcf-bed-filter-dev-mode.e2e.ts` — `trio-region.vcf.gz` + `test-regions.bed`; verifies post-filter variant counts.
- `postgres-vcf-extensions-dev-mode.e2e.ts` — `synthetic-sv.vcf`, `synthetic-cnv.vcf`, `synthetic-str.vcf` populate the extension tables; reads verify joined queries.
- `postgres-vcf-multi-file-dev-mode.e2e.ts` — multi-file append-to-case across two VCFs.
- `postgres-import-cancellation-dev-mode.e2e.ts` — start a multi-sample import, cancel mid-way, assert no committed rows for the case.
- `postgres-import-renderer-responsive.e2e.ts` — start a multi-sample import; while it runs, issue ten consecutive `cases:list` IPCs; assert each returns within a per-call budget (e.g., 250 ms). Proves the worker keeps the renderer responsive.

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
- Asserts elapsed time below `BUDGET_S` per backend. Initial budget is set after the first measurement and recorded in `AGENTS.md`. CI never runs these tests.
- `scripts/perf/compare-wgs-import.mjs` runs both, parses elapsed times, writes `.planning/artifacts/perf/wgs-import/<timestamp>-comparison.md`. Mirrors `scripts/perf/compare-phase1.mjs`.
- **Budget bootstrap procedure**: on first run, both perf tests record their elapsed times to `.planning/artifacts/perf/wgs-import/<timestamp>-baseline.md`. The Phase 9 PR adds an `AGENTS.md` "WGS perf benchmarks" subsection that documents both baselines verbatim and sets `BUDGET_S` per backend at `1.5×` the baseline as the regression threshold. Subsequent runs flag any test that exceeds its `BUDGET_S`.
- **Escalation rule**: if the PG baseline exceeds the SQLite baseline by more than `2×`, open a follow-up phase to escalate PG to `COPY FROM STDIN` via `pg-copy-streams`. This decision is documented in the same `AGENTS.md` subsection alongside the baseline numbers.

## Acceptance Criteria

- Phase 9 ships on a single branch (recommended: `feat/postgres-parity-phase-9-vcf-import-and-import-worker`) and one PR.
- All existing PostgreSQL E2Es continue to pass — the Phase 8 → worker migration is non-regressive.
- VCF + multi-sample + multi-file + BED + extension tables all import successfully on PG mode and read back correctly through `cases:*`, `case-metadata:*`, `variants:*`.
- One transaction wraps all selected samples; atomic-rollback E2E proves it.
- Renderer-responsiveness E2E proves the worker keeps the main thread responsive during a multi-sample import.
- `make ci` green.
- `VARLENS_RUN_POSTGRES_E2E=1` E2E suite green when Docker is available; PR notes when it isn't.
- WGS perf tests run successfully (manually) on both backends; first measurements recorded in `AGENTS.md` along with the per-backend budget.
- SQLite VCF and JSON behavior is unchanged — same code paths, no regressions in existing SQLite E2Es.

## Risks and Mitigations

- **Risk:** worker_threads-imported `better-sqlite3-multiple-ciphers` already requires a different ABI from main; adding a second worker that imports `pg` and the VCF parsing modules increases the build matrix. **Mitigation:** `pg` is pure JS — no native build matrix to manage. The new worker is `electron-vite`-built like `import-worker.ts`. Verify `make rebuild-node` and `make rebuild` both still produce the worker bundle.
- **Risk:** moving the Phase 8 JSON path through the worker changes locality and could expose bugs the main-process path masked (e.g., transferring large payloads via `parentPort` vs in-process objects). **Mitigation:** the existing JSON E2E is the regression gate; behavior must be byte-identical.
- **Risk:** WGS-scale import using `jsonb_to_recordset` may exceed acceptable budget. **Mitigation:** WGS perf benchmark exists; escalation path to `COPY FROM STDIN` is a follow-up phase, not Phase 9 scope creep.
- **Risk:** atomic multi-sample rollback could surprise users who expect partial success. **Mitigation:** documented behavior; renderer flow today calls `import:start` once per sample so each call is atomic per its own transaction. Only callers that pass multi-sample selections in a single call see the atomic-batch behavior.

## Out of Scope (Tracked Elsewhere)

- Schema-per-workspace (Phase 14).
- Renderer storage-backend selector / connection management (Phase 15).
- PG export, delete, rebuild-summary (Phases 10–11).
- `database:overview` and Phase 7 filter metadata closure (Phase 12).
- Cohort summary refresh after PG import (Phase 11).
- Secondary read-domain parity (Phase 13).
- `COPY FROM STDIN` perf escalation (Phase 16).
