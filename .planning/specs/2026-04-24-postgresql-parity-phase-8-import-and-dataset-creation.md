# PostgreSQL Parity Phase 8: Import and Dataset Creation

**Date:** 2026-04-24
**Status:** Proposed
**Depends on:**
- [Storage Session Boundary Design](./2026-04-23-storage-adapter-boundary-design.md)
- [PostgreSQL Parity Phase 6: Case Metadata and Cases Filters](../archive/completed-specs/2026-04-24-postgresql-parity-phase-6-case-metadata-and-cases-filters.md)
- [PostgreSQL Parity Phase 7: Variants Read Parity](../archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md)

**Goal:** Make PostgreSQL mode usable with real user data by supporting creation of a new case/dataset from an imported JSON variant file, then proving the imported data is readable through the existing PostgreSQL cases, metadata, and variants read paths.

## Phase 6 Reconciliation

Phase 6 was active in `.planning/specs` and `.planning/plans` but had already been implemented and merged before Phase 7.

Reconciliation performed on 2026-04-24:

- Verified implementation history: PR #176 (`refactor/postgres-parity-phase-6-case-metadata`) is merged before Phase 7.
- Verified code presence: PostgreSQL case metadata repository, read/write executors, cases metadata filters, IPC routing, Docker E2E, and WGS-readiness artifact exist in the current tree.
- Ran focused verification:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/handlers/case-metadata-routing.test.ts
```

Result: 7 test files and 38 tests passed.

The Phase 6 spec and plan were marked `Completed` and moved to:

- `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-6-case-metadata-and-cases-filters.md`
- `.planning/archive/completed-plans/2026-04-24-postgresql-parity-phase-6-case-metadata-and-cases-filters.md`

Phase 8 planning starts from the archived Phase 6 and Phase 7 baselines.

## Summary

PostgreSQL mode can currently read seeded cases, case metadata, and variants, but it cannot create a usable dataset from user data. Import is still tied to SQLite file-backed workers and `DatabaseService`. That blocks any credible PostgreSQL beta because users cannot load their own cases.

Phase 8 should implement the smallest import slice that changes that:

1. Add PostgreSQL-backed single-file JSON import through the existing `import:start` IPC path.
2. Create a new `cases` row in PostgreSQL with a generated ID.
3. Stream JSON variants through the existing JSON detection and mapper pipeline.
4. Insert base variant rows plus transcript/SV/CNV/STR extension rows when the JSON mapper emits them.
5. Populate import provenance in `case_data_info`.
6. Rely on the Phase 7 PostgreSQL `search_document` triggers for imported variant full-text data and verify the populated column through a search query.
7. Refresh `cases.variant_count` and `variant_frequency` so Phase 7 reads and internal AF stay honest.
8. Validate end to end with Docker PostgreSQL and Electron by importing `tests/fixtures/import/simple-format.json` and reading the new case through `cases:*`, `case-metadata:*`, and `variants:*`.

This phase deliberately does not implement VCF import, multi-file import, export, delete, rebuild, cohort parity, database overview, or renderer PostgreSQL settings.

## Slice Decision: JSON First, VCF Deferred

Choose **JSON import first** for Phase 8.

Reasons:

- JSON import reuses `detectFormat(...)`, `createMapperPipeline(...)`, and the existing JSON mappers without pulling in VCF sample selection, genotype parsing, BED filtering, multi-sample case creation, or multi-file append behavior.
- A JSON import creates a real user dataset: a case row, variants, import provenance, searchable variant read results, and frequency data.
- PostgreSQL variant schema already exists from Phase 7, so the work is primarily write-path and routing parity rather than another broad parser/schema phase.
- VCF would make the phase materially broader because current VCF import includes sample selection, genome-build locking, caller detection, pre/post mapping filters, extension tables, and multi-file case assembly.

VCF import should be a later phase after Phase 8 proves the backend-aware import executor shape. Phase 8 may keep VCF preview working because preview does not write to storage, but `import:start` with a detected VCF file on PostgreSQL must fail clearly with `PostgreSQL import currently supports JSON files only`.

## Scope

### In Scope

- Existing `import:start` IPC route for PostgreSQL sessions.
- Single-file JSON import for formats already supported by `detectFormat(...)` and `createMapperPipeline(...)`:
  - simple `{ "variants": [...] }`
  - object `samples.<case>.variants`
  - columnar header/data JSON
- PostgreSQL case creation for imported datasets.
- Duplicate case-name handling for the same behavior as current single-file import: skip/reject duplicate case names rather than silently overwriting.
- Default imported JSON cases to `genome_build: 'GRCh38'` because current JSON imports do not carry genome-build metadata. This must be explicit in tests and left as a Phase 9+ UI/configuration follow-up, not hidden in repository code.
- Batched PostgreSQL inserts for:
  - `cases`
  - `variants`
  - `variant_transcripts`
  - `variant_sv`
  - `variant_cnv`
  - `variant_str`
  - `case_data_info`
  - `variant_frequency`
- `case_data_info` must use the columns from `scripts/postgres/init-db/11-phase6-case-metadata.sql`; Phase 8 must not add ad-hoc provenance columns.
- Variant batch SQL should use `jsonb_to_recordset($1::jsonb)` with an explicit import ordinal in the batch payload where input-to-output mapping is needed, avoiding PostgreSQL's 65,535 parameter limit and avoiding positional assumptions from `INSERT ... RETURNING`.
- Progress callbacks for parsing/inserting progress on PostgreSQL JSON import.
- Import cancellation checked between JSON batches.
- Docker-backed PostgreSQL Electron E2E validation for imported data.
- Mocked `pg.Pool`/client unit tests for transaction shape, duplicate handling, inserts, rollback, and numeric normalization.
- Format-specific executor tests for simple, object, and columnar JSON so the declared JSON scope is covered.
- SQLite behavior preserved by leaving the existing file-backed import worker path intact for SQLite sessions.

### Narrow Dependencies

- Change `scripts/postgres/init-db/10-phase3-cases.sql` so `cases.id` is generated by PostgreSQL, for example `BIGSERIAL PRIMARY KEY`.
- Update seed sequence handling in `scripts/postgres/init-db/20-phase3-seed-cases.sql` with `setval(pg_get_serial_sequence('public.cases', 'id'), ...)` so imported cases do not collide with seeded IDs.
- Add a backend-aware import executor hook to `StorageSession`. This is limited to import and must not become a general storage lifecycle UI.

### Out of Scope

- VCF import into PostgreSQL.
- Multi-file import into PostgreSQL.
- Append-to-existing-case import into PostgreSQL.
- Import overwrite semantics for PostgreSQL.
- Export from PostgreSQL.
- Delete from PostgreSQL.
- Cohort summary rebuild or cohort read/write parity.
- `database:overview`.
- Renderer PostgreSQL settings or storage-backend selection UI.
- PostgreSQL lifecycle UI, recent connections, encryption, or rekey.
- Full PostgreSQL filter metadata parity for `variants:filterOptions` and `variants:columnMeta`; the Phase 7 deferral remains open.

## Architecture

### Session Boundary

Add a narrow import executor to the storage session boundary:

```ts
export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  cancel(): void
}
```

`SqliteStorageSession` returns an executor that delegates to the existing `ImportWorkerClient` path. `PostgresStorageSession` returns a new PostgreSQL JSON import executor.

This keeps `import-logic.ts` backend-aware without calling `getDatabaseService()` on PostgreSQL sessions.

### PostgreSQL JSON Import Service

Create a PostgreSQL implementation that:

- checks for an existing case by name,
- creates the case row inside one transaction,
- streams mapped JSON variants with `createMapperPipeline(...)`,
- inserts base variant batches with `jsonb_to_recordset($1::jsonb)` rather than multi-row `VALUES`,
- maps generated variant IDs back to input rows only through a deterministic strategy: base-only batches may ignore returned ordering, while extension-bearing rows must either use a valid transaction-local staging/ordinal mechanism or insert those base rows one at a time before batched extension inserts,
- inserts extension rows with `jsonb_to_recordset($1::jsonb)` after the generated `variant_id` is known,
- inserts `case_data_info` provenance using the Phase 6 schema columns,
- updates `cases.variant_count`,
- refreshes `variant_frequency` once after all variant batches have been inserted,
- commits on success and rolls back on any import failure.

Use one checked-out `pg` client for the whole transaction. Do not use separate `pool.query(...)` calls inside the transaction. The executor must stream mapped variants into bounded batches; the repository should expose a transaction/session API so Phase 8 does not need to accumulate an entire JSON file in memory. On failure, roll back and release the checked-out client with the error object so `pg` discards a dirty connection rather than returning it to the pool.

`variant_frequency` must be refreshed with one statement at the end of the import, driven from the inserted `variants` table for the imported case:

```sql
INSERT INTO "schema"."variant_frequency" (chr, pos, ref, alt, case_count)
SELECT chr, pos, ref, alt, 1
FROM "schema"."variants"
WHERE case_id = $1
GROUP BY chr, pos, ref, alt
ON CONFLICT (chr, pos, ref, alt)
DO UPDATE SET case_count = "schema"."variant_frequency".case_count + 1;
```

Do not update `variant_frequency` per insert batch. A coordinate can repeat within one case or span two batches, and internal frequency must increment at most once per case.

### PostgreSQL Case ID Generation

Phase 8 requires imported case IDs. The current Docker schema creates `cases.id BIGINT PRIMARY KEY`, and seed rows provide explicit IDs. Phase 8 should change that to a generated ID column and reset the sequence after seed data. This is a storage-schema dependency directly required by import/dataset creation.

### Progress and Cancellation

PostgreSQL JSON import should preserve the renderer event shape already used by `import:start`:

- emit `phase: 'parsing'` before streaming starts,
- emit `phase: 'inserting'` after each inserted batch,
- return `{ caseId, variantCount, skipped, errors, elapsed }`.

Cancellation is cooperative and checked between batches. On cancellation, roll back the transaction and resolve with the same cancellation result shape used by SQLite single-file import:

```ts
{
  caseId: 0,
  variantCount: 0,
  skipped: 0,
  errors: ['Import cancelled by user'],
  elapsed: 0
}
```

## Docker-backed Validation

Phase 8 must add a gated E2E test, for example `tests/e2e/postgres-json-import-dev-mode.e2e.ts`.

Required local loop:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
make pg-down
```

