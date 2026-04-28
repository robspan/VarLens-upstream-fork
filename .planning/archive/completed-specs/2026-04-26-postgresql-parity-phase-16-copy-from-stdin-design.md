# PostgreSQL Parity Phase 16: VCF Import via COPY FROM STDIN

**Date:** 2026-04-26
**Status:** Proposed (revised after first technical review)
**Depends on:**

- [PostgreSQL Parity Phase 7: Variants Read Parity](../archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md)
- [PostgreSQL Parity Phase 8: Import and Dataset Creation](../archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md)
- [PostgreSQL Parity Phase 9: VCF Import and PostgreSQL Import Worker](../archive/completed-specs/2026-04-25-postgresql-parity-phase-9-vcf-import-and-import-worker.md)
- [PostgreSQL Parity Phase 9.1: Large Variant Coordinate Index](../archive/completed-specs/2026-04-25-phase-9.1-large-variant-index-design.md)

**Goal:** Replace the per-batch multi-row `INSERT ... SELECT ... jsonb_to_recordset` write transport in the PostgreSQL **VCF** import worker with `COPY FROM STDIN` (text format) via `pg-copy-streams`, layered with two session-scoped tuning levers (`SET LOCAL synchronous_commit = OFF` per per-batch transaction, plus a bracket-transaction trigger-defer pattern for the three FTS `tsvector` triggers on `variants`, `variant_sv`, and `variant_str`), so that PostgreSQL VCF imports become **strictly faster than SQLite** on WGS-scale fixtures while retaining the existing per-batch-commit shape that keeps WGS imports inside the 1 GB Node-heap budget, and while preserving all Phase 9 / 9.1 correctness, cancellation (including partial-committed-state semantics), multi-file, BED-filter, extension-table, and large-allele guarantees.

## Background and Motivation

Phase 9.1 closed the correctness gate by replacing the column-tuple btree on `(chr, pos, ref, alt, case_id)` with a stored generated `coord_hash BYTEA` (sha256 of length-prefixed encoding) that scales to multi-MB alleles. With correctness solved, the post-fix WGS comparison artifact (`.planning/artifacts/perf/wgs-import/2026-04-26T07-01-37-561Z-comparison.md`) showed PostgreSQL at **170.93 s** versus SQLite at **52.88 s** — a ratio of **3.09×**, above the **2× threshold** the Phase 9 spec set as the trigger for `COPY FROM STDIN` escalation.

The codebase review at `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md` (overall rating 8.5/10) names this as **Priority F** and recommends it as the next phase to execute. `AGENTS.md`'s WGS subsection documents `pg-copy-streams` as the next step explicitly.

The bar for this phase is **strictly faster than SQLite**, not "within 2× of SQLite". Closing the gap with COPY alone would be enough to clear the original 2× trigger but would leave Postgres slower than the in-process SQLite baseline — an outcome that, while acceptable per the Phase 9 spec, would foreclose the long-term VarLens narrative of "switch to PostgreSQL when you outgrow SQLite". Beating SQLite on local WGS imports requires three layered changes that compound multiplicatively. Each is a documented, well-understood Postgres optimisation; together they put Postgres comfortably ahead.