The new E2E should launch Electron with:

```bash
VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres
VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
VARLENS_PG_SCHEMA=public
```

It should import `tests/fixtures/import/simple-format.json` as a unique case name and verify:

- `import:start` returns a successful IPC result with a non-seeded case ID and `variantCount: 3`,
- `cases:query` includes the imported case using `search_term`,
- `caseMetadata.getDataInfo(caseId)` reports the import file name and JSON import type,
- `variants.typeCounts(caseId)` reports imported SNV count,
- `variants.query(caseId, { gene_symbol: 'BRCA1' }, ...)` returns the imported BRCA1 row,
- `variants.query(caseId, { search_query: 'BRCA1' }, ...)` returns the imported row, proving the Phase 7 `search_document` trigger populated full-text data,
- the imported case reports `genome_build: 'GRCh38'`,
- `variants.query(caseId, { max_internal_af: 1 }, ...)` includes imported rows, proving `variant_frequency` was refreshed.

## TDD Requirements

Every implementation task must follow red/green/refactor:

1. Write the failing test first.
2. Run the focused command and confirm it fails for the expected missing behavior.
3. Implement the smallest code needed.
4. Re-run the focused command and confirm it passes.
5. Run `make typecheck` after interface or cross-module changes.

No production import code should be written without a failing test first.

## Parallel Work Lanes

Use `superpowers:subagent-driven-development` when implementing the approved plan. The controller should keep shared interface tasks sequential, then dispatch implementation lanes with disjoint write sets.

| Lane | Can start after | Write set | Output |
|---|---|---|---|
| A | Baseline branch | `scripts/postgres/init-db/10-phase3-cases.sql`, `20-phase3-seed-cases.sql`, schema tests/E2E expectations | generated PostgreSQL case IDs |
| B | Import executor contract lands | `src/main/storage/import-executor.ts`, `src/main/storage/session.ts`, SQLite session/import adapter tests | backend-neutral import executor surface |
| C | Import executor contract lands | `src/main/storage/postgres/PostgresJsonImportRepository.ts`, repository tests | transactional PostgreSQL JSON import writer |
| D | Contract and C repository API known | `src/main/storage/postgres/PostgresImportExecutor.ts`, `PostgresStorageSession.ts`, executor tests | PostgreSQL session import executor |
| E | Contract and B adapter known | `src/main/ipc/handlers/import-logic.ts`, `src/main/ipc/handlers/import.ts`, handler tests | `import:start` routes through active storage session |
| F | Baseline branch | `tests/e2e/postgres-json-import-dev-mode.e2e.ts` | Docker-backed red acceptance test before implementation; green validation after import lanes land |
| G | F green | planning docs only | follow-up notes for VCF import phase if blockers are discovered |

Do not dispatch multiple workers against the same file set. Shared files are `src/main/storage/session.ts`, `src/main/ipc/handlers/import-logic.ts`, and `src/main/storage/postgres/PostgresStorageSession.ts`; changes there should be serialized by the controller.

## Acceptance Criteria

- Phase 8 implementation happens on one branch, recommended name: `feat/postgres-parity-phase-8-json-import`.
- The branch produces one PR.
- SQLite import behavior remains unchanged.
- PostgreSQL `import:start` supports single-file JSON import and rejects VCF with a clear unsupported message.
- Imported PostgreSQL data is readable through existing cases, case metadata, and variants APIs.
- Docker-backed PostgreSQL E2E proves an actual import into PostgreSQL, not seed-only reads.
- Unit tests cover duplicate names, transaction rollback, batch insert shape, provenance, frequency refresh, and unsupported VCF.
- `make ci` passes before PR.
- Docker validation command above is run locally when Docker is available; if Docker is unavailable, the PR notes must say so explicitly.