Per the published guidance ([PostgreSQL Documentation: Populating a Database](https://www.postgresql.org/docs/current/populate.html), [Citus: Faster bulk loading in Postgres with COPY](https://www.citusdata.com/blog/2017/11/08/faster-bulk-loading-in-postgresql-with-copy/), [CYBERTEC: PostgreSQL bulk loading](https://www.cybertec-postgresql.com/en/postgresql-bulk-loading-huge-amounts-of-data/), [EDB: 7 Best Practice Tips for PostgreSQL Bulk Data Loading](https://www.enterprisedb.com/blog/7-best-practice-tips-postgresql-bulk-data-loading)):

- COPY FROM STDIN is **3–5×** faster than equivalent INSERT batches.
- Asynchronous commit (`synchronous_commit = OFF`) is **1.5–3×** faster on top of that for fsync-bound workloads.
- Disabling per-row triggers and bulk-rebuilding the affected column post-load is **1.3–2×** faster on top of that.

The combination's published envelope is **6–30× faster than INSERT**. Applied to the 170.93 s baseline, that lands PostgreSQL between 6 s and 28 s — a comfortable **2–10× faster than SQLite's 52.88 s**.

## Schema Reality Check

This section locks the actual column / type / trigger / index layout the phase touches, quoted directly from `scripts/postgres/init-db/12-phase7-variants.sql`. No illustrative paraphrases.

### Columns

- `variants` has `search_document tsvector` (nullable). The `coord_hash BYTEA GENERATED ALWAYS AS (...) STORED` column **must be excluded from any COPY column list** — Postgres rejects writes to generated-always columns.
- `variant_sv` has `search_document tsvector` (nullable). No generated columns.
- `variant_str` has `search_document tsvector` (nullable). No generated columns.
- `variant_transcripts` has NO `search_document` column.
- `variant_cnv` has NO `search_document` column.
- `variant_frequency` has `coord_hash BYTEA GENERATED ALWAYS AS (...) STORED` (must be excluded from any COPY) and is **not touched by Phase 16** (`rebuildVariantFrequencyForCase` already runs as a single SQL statement once per case).
- `variants.info_json` is `TEXT`, not `jsonb`. The encoder's `encodeJsonb` path is therefore **reserved for future use** and never called on the Phase 16 hot path; `info_json` is emitted via `encodeText`.

### Triggers (verbatim from the schema, lines 139–182)

All three triggers are `BEFORE INSERT OR UPDATE FOR EACH ROW` — they fire on **both** INSERT and UPDATE. This is load-bearing for the bulk-UPDATE step below: while the triggers are disabled, the bulk UPDATE that populates `search_document` does **not** retrigger.

| Trigger | Table | Function body — exact tsvector expression |
|---|---|---|
| `variants_search_document_tg` | `variants` | `to_tsvector('simple', concat_ws(' ', NEW.gene_symbol, NEW.consequence, NEW.omim_mim_number, NEW.func, NEW.transcript, NEW.cdna, NEW.aa_change))` |
| `variant_sv_search_document_tg` | `variant_sv` | `to_tsvector('simple', concat_ws(' ', NEW.event_id, NEW.mate_id))` |
| `variant_str_search_document_tg` | `variant_str` | `to_tsvector('simple', concat_ws(' ', NEW.repeat_id, NEW.variant_catalog_id, NEW.repeat_unit, NEW.display_repeat_unit, NEW.str_status, NEW.disease))` |

### Indexes relevant to Phase 16 predicates

| Index | Columns | Phase 16 use |
|---|---|---|
| `variants_pkey` | `(id)` | Bulk-UPDATE predicate: `WHERE id = ANY($1)` over per-batch reserved IDs. **Primary path.** |
| `idx_variants_case_type` | `(case_id, variant_type)` | Available case_id-leading index — not used by the bulk UPDATE because the per-batch ID predicate is tighter. |
| `idx_variants_case_gene` | `(case_id, gene_symbol)` | Same — not used. |
| `idx_variants_case_pos` | `(case_id, chr, pos)` | Same — not used. |
| `idx_variants_case_consequence` | `(case_id, consequence)` | Same — not used. |
| `idx_variants_case_func` | `(case_id, func)` | Same — not used. |
| `idx_variants_coord_hash_case` | `(coord_hash, case_id)` | Phase 9.1 cross-case lookup; `case_id` is the **second** column, so this index does **not** efficiently serve `WHERE case_id = $1` on its own. The phase-16 design avoids predicates that would need it. |
| `variant_sv_pkey` | `(variant_id)` | `variant_sv` bulk-UPDATE predicate: `WHERE variant_id = ANY($1)`. |
| `variant_str_pkey` | `(variant_id)` | `variant_str` bulk-UPDATE predicate: `WHERE variant_id = ANY($1)`. |

The Phase 16 bulk UPDATE on `variants` uses `WHERE id = ANY($1)` over the **per-batch** array of pre-reserved IDs, which the worker has in memory after the COPY. The PK index serves this directly. Per-batch UPDATE cost is O(rows-in-this-batch), independent of total rows in the case or in the table. No new index is required.

## Worker Reality Check (per-batch commit shape)

`src/main/workers/postgres-import-worker.ts:335-345` shows the load-bearing constraint that any Phase 16 design must respect. The worker commits **per batch**:

```
// Commit per-batch so postgres releases per-tuple bookkeeping and
// the pg-node client releases its query/result references. Without
// this the worker's working set scales linearly with file size on
// large WGS imports — the original single-transaction shape OOMed
// multi-GB Node heaps on the GIAB HG002 fixture.
await client.query('COMMIT')
await client.query('BEGIN')
```

Phase 9.x cancellation tests (`tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts:116`) further confirm that **partial committed state is permitted** on cancellation: each successfully-committed batch is durable; cancellation between batches simply stops the loop.

Phase 16's transaction model **must** preserve both properties. Any design that puts the entire import inside a single transaction is rejected.

## Goals

1. PostgreSQL VCF imports use `COPY FROM STDIN` (text format, via `pg-copy-streams`) for the per-batch write of `variants` and the four extension tables (`variant_transcripts`, `variant_sv`, `variant_cnv`, `variant_str`).
2. PostgreSQL VCF imports apply two session-scoped levers:
   - `SET LOCAL synchronous_commit = OFF` issued at the start of **every per-batch transaction**. The setting is per-transaction and reverts at each `COMMIT`.
   - **Bracket-transaction** trigger defer for all three FTS triggers (`variants_search_document_tg`, `variant_sv_search_document_tg`, `variant_str_search_document_tg`): a leading worker transaction commits the three `DISABLE TRIGGER` statements before the per-batch loop begins; the per-batch loop COPYs and runs scoped bulk UPDATEs against `search_document`; a trailing worker transaction commits the three `ENABLE TRIGGER` statements after the loop ends. A startup recovery shim at the top of every worker session unconditionally re-enables all three triggers (idempotent — no-op if already enabled), so a hard-killed worker leaves the database in a recoverable state.
3. WGS perf hard target: **PostgreSQL strictly faster than SQLite** on the GIAB HG002 v4.2.1 fixture. Soft target: PostgreSQL ≤ 50 % of SQLite wall time.
4. All Phase 9 / 9.1 correctness, cancellation (including **partial-committed-state**), multi-file, BED-filter, large-allele, and extension-table guarantees are preserved unchanged. The 10 Phase 9 E2E scenarios all pass against the new transport.
5. Heap budget unchanged: peak Node heap stays ≤ 1 GB on the WGS fixture. Per-batch `COMMIT; BEGIN` cycle is **preserved**. Backpressure between the row producer and the COPY stream is owned by `node:stream.pipeline()`.
6. Hard cutover for VCF. The phase deletes the VCF `INSERT ... SELECT ... jsonb_to_recordset` path in the same PR that introduces COPY. No feature flag, no env var, no kill switch. Per Phase 9 precedent.

## Non-Goals

- **PostgreSQL JSON import path.** Removed from Phase 16 scope after the technical review surfaced the difference in extension-row ID-discovery semantics between VCF (ordinal-from-file) and JSON (`writeBatchedVariantsAndExtensions` discovers IDs via `RETURNING` over `jsonb_to_recordset` — a fundamentally different shape). JSON imports are typically small, run only on user-curated case files, and are not on the WGS hot path. JSON-on-COPY is a Phase 16.x follow-up if measurements show it matters; until then JSON keeps the current Phase 8 path unchanged.
- **Binary COPY format.** Text format's published 3–5× win is sufficient to clear the goal once stacked with the two session levers. Binary (via `pg-copy-streams-binary`) leaves further headroom but is materially more code and adds a dev dependency. Tracked as a future polish phase only if Phase 16's measurements somehow underdeliver.
- **Drop non-PK indexes before COPY, recreate after.** Published win is 2–3× on top of COPY, but is **unsafe** for VarLens' workload. The `variants` table is shared across cases; at the moment a Phase 16 import starts, the table already has rows from N other cases. Dropping any case_id-leading index mid-import would degrade those other cases' read queries to seq-scan for the duration. Postgres index drops are table-wide. Future partition-attach patterns are noted but out of scope.
- **`UNLOGGED` table during load, then `ALTER` to `LOGGED`.** Genuinely unsafe — a Postgres crash mid-import truncates the table, including rows from prior imports. `synchronous_commit = OFF` provides most of the WAL-skip win without the truncate hazard.
- **Parallel COPY (multiple workers writing different file partitions).** Significant complexity for unclear gain; Postgres serialises index builds anyway. The single-connection, sequential-COPY shape under Phase 16 is enough to clear the goal.
- **`variant_frequency` rebuild path change.** `rebuildVariantFrequencyForCase` already runs as a single SQL statement once per case. Phase 16 does not touch it.
- **Partition-by-case schema migration.** Out of scope.
- **SQLite import path.** Unchanged.
- **Renderer-side import progress UX changes.** No changes to IPC, no changes to the progress payload. Phase 16 is a write-transport swap, not a feature.

## Architectural Decisions (Locked)

1. **Text format COPY via `pg-copy-streams`.**
   - Library: `pg-copy-streams` (^7.x), runtime dependency, mature (last published 2024, ~2 M weekly downloads, maintained by `brianc` of `node-postgres`).
   - Transport: `client.query(copyFrom(sql))` returns a `Writable`; rows are produced by an async generator yielding text-format Buffers; `node:stream.pipeline()` glues the two together. `pipeline()` owns backpressure, error propagation, and `CopyFail` cleanup on producer failure.
   - Reference: [`pg-copy-streams` README](https://github.com/brianc/node-pg-copy-streams), [Node.js Stream pipeline docs](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback).

2. **Pre-reserved BIGSERIAL IDs with explicit ordinal ordering.**
   - Per batch:
     ```sql
     SELECT
       g.ord                                              AS ordinal,
       nextval(pg_get_serial_sequence($1, 'id'))::bigint  AS id
     FROM generate_series(0, $2 - 1) AS g(ord)
     ORDER BY g.ord;
     ```
     where `$1` is `'<schema>.variants'` and `$2` is the batch size. The explicit `ordinal` column + `ORDER BY ord` makes the ordinal-to-ID contract part of the SQL, not a side-effect of `generate_series` row ordering.
   - The worker holds the resulting `Array<{ ordinal, id }>` in memory for the duration of the batch. Variants rows are COPY'd with the explicit `id`. Extension rows reference `variant_id` resolved by ordinal.
   - Sequence advance is permanent on rollback (gaps in `variants.id` are normal Postgres behaviour and invisible to anything but `pg_dump` ordering).
   - `pg_get_serial_sequence` is used in preference to a hard-coded sequence name so a future migration to `GENERATED BY DEFAULT AS IDENTITY` does not silently break the import path.
   - Reference: [PostgreSQL Documentation: CREATE SEQUENCE](https://www.postgresql.org/docs/current/sql-createsequence.html), [PostgreSQL Documentation: Numeric Types — Serial Types](https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-SERIAL).

3. **`SET LOCAL synchronous_commit = OFF` per per-batch transaction.**
   - Issued immediately after each per-batch `BEGIN`. `SET LOCAL` reverts at each `COMMIT`; the setting does not leak out of the import worker. Other connections (renderer reads, IPC handlers, write executor for non-import paths) are unaffected.
   - Crash window: up to ~600 ms (3 × default `wal_writer_delay` of 200 ms) of WAL not yet flushed to disk on OS power loss. Each per-batch `COMMIT` is a separate durability unit; on OS crash, only the in-flight uncommitted batch is lost — earlier committed batches remain. This matches the existing partial-committed-state semantics. The user retries the import; the worker's existing duplicate-name/extend-case logic handles resumption.
   - Reference: [PostgreSQL Documentation: Asynchronous Commit](https://www.postgresql.org/docs/current/wal-async-commit.html).

4. **Bracket-transaction trigger defer with startup recovery shim.**
   - Per import (NOT per batch):
     1. **Recovery shim — at every worker process start.** Idempotent re-enable of all three triggers, in its own auto-commit transaction:
        ```sql
        ALTER TABLE "<schema>"."variants"    ENABLE TRIGGER variants_search_document_tg;
        ALTER TABLE "<schema>"."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg;
        ALTER TABLE "<schema>"."variant_str" ENABLE TRIGGER variant_str_search_document_tg;
        ```
        `ENABLE TRIGGER` on an already-enabled trigger is a no-op. Cost: ~milliseconds. This catches any prior-session hard kill.
     2. **Leading bracket transaction — before the per-batch loop.** A single auto-commit transaction issuing the three `DISABLE TRIGGER` statements. Commits before the first batch begins.
     3. **Per-batch transaction loop.** Each batch begins, runs `SET LOCAL synchronous_commit = OFF`, reserves IDs, COPYs all five tables, runs three scoped bulk UPDATEs (one per table that has `search_document`), and commits.
     4. **Trailing bracket transaction — after the per-batch loop.** A single auto-commit transaction issuing the three `ENABLE TRIGGER` statements. Committed in a `try/finally` at the worker level so it runs on every exit path: success, cancellation, error, multi-file partial completion.
   - **Why bracket, not per-batch:** disabling/enabling each trigger inside every per-batch transaction would mean 6 ALTER TABLE statements per batch × N batches per import. Each `ALTER TABLE` takes a `ShareRowExclusiveLock` and has a non-trivial fixed cost (catalog write). Bracketing pays the cost three times per import instead of `6N` times.
   - **Why `try/finally` plus the startup shim:** the `try/finally` covers expected exits (success / cancellation / handled error). The startup shim covers worker hard-kills (`kill -9`, OS OOM, segfault) where `try/finally` does not run. Together they guarantee the trigger state always recovers.
   - **The bulk UPDATEs scoped by per-batch IDs.** Each batch's UPDATE uses the array of variant IDs the worker just reserved, NOT `case_id`:
     ```sql
     -- For variants (always run, the variants COPY happened):
     UPDATE "<schema>"."variants"
     SET    search_document = compute_variants_search_document(variants)
     WHERE  id = ANY($1::bigint[]);

     -- For variant_sv (only when sv rows were COPY'd this batch):
     UPDATE "<schema>"."variant_sv"
     SET    search_document = compute_variant_sv_search_document(variant_sv)
     WHERE  variant_id = ANY($2::bigint[]);

     -- For variant_str (only when str rows were COPY'd this batch):
     UPDATE "<schema>"."variant_str"
     SET    search_document = compute_variant_str_search_document(variant_str)
     WHERE  variant_id = ANY($3::bigint[]);
     ```
     The variants UPDATE is served by `variants_pkey` (B-tree on `id`). The extension UPDATEs are served by `variant_sv_pkey` and `variant_str_pkey` (the extension PKs are `variant_id`). Each UPDATE is O(per-batch rows), not O(table) and not O(case rows). The `IS NULL` predicate the prior draft suggested is unnecessary because (a) the triggers are disabled when these UPDATEs run and (b) the row IDs are the ones we just inserted in this batch — no other writer is touching them.
   - **Why the bulk UPDATE doesn't retrigger:** the triggers are `BEFORE INSERT OR UPDATE`. With them disabled (the bracket transaction is the active state during the per-batch loop), the bulk UPDATE silently writes the tsvector. After the trailing bracket transaction enables triggers, any subsequent UPDATE to `search_document` (e.g. user-driven re-annotation) will re-fire the trigger and recompute — correct behaviour.
   - Lock: `ALTER TABLE … DISABLE/ENABLE TRIGGER` takes `ShareRowExclusiveLock` (Postgres ≥9.5). Concurrent `SELECT` reads are not blocked. Concurrent writes from another session would block briefly during the bracket transactions; VarLens is single-user so this never happens in practice.
   - Reference: [PostgreSQL Documentation: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html).

5. **Trigger expressions extracted into reusable SQL functions.**
   - Three new SQL functions, each returning `tsvector` (matching the column type) and each accepting a row of the corresponding table:
     - `compute_variants_search_document(v variants)    RETURNS tsvector`
     - `compute_variant_sv_search_document(s variant_sv) RETURNS tsvector`
     - `compute_variant_str_search_document(t variant_str) RETURNS tsvector`
   - Each function body contains the **exact** `to_tsvector('simple', concat_ws(' ', …))` expression from the live trigger function (quoted in the Schema Reality Check above). Verbatim.
   - The three existing trigger functions (`update_variants_search_document`, `update_variant_sv_search_document`, `update_variant_str_search_document`) are rewritten to call their corresponding `compute_*` function: each body becomes `BEGIN NEW.search_document := compute_<table>_search_document(NEW); RETURN NEW; END;`.
   - The Phase 16 bulk `UPDATE`s call the same `compute_*` functions, which guarantees byte-for-byte identical tsvector output to what the trigger would produce. Function drift is structurally impossible — both code paths execute the same function body.
   - Migration is **additive only** at the schema level: three `CREATE OR REPLACE FUNCTION` for the new functions + three `CREATE OR REPLACE FUNCTION` for the rewritten trigger functions. No data migration, no column change, no row touch, no trigger recreation, no index rebuild.

6. **Sequential COPY of the four extension tables, not `Promise.all`.**
   - Considered: `Promise.all([copyTranscripts, copySV, copyCNV, copySTR])` to overlap encoder work in JS while the single connection multiplexes serial COPY messages.
   - Rejected: the connection serialises wire-protocol COPY messages anyway, so Postgres-side throughput is unchanged; the JS-side encoder overlap is small (extension batches are far smaller than the variants batch); and parallel error paths complicate `pipeline()` cleanup. Sequential is simpler and roughly equivalent.
   - The plan reverses this only if a measurement shows a meaningful win.

7. **Encoder is a pure module; bulk-write helper isolates `pg-copy-streams`.**
   - `src/main/storage/postgres/copy-text-encoder.ts` — pure functions; no `pg` imports; unit-testable in complete isolation; round-trip property-tested via `fast-check` against a JS reference decoder.
   - `src/main/storage/postgres/postgres-bulk-write.ts` — the single place in the codebase that imports `pg-copy-streams`. If `pg-copy-streams` is ever superseded, the swap is one file.
   - Encoder contract (`CopyColumnEncoder = (value: unknown) => string`) is the seam for a future binary-format encoder; the bulk-write helper is the seam for a future binary transport.

8. **Hard cutover for VCF only. JSON path unchanged.**
   - Phase 16 deletes the `INSERT ... SELECT ... jsonb_to_recordset` path in `PostgresVcfImportRepository.writeVcfFile` and `PostgresVcfImportRepository.insertExtensionBatch` in the same PR that introduces COPY.
   - `PostgresJsonImportRepository` is **not modified**. The JSON path keeps its existing Phase 8 INSERT shape. JSON-on-COPY is tracked as a separate follow-up phase.
   - Per Phase 9 precedent. The WGS perf comparison artifact in the PR description provides measurement-backed evidence; an env var to A/B benchmark would only ossify the loser branch.

9. **All SQL is schema-qualified using the existing `quoteIdentifier` pattern.**
   - Every `COPY`, `ALTER TABLE`, `UPDATE`, and `compute_*` call must use `${quoteIdentifier(schema)}."<table>"` style, consistent with the existing repository code (e.g. `PostgresVcfImportRepository.ts:147`).
   - Pseudocode in this spec omits schema qualification for legibility; implementation must include it.
   - The plan-writing pass enumerates each SQL statement and confirms quoting in a per-task checkbox.

## Architecture

### Component layout

| File | New / Modified / Deleted | Purpose |
|---|---|---|
| `src/main/storage/postgres/copy-text-encoder.ts` | **New** | Pure encoder — value → COPY text-format token. Per-type encoders (text, integer, float, boolean, jsonb, bytea, array). No `pg` imports. `encodeText` rejects U+0000 with a typed error. |
| `src/main/storage/postgres/postgres-bulk-write.ts` | **New** | `runBulkCopy({ client, sql, columns, rows })` — wraps `client.query(copyFrom(sql))` with `node:stream.pipeline()` and an async row encoder. Single `pg-copy-streams` import in the codebase. |
| `scripts/postgres/init-db/16-phase16-search-document-fns.sql` | **New** | Idempotent migration: creates `compute_variants_search_document(variants)`, `compute_variant_sv_search_document(variant_sv)`, `compute_variant_str_search_document(variant_str)`; rewrites `update_variants_search_document()`, `update_variant_sv_search_document()`, `update_variant_str_search_document()` to call them. Additive only. |
| `src/main/storage/postgres/PostgresVcfImportRepository.ts` | **Modified** | `writeVcfFile` body replaced; uses `runBulkCopy` for variants + 4 extension tables; pre-reserves IDs via `pg_get_serial_sequence` with explicit ordinal ordering; runs the three scoped bulk UPDATEs at the end of each batch (still inside the per-batch transaction). Public method signature unchanged. `insertExtensionRows` / `insertExtensionBatch` deleted. |
| `src/main/storage/postgres/PostgresJsonImportRepository.ts` | **Unchanged** | Out of Phase 16 scope. JSON keeps the existing Phase 8 INSERT path. |
| `src/main/storage/postgres/postgres-import-columns.ts` | **Modified** | `VARIANT_BATCH_RECORDSET_TYPES`, `TRANSCRIPT_RECORDSET_TYPES`, `SV_RECORDSET_TYPES`, `CNV_RECORDSET_TYPES`, `STR_RECORDSET_TYPES` deleted (no longer needed for the VCF path). Column-list constants kept. New constants for the COPY column lists: `VARIANT_COPY_COLUMNS` (excludes `coord_hash` generated, excludes `search_document` deferred), `VARIANT_TRANSCRIPT_COPY_COLUMNS`, `VARIANT_SV_COPY_COLUMNS` (excludes `search_document` deferred), `VARIANT_CNV_COPY_COLUMNS`, `VARIANT_STR_COPY_COLUMNS` (excludes `search_document` deferred). |
| `src/main/workers/postgres-import-worker.ts` | **Modified** | Top of every worker session: run the recovery shim (`ENABLE TRIGGER` × 3, idempotent). Per import: leading bracket txn (DISABLE × 3); per-batch loop preserved with `SET LOCAL synchronous_commit = OFF` + COPY + scoped UPDATEs; trailing bracket txn (ENABLE × 3) inside `try/finally`. Cancellation between batches unchanged — partial-committed-state semantics preserved. |
| `package.json` | **Modified** | Add `pg-copy-streams: ^7.0.0` runtime dep. Add `fast-check: ^4.x` dev dep. |
| `tests/storage/postgres/copy-text-encoder.test.ts` | **New** | Per-encoder boundary tests + `fast-check` property tests. Coverage gate: 100 % line + 100 % branch on the encoder file. |
| `tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts` | **New** | Docker-gated repository integration tests covering the new VCF path. |
| `tests/storage/postgres/postgres-import-worker.recovery.test.ts` | **New** | Test the worker startup recovery shim: simulate a prior-session leak (DISABLE × 3, no ENABLE), launch a new worker, assert all three triggers are enabled before the first import begins. |
| `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts` | **New** | Cancellation mid-import; assert partial-committed-state semantics preserved (committed batches remain), assert all three triggers end up enabled (via the `try/finally` path), assert no rows for the cancelled in-flight batch. |
| `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts` | **New** | 9.7 KB ALT allele + INFO with embedded special chars; assert round-trip correctness through the COPY text path; assert `search_document` populated correctly post-import. |
| Existing 10 Phase 9 E2E scenarios | **Unmodified, must pass** | Re-run against the new transport. |
| `scripts/perf/compare-wgs-import.mjs` | **Unmodified** | Existing comparison harness reused as-is. |

### Per-import data flow

```
WORKER STARTUP
  // Recovery shim — auto-commit, idempotent.
  ALTER TABLE "<schema>"."variants"    ENABLE TRIGGER variants_search_document_tg
  ALTER TABLE "<schema>"."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg
  ALTER TABLE "<schema>"."variant_str" ENABLE TRIGGER variant_str_search_document_tg

PER IMPORT (single-file or one file of multi-file)
  // Leading bracket transaction.
  BEGIN
  ALTER TABLE "<schema>"."variants"    DISABLE TRIGGER variants_search_document_tg
  ALTER TABLE "<schema>"."variant_sv"  DISABLE TRIGGER variant_sv_search_document_tg
  ALTER TABLE "<schema>"."variant_str" DISABLE TRIGGER variant_str_search_document_tg
  COMMIT

  try {
    // Per-batch loop — preserves the existing per-batch-commit shape.
    BEGIN
    for await (row of streamMappedVcfRows(filters)):
        accumulate into in-memory batch arrays (variants, transcripts, sv, cnv, str)
        if (variants.length >= batchSize): flush()

    flush()  // final partial batch
    COMMIT  // last batch
  } finally {
    // Trailing bracket transaction — ALWAYS runs.
    BEGIN
    ALTER TABLE "<schema>"."variants"    ENABLE TRIGGER variants_search_document_tg
    ALTER TABLE "<schema>"."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg
    ALTER TABLE "<schema>"."variant_str" ENABLE TRIGGER variant_str_search_document_tg
    COMMIT
  }

PER BATCH (flush())
  COMMIT       // close the previous batch
  BEGIN        // new per-batch transaction
  SET LOCAL synchronous_commit = OFF

  // Reserve IDs for this batch.
  SELECT g.ord AS ordinal, nextval(...)::bigint AS id
  FROM   generate_series(0, $batchSize - 1) AS g(ord)
  ORDER BY g.ord
    →  Array<{ ordinal, id }>  in worker memory

  // COPY variants with explicit `id`.
  pipeline(
    encodeRowsToCopyText(VARIANT_COPY_COLUMNS, rowsWithIds),
    client.query(copyFrom(`COPY "<schema>"."variants" (id, case_id, ...) FROM STDIN`))
  )

  // COPY each non-empty extension table, sequentially.
  for table in [variant_transcripts, variant_sv, variant_cnv, variant_str]:
    if rows.length > 0:
      pipeline(
        encodeRowsToCopyText(table.columns, resolveOrdinalToVariantId(rows, ids)),
        client.query(copyFrom(`COPY "<schema>"."<table>" (variant_id, ...) FROM STDIN`))
      )

  // Scoped bulk UPDATEs — predicate by THIS batch's reserved IDs.
  UPDATE "<schema>"."variants"
  SET    search_document = compute_variants_search_document(variants)
  WHERE  id = ANY($1::bigint[])           -- $1 = variants IDs for this batch

  if (sv.length > 0):
    UPDATE "<schema>"."variant_sv"
    SET    search_document = compute_variant_sv_search_document(variant_sv)
    WHERE  variant_id = ANY($1::bigint[])  -- $1 = SV variant_ids for this batch

  if (str.length > 0):
    UPDATE "<schema>"."variant_str"
    SET    search_document = compute_variant_str_search_document(variant_str)
    WHERE  variant_id = ANY($1::bigint[])  -- $1 = STR variant_ids for this batch

  // (Existing per-batch tail: post progress, GC hint, return.)
  // Outer loop continues; next flush() will COMMIT this batch.
```

### Encoder rules

| Postgres type | Encoder | Special handling |
|---|---|---|
| `text` | `encodeText` | NULL → `\N`. Escape `\` `\n` `\r` `\t` (backslash first). Empty string is NOT NULL. **U+0000 (Unicode NUL) → throws `EncoderInvalidValueError`** — Postgres `text` type rejects NUL bytes; surfacing the corruption is safer than silently stripping. **`info_json` (currently `TEXT` in the schema) uses this encoder**, even though it carries stringified JSON. |
| `bigint`/`int4`/`int8` | `encodeInteger` | NULL → `\N`. `String(value)` — no escape characters possible. |
| `float8`/`real` | `encodeFloat` | NULL → `\N`. NaN → token `NaN`. ±Infinity → `Infinity` / `-Infinity` (Postgres `float8` accepts these tokens). |
| `boolean` | `encodeBoolean` | `true` → `t`, `false` → `f`, NULL → `\N`. |
| `jsonb` | `encodeJsonb` | **Reserved — no Phase 16 caller.** `info_json` is `TEXT`, so the `jsonb` encoder is unused on the hot path. The implementation lives in the encoder module to document the safe path for any future migration to `jsonb`: NULL → `\N`. `JSON.stringify(value)`, then strip Unicode `U+0000` (JSONB also rejects), then **double-escape every backslash** so wire bytes survive COPY's escape-decoder before reaching the JSONB caster (research-confirmed pitfall — Postgres COPY un-escapes `\r` to a raw CR before the JSONB cast, and JSONB rejects raw control characters). Final pass escapes `\n` `\r` `\t` for transport. |
| `bytea` | `encodeBytea` | NULL → `\N`. `\\x` + hex of the buffer. (No Phase 16 caller — reserved for future use.) |
| `text[]`/`int[]` | `encodeArray` | NULL → `\N`. Postgres array literal `'{a,b,c}'` with element escaping per element type. (No Phase 16 caller — reserved.) |

`tsvector` does **not** appear in this table — none of the COPY column lists includes a `search_document` column. `coord_hash` is likewise excluded — both columns are populated server-side (one by trigger / bulk UPDATE; the other by the generated-always expression).

### Bulk-write helper contract

```ts
// src/main/storage/postgres/postgres-bulk-write.ts
import * as stream from 'node:stream'
import { from as copyFrom } from 'pg-copy-streams'
import type { PoolClient } from 'pg'
import { encodeRowsToCopyText, type CopyColumnEncoder } from './copy-text-encoder'

export async function runBulkCopy(params: {
  client: PoolClient
  sql: string                  // e.g. `COPY "<schema>"."variants" (id, ...) FROM STDIN`
  columns: ReadonlyArray<{ name: string; encoder: CopyColumnEncoder }>
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
}): Promise<void> {
  const copyStream = params.client.query(copyFrom(params.sql))
  await stream.promises.pipeline(
    encodeRowsToCopyText(params.columns, params.rows),
    copyStream,
  )
}
```

This is the entire bulk-write surface in the codebase. `PostgresVcfImportRepository` is the only caller in Phase 16.

### Failure modes and recovery

| Failure | Postgres-side effect | VarLens-side effect |
|---|---|---|
| Encoder error mid-COPY (e.g. `EncoderInvalidValueError` for U+0000 in text) | `pipeline()` rejects → COPY stream destroyed → `CopyFail` to backend → **current batch transaction** rolled back | Trailing bracket transaction in `try/finally` re-enables triggers. Earlier committed batches remain (partial-committed-state, per existing Phase 9 semantics). Sequence advance for the failed batch is permanent (gap — normal). Worker posts structured `error` message, terminates. `PostgresImportWorkerClient` calls `terminate()`. |
| Constraint violation in COPY (NOT NULL, FK to `cases`, etc.) | Server errors out of COPY → current batch rolled back | Same as above. |
| Worker thread crash (e.g. uncaught exception) | Connection drops → server rolls back the in-flight batch transaction | Phase 9 worker-uncaughtException handler still active. `try/finally` runs the trailing bracket transaction. |
| Worker process **hard-killed** (`kill -9`, OS OOM, segfault) — `try/finally` does NOT run | Connection drops → in-flight batch rolled back; **bracket-disabled triggers remain disabled** | The next worker process startup runs the recovery shim (`ENABLE TRIGGER` × 3, idempotent). Triggers recover before the next import begins. |
| Cancellation between batches | Worker exits batch loop after the most-recent COMMIT → `try/finally` runs the trailing bracket transaction | Phase 9 cancellation flow unchanged: committed batches durable; in-flight batch (if any) rolled back; triggers re-enabled. |
| OS power loss mid-import | `synchronous_commit = OFF` window: up to ~600 ms of WAL not yet flushed. On Postgres restart, WAL is replayed up to last flushed record. Batches whose COMMIT did not reach disk are lost; earlier committed batches are durable. **Triggers may remain disabled** if the leading bracket commit reached disk but the trailing bracket commit did not. | Recovery shim on next worker startup re-enables triggers idempotently. User retries import. |

The recovery shim is the load-bearing safety net for hard-kill and power-loss scenarios. The `try/finally` is the load-bearing safety net for expected exit paths.

## Testing

Five layers (one more than the prior draft — adding the worker-recovery test). The plan must enumerate tasks for all five.

### Layer 1 — Encoder unit tests (pure, no Postgres)

`tests/storage/postgres/copy-text-encoder.test.ts`. The most important tests in the phase — bugs hide here silently.

- **Per-encoder boundary tests:** null, empty string, integer 0, integer max-bigint, the literal string `\N`, the literal string `\.`, strings containing every escape character, U+0000 in `encodeText` (asserts throw), U+0000 in `encodeJsonb` (asserts strip).
- **Property tests via `fast-check`:** for every encoder, `decode(encode(v)) === v` where `decode` is a small JS reference implementation of Postgres' COPY text decoder (~30 lines, lives in this test file). Property test runs ≥200 random inputs per encoder per pass. The string generator filters U+0000 for `encodeText` (because the encoder throws on it); for `encodeJsonb` the property is `JSON.parse(decode(encode(v))) === stripNul(v)`.
- **Row encoder integration:** given a column list and a row map, the row encoder emits one line ending in `\n` with the right column count and tab separators.

**Coverage gate:** 100 % line + 100 % branch on `copy-text-encoder.ts`. Per-file threshold added to `vitest.config.ts`.

### Layer 2 — Worker recovery test (Postgres-gated, no full E2E)

`tests/storage/postgres/postgres-import-worker.recovery.test.ts`. Gated by `VARLENS_RUN_POSTGRES_E2E=1`.

- **Setup:** open a control client, manually run the three `DISABLE TRIGGER` statements (simulating a prior-session hard kill that left triggers disabled). Verify state via `pg_trigger.tgenabled`.
- **Action:** instantiate a fresh `postgres-import-worker` (no import, just the startup phase).
- **Assert:** `pg_trigger.tgenabled` for all three triggers is `'O'` (enabled) before any import work begins.

### Layer 3 — Repository integration tests (real Postgres, dockerised)

`tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts`. Gated by `VARLENS_RUN_POSTGRES_E2E=1`, runs against the existing `make pg-up` container.

- **Single-batch round-trip:** small fixture, COPY in, SELECT out, every column matches.
- **Multi-batch within one file (`mode: 'append'`):** two batches, second reuses caseId; assert partial-committed-state preserved (first batch's rows remain after a forced second-batch failure).
- **Extension-table FK integrity:** COPY variants + variant_transcripts in the same batch; assert `variant_transcripts.variant_id` matches the IDs we pre-reserved by ordinal.
- **Trigger-defer correctness — three tables:** after a normal import, every variant / variant_sv / variant_str row has a non-null `search_document` value matching what the corresponding trigger would have produced. Golden test: a separate import that bypasses the trigger-defer (manually re-enable triggers around an INSERT-path import in a temp schema), then `EXCEPT`-style equality between the two `search_document` columns for every shared (variant_id) pair.
- **`coord_hash` and `search_document` are never in the COPY column list:** assert the constants in `postgres-import-columns.ts` exclude them; regression guard.
- **`synchronous_commit` does not leak:** after the import commits, run a tiny non-import write in a new transaction on the same pool and confirm `SHOW synchronous_commit` returns the default (`on`).
- **HLA mega-allele round-trip:** the existing 9.7 KB ALT fixture from Phase 9.1; assert `coord_hash` is unchanged; assert no truncation; assert `search_document` is populated correctly.
- **Failure path:** feed a row that violates a NOT NULL constraint mid-batch; assert the batch's COPY fails, the batch transaction rolls back, the **trailing bracket transaction still runs and re-enables all three triggers** (via the `try/finally`), the sequence has advanced (gap — expected), no rows from the failed batch are committed, but rows from prior successful batches in the same import remain.

### Layer 4 — Worker E2E tests (Playwright `_electron`, dockerised)

The 10 Phase 9 E2E scenarios are inherited unchanged and **must pass without modification**. Any flake under the new transport is a Phase 16 regression.

Two new scenarios:

- `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts` — cancel mid-import; assert partial-committed-state preserved; assert all three triggers end up enabled (via `try/finally`); assert no rows for the cancelled in-flight batch; assert sequence has advanced.
- `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts` — fixture with a 9.7 KB ALT allele AND a stringified-JSON `info_json` value containing embedded newlines / CRs / tabs / a backslash. Assert all data round-trips correctly through the COPY text path; assert the three `search_document` columns populated post-import.

### Layer 5 — WGS perf comparison (the success gate)

`.planning/artifacts/perf/wgs-import/`, gated by `VARLENS_RUN_WGS_PERF=1`. The pre-existing harness (`scripts/perf/compare-wgs-import.mjs`) is reused without modification. The PR description must include the post-fix comparison artifact diff inline.

## Acceptance Criteria

The phase lands when **all** of the following hold:

1. **Performance gate:** WGS PG import wall time on the GIAB HG002 v4.2.1 fixture is **strictly less than the SQLite baseline** (currently 52.88 s).
2. **Heap budget:** peak Node heap on the WGS fixture remains ≤ 1 GB.
3. **Per-batch commit shape preserved:** `git diff` on `postgres-import-worker.ts` shows the per-batch `COMMIT; BEGIN;` cycle from line 340-341 of the pre-Phase-16 baseline is still present.
4. **Encoder coverage:** 100 % line + 100 % branch on `copy-text-encoder.ts`.
5. **Worker-recovery test:** the recovery shim test passes (triggers re-enabled idempotently before any import begins).
6. **Repository tests:** every test in `postgres-vcf-import-repository.copy.test.ts` passes against a fresh `make pg-reset && make pg-up`.
7. **E2E suite:** all 10 inherited Phase 9 E2E scenarios pass against the new transport, plus the two new scenarios pass.
8. **Trigger-defer correctness across all three tables:** the golden test confirms the post-COPY bulk `UPDATE`s produce a `search_document` value identical to what the corresponding trigger would have produced for every row in the fixture, on `variants`, `variant_sv`, and `variant_str`.
9. **Hard cutover proof (VCF only):** `git grep` of the merged branch finds no remaining usage of `jsonb_to_recordset` in `PostgresVcfImportRepository`. `PostgresJsonImportRepository` still uses `jsonb_to_recordset` (intentionally — JSON is out of scope).
10. **CI:** `make ci-full` passes locally and on `build.yml`.
11. **Docs:** `AGENTS.md` WGS subsection updated to remove the "Phase 16 escalation" footnote and to record the new comparison ratio. `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md` is left as-is.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The leading bracket-transaction commits but a worker hard-kill happens before the trailing bracket commits, leaving triggers persistently disabled | Low | High — next import goes through trigger-disabled path silently; rows imported by a non-Phase-16 path (e.g. JSON import, future write paths) would skip tsvector population | The worker startup recovery shim runs unconditionally and idempotently. Layer 2 test verifies the shim. Belt and suspenders. |
| `try/finally` does not run on hard kill | Medium | High | The startup recovery shim covers this case. |
| The trailing bracket transaction fails to commit due to a Postgres outage at exactly the wrong moment | Very low | High — same end state as a hard kill | Recovery shim on next worker startup. |
| Encoder rejects U+0000 in text and a real-world VCF actually contains one | Very low | Import fails fast with a clear error | The error message identifies the row offset and column. The user can preprocess the VCF (extremely rare in practice — clinical/research VCFs do not contain NUL bytes) |
| One of the three `compute_*` SQL functions drifts from its trigger function | Very low | `search_document` differs between trigger-path and bulk-UPDATE-path rows | The Decision-5 migration rewrites every trigger function to call its `compute_*` counterpart. Both paths execute the same function body; drift is structurally impossible without editing the function itself, in which case both paths drift together (still consistent, just different from the prior baseline). |
| The bulk UPDATE is unexpectedly slow even with the per-batch ID predicate | Low | Performance — phase target missed | Predicate is `WHERE id = ANY($1::bigint[])` over `variants_pkey` (B-tree on `id`). For a 1000-row batch, this is ~1000 PK lookups + writes — well under a second. Measurement during Phase 16 plan execution confirms. If somehow slow: extend the variants `RETURNING id` style to capture and apply the tsvector at insert time as a workaround — fallback design only. |
| `SET LOCAL synchronous_commit = OFF` causes a perceived data-loss bug report | Low | Reputational — user blames VarLens for an OS-level crash | Documented in AGENTS.md "WGS subsection" with explicit crash-window characterisation. User-facing docs do not need this — it does not change observable behaviour absent a crash. Per-batch commits mean the loss window per batch is ≤ 600 ms, identical to a non-import write. |
| Sequence gaps surprise users running `pg_dump` | Very low | Cosmetic only | Documented in spec and AGENTS.md as expected Postgres behaviour |
| `pg-copy-streams` upstream breakage | Low | Build break on dependency update | Dependabot tracking; encoder + bulk-write isolated to two files; one-file swap to a successor library if needed |
| `pg_get_serial_sequence` returns NULL or a wrong sequence on a future schema change | Very low | Worker errors at start of first batch | Repository tests assert the lookup against a fixture-loaded schema; future schema migrations include this assertion in their own tests |
| Phase 16 measurements show Postgres faster than current INSERT but still slower than SQLite | Low | Goal missed; Phase 16 cannot land | Phase routes to Phase 16.1 (binary format and/or partition-attach pattern) with documented analysis of which lever underdelivered |
| `fast-check` adds maintenance burden / dependency surface | Low | Minor | Mature, widely-used (>1M weekly downloads), and the property tests are the primary defence against silent encoder bugs. The benefit dominates the cost. |

## Out of Scope (Tracked Elsewhere)

- **PostgreSQL JSON import on COPY** — separate phase. Defer until measurements show JSON imports matter at scale.
- **Binary COPY format** — future polish phase if Phase 16 measurements underdeliver.
- **Index drop-and-rebuild during import** — requires partition-by-case schema; tracked under broader storage architecture evolution.
- **Partition-by-case schema migration** — tracked under broader storage architecture evolution.
- **`UNLOGGED` table during load** — rejected as too risky; not tracked.
- **Parallel COPY** — rejected as unnecessary for the goal; not tracked.
- **`info_json` migration from `TEXT` to `jsonb`** — separate decision; spec records that the JSONB encoder is reserved for that future migration.
- **Phase 9.x test isolation** — tracked under Priority C remaining work in `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md`.
- **Other Priority C parity domains** (variant deletes, exports, FTS rebuilds, `database:overview`, lifecycle UX, non-metadata domains) — tracked individually under the storage-session boundary parity programme.

## External References

- [PostgreSQL Documentation: Populating a Database](https://www.postgresql.org/docs/current/populate.html)
- [PostgreSQL Documentation: COPY](https://www.postgresql.org/docs/current/sql-copy.html)
- [PostgreSQL Documentation: Asynchronous Commit](https://www.postgresql.org/docs/current/wal-async-commit.html)
- [PostgreSQL Documentation: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)
- [PostgreSQL Documentation: CREATE SEQUENCE](https://www.postgresql.org/docs/current/sql-createsequence.html)
- [PostgreSQL Documentation: JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL Documentation: pg_trigger](https://www.postgresql.org/docs/current/catalog-pg-trigger.html)
- [Citus: Faster bulk loading in Postgres with COPY](https://www.citusdata.com/blog/2017/11/08/faster-bulk-loading-in-postgresql-with-copy/)
- [CYBERTEC: PostgreSQL bulk loading](https://www.cybertec-postgresql.com/en/postgresql-bulk-loading-huge-amounts-of-data/)
- [EDB: 7 Best Practice Tips for PostgreSQL Bulk Data Loading](https://www.enterprisedb.com/blog/7-best-practice-tips-postgresql-bulk-data-loading)
- [pganalyze: Optimizing bulk loads in Postgres](https://pganalyze.com/blog/5mins-postgres-optimizing-bulk-loads-copy-vs-insert)
- [Tiger Data: Testing Postgres Ingest — INSERT vs Batch INSERT vs COPY](https://www.tigerdata.com/learn/testing-postgres-ingest-insert-vs-batch-insert-vs-copy)
- [pg-copy-streams (npm)](https://www.npmjs.com/package/pg-copy-streams)
- [node-pg-copy-streams (GitHub)](https://github.com/brianc/node-pg-copy-streams)
- [Node.js Documentation: stream.pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback)
- [Node.js Learn: Backpressuring in Streams](https://nodejs.org/learn/modules/backpressuring-in-streams)
- [fast-check: Property-Based Testing for JavaScript and TypeScript](https://fast-check.dev/)
