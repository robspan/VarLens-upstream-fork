# PostgreSQL Parity Phase 7: Variants Read Parity

**Date:** 2026-04-24
**Status:** Completed
**Depends on:** [PostgreSQL Parity Phase 6: Case Metadata and Cases Filters](./2026-04-24-postgresql-parity-phase-6-case-metadata-and-cases-filters.md)
**Planning input:** [PostgreSQL WGS-readiness Inventory](../../artifacts/postgres-parity-phase-6-wgs-readiness.md)
**Goal:** Add PostgreSQL-backed variant read support for the first user-visible variant browsing slice without expanding into import, export, delete, rebuild, cohort, database overview, or renderer PostgreSQL settings work.

## Summary

Phase 6 moved PostgreSQL support from cases-only browsing into case metadata, case filters, a read executor, and a write executor. Phase 7 should use that storage-session boundary for the next high-value read surface: variants.

Phase 7 implements PostgreSQL read parity for:

1. PostgreSQL variant tables, indexes, read-model normalization, and deterministic Docker seed data.
2. `variants:typeCounts`.
3. `variants:typesPresent`.
4. `variants:geneSymbols`.
5. An initial `variants:query` path for case-scoped browsing, pagination, counts, base sorting, base filters, extension-table projections, and PostgreSQL full-text filtering.
6. Basic `variants:filterOptions` and `variants:columnMeta` only if they remain a small read-only extension of the same repository helpers.
7. An explicit PostgreSQL full-text-search strategy using `tsvector` + GIN indexes instead of SQLite FTS5.

This phase does not make PostgreSQL an end-user-ready backend. Import remains SQLite-file-backed, so Phase 7 uses Docker seed SQL for validation. Export, delete, summary rebuild, cohort views, database overview, annotations/tags, and renderer PostgreSQL settings stay out of scope unless a small dependency is required to keep the variant read path honest.

## Scope

### In Scope

- PostgreSQL dev schema for:
  - `variants`
  - `variant_transcripts`
  - `variant_frequency`
  - `variant_sv`
  - `variant_cnv`
  - `variant_str`
  - PostgreSQL FTS columns/indexes needed by variant reads
- PostgreSQL repository methods for:
  - `getVariantTypeCounts(caseId)`
  - `getVariantTypesPresent(scope)`
  - `getGeneSymbols(caseId, query, limit)`
  - `queryVariants(filter, limit, offset, sortBy, skipCount, includeUnfilteredCount)`
  - optionally `getFilterOptions(caseId)` and `getColumnMeta(scope, columnKey)` if they do not expand the phase materially
- Storage read executor tasks for the included `variants:*` channels.
- Handler logic that routes the included `variants:*` reads through `StorageSession.getReadExecutor()`.
- SQLite compatibility routing through `SqliteReadExecutor`, preserving current worker-pool behavior.
- Docker-backed Electron E2E coverage against seeded PostgreSQL data.
- Docker-backed schema smoke coverage before adding Phase 7 DDL.
- Mocked `pg.Pool` unit tests for SQL shape and numeric normalization.

### Out of Scope

- Importing JSON or VCF into PostgreSQL.
- Exporting variants or cohorts from PostgreSQL.
- Deleting cases or variants from PostgreSQL.
- Rebuilding cohort summaries or variant frequency summaries as a write workflow.
- Cohort domain parity, including `cohort:*` channels and cohort summary tables.
- `database:overview`.
- Renderer PostgreSQL settings or storage-backend selection UI.
- Shortlist, tags, annotations, transcripts CRUD, gene lists, region files, panels CRUD, and analysis groups.
- Full inheritance-mode parity for trio/family filters.
- Full panel filter parity via `active_panel_ids`; the existing panel interval resolver is still SQLite-service-backed.

## Phase 7 Variant Query Contract

The initial PostgreSQL `variants:query` path supports:

- required `case_id`
- `limit`, `offset`, `skipCount`, and `includeUnfilteredCount`
- base-column sorting using the existing safe sortable-key allowlist
- default ordering by `pos ASC NULLS LAST, id ASC`
- `variant_type`, including the current SNV-tab behavior where `variant_type = "snv"` includes both `snv` and `indel`
- `gene_symbol` partial match
- `consequence` and `consequences`
- `funcs`
- `clinvars`
- `gnomad_af_max`
- `cadd_min`
- `max_internal_af`, backed by `variant_frequency`
- exact `chr`, `pos`, `ref`, `alt`
- `search_query`, backed by PostgreSQL FTS
- base `column_filters` for allowlisted base columns
- extension `column_filters` and extension sort keys only if the implementation can reuse the existing extension registry safely without broad query-builder rewrites
- selected extension projections for `variant_type = "sv"`, `"cnv"`, and `"str"` matching the SQLite response aliases used by the renderer

The initial PostgreSQL `variants:query` path explicitly does not support:

- `tag_ids`
- `starred_only`
- `has_comment`
- `acmg_classifications`
- `annotation_scope`
- `active_panel_ids`
- large precomputed `panel_intervals`
- `inheritance_modes`
- `analysis_group_id`
- `consider_phasing`

Unsupported filters must fail clearly in the PostgreSQL repository or storage executor before returning misleading partial results. They must not be silently ignored. SQLite behavior must not change.

`variants:search` is also unsupported for PostgreSQL in Phase 7. The IPC channel still exists for SQLite, so PostgreSQL must fail deliberately at the handler or storage-session boundary with a clear Phase 7 unsupported message. It must not fall through to `getDatabaseService()` on a PostgreSQL session.

The `internal_af` computed field and `max_internal_af` filter must match current SQLite semantics: `variant_frequency.case_count / COUNT(cases)`, with `NULL` frequency rows included when filtering. PostgreSQL tests must cover both the displayed computed value and the threshold predicate.

Base `column_filters` support is part of the Phase 7 query contract. It must be implemented for allowlisted base columns or explicitly removed from this phase before implementation begins. Extension `column_filters` and extension sort keys remain optional and must be deferred if they require broad query-builder work.

## PostgreSQL Schema Strategy

Phase 7 should add `scripts/postgres/init-db/12-phase7-variants.sql` after the Phase 6 metadata schema. The schema should mirror the read columns VarLens currently uses from SQLite, while staying honest about read-only scope.

Required base table columns:

- `variants.id BIGSERIAL PRIMARY KEY`
- `variants.case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE`
- coordinate and allele columns: `chr`, `pos`, `ref`, `alt`
- display/filter columns: `gene_symbol`, `omim_mim_number`, `consequence`, `func`, `clinvar`, `transcript`, `cdna`, `aa_change`, `moi`, `hpo_match`
- numeric columns: `gnomad_af`, `cadd`, `qual`, `hpo_sim_score`, `gq`, `dp`, `ad_ref`, `ad_alt`, `ab`
- provenance columns: `filter`, `info_json`, `source_format`
- multi-type columns: `variant_type NOT NULL DEFAULT 'snv'`, `end_pos`, `sv_type`, `sv_length`, `caller`
- `search_document tsvector` for PostgreSQL FTS

Required extension tables:

- `variant_transcripts`, including selected transcript flags
- `variant_frequency`, keyed by `(chr, pos, ref, alt)`
- `variant_sv`, keyed by `variant_id`
- `variant_cnv`, keyed by `variant_id`
- `variant_str`, keyed by `variant_id`

Required indexes:

- `variants(case_id, variant_type)`
- `variants(case_id, gene_symbol)`
- `variants(case_id, chr, pos)`
- `variants(case_id, consequence)`
- `variants(case_id, func)`
- `variants(chr, pos, ref, alt, case_id)`
- `variant_frequency(chr, pos, ref, alt)`
- extension table indexes on `variant_id`
- extension text indexes needed by FTS or metadata lookups
- GIN indexes on `search_document` columns

The Docker seed should add a small but representative fixture:

- one case with SNV and indel rows
- one SV row with `variant_sv`
- one CNV row with `variant_cnv`
- one STR row with `variant_str`
- at least one row with `variant_frequency.case_count > 1`
- enough consequences, funcs, ClinVar values, CADD, and gnomAD AF values to validate filter options

Seeded coordinate values should use one chromosome naming style consistently. Phase 7 uses bare chromosome names such as `1`, `2`, `3`, and `4` so the seeded `variant_frequency` rows join literally to `variants`.

## PostgreSQL FTS Strategy

SQLite uses FTS5 virtual tables:

- `variants_fts`
- `variant_sv_fts`
- `variant_str_fts`

PostgreSQL must not pretend those tables exist. Phase 7 should implement PostgreSQL-native search:

- Use `to_tsvector('simple', ...)` so gene symbols, OMIM values, consequence terms, SV event IDs, and STR disease terms are not English-stemmed.
- Store `search_document tsvector` on `variants`, `variant_sv`, and `variant_str`.
- Keep `search_document` in sync with triggers in the Docker schema.
- Add GIN indexes on each `search_document`.
- Convert a simple search token into a prefix `tsquery` using `to_tsquery('simple', token || ':*')` after sanitizing tokens.
- For `variants:query` `search_query`, filter by `variants.search_document @@ query OR EXISTS (...)` over SV and STR search documents.
- For boolean search, reuse the existing boolean parser only if a small PostgreSQL emitter can preserve AND/OR/NOT semantics safely. If this becomes non-trivial, Phase 7 should support simple token search and document boolean PostgreSQL search as a blocker for a later phase.
- Do not introduce `pg_trgm` as a hard requirement in Phase 7. `geneSymbols` can use `ILIKE $query || '%'` with a functional index on `lower(gene_symbol)` if needed. `pg_trgm` may be evaluated later for fuzzy search.

`variants:search` is not a Phase 7 acceptance channel. The PostgreSQL FTS implementation should be shaped so that channel can be added later without redesign, but Phase 7 acceptance is tied to `search_query` inside `variants:query`.

## Storage and IPC Strategy

Phase 7 should extend the Phase 6 read executor pattern:

- Add variant read tasks to `StorageReadTask`.
- Add `PostgresVariantReadRepository`.
- Inject the repository into `PostgresReadExecutor`.
- Extend `SqliteReadExecutor` to dispatch the same variant tasks to the existing SQLite `DbPool` or `DatabaseService`.
- Refactor variant handler logic to depend on `StorageSession` for included reads.
- Add a PostgreSQL-aware guard before panel interval resolution. If a PostgreSQL session receives `active_panel_ids`, keep the raw filter and let the PostgreSQL repository reject it clearly instead of calling SQLite-only `getDatabaseService()`.

The handler refactor should preserve validation at the IPC boundary. PostgreSQL unsupported filters should be detected after validation and before SQL execution.

## Basic Filter Options and Column Metadata

Phase 7 should attempt basic metadata only after the required read channels and initial query pass unit tests:

- `variants:filterOptions(caseId)` for base columns:
  - `consequences`
  - `funcs`
  - `clinvars`
  - `minCadd`
  - `maxCadd`
  - `minGnomadAf`
  - `maxGnomadAf`
  - `columnMeta` for base sortable columns
- `variants:columnMeta` for base columns and extension columns if the extension registry can be reused safely.

If metadata work requires a broad query-builder rewrite, extension-table abstraction, or cohort-domain assumptions, it should be split into Phase 8 and documented as a blocker. Do not expand Phase 7 to force it in.

## Docker-backed Validation Strategy

Phase 7 should keep Docker PostgreSQL gated outside default CI:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-variants-schema-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts
make pg-down
```

The new Docker E2E should launch Electron with:

```bash
VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres
VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
VARLENS_PG_SCHEMA=public
```

It should verify:

- seeded variant type counts
- variant schema and FTS smoke
- seeded variant types present
- gene-symbol autocomplete
- `variants:query` pagination and total count
- variant type filtering, including `snv` including indel
- one base filter, one numeric threshold, one exact coordinate lookup
- one base `column_filters` predicate
- computed `internal_af` and `max_internal_af`
- one FTS `search_query`
- filter options and column metadata only if included in implementation

Every implementation branch should run mocked unit tests and `make typecheck`. Docker E2E is required locally when Docker is available. If Docker is unavailable, the implementer must report that explicitly.

## Parallel Work Lanes

After read task contracts land, Phase 7 can split into safe lanes:

| Lane | Ownership | Write set | Output |
|---|---|---|---|
| A | PostgreSQL schema and seed | `scripts/postgres/init-db/`, Docker E2E fixture expectations | variant tables, indexes, FTS columns, seeded rows |
| B | Storage contracts and SQLite compatibility | `src/main/storage/read-executor.ts`, `src/main/storage/sqlite/SqliteReadExecutor.ts`, contract tests | same variant read tasks work on SQLite |
| C | PostgreSQL small reads | `PostgresVariantReadRepository`, `PostgresReadExecutor`, repository tests | `typeCounts`, `typesPresent`, `geneSymbols` |
| D | PostgreSQL FTS and query | query helper/repository files and tests | initial `variants:query` with explicit unsupported-filter handling |
| E | IPC routing | `variants-logic.ts`, `variants.ts`, handler tests | included `variants:*` channels use active storage session |
| F | Basic metadata | repository metadata helpers, metadata tests | `filterOptions`/`columnMeta` if small enough |
| G | Docker validation | `tests/e2e/postgres-variants-schema-dev-mode.e2e.ts`, `tests/e2e/postgres-variants-read-dev-mode.e2e.ts` | running Docker and Electron prove PostgreSQL schema and read path end-to-end |

Lanes A, B, and C can start in parallel after a baseline branch is created. Lane D should wait for schema decisions from Lane A. Lane E should wait for the read task contract from Lane B. Lane F should wait until C and D are green. Lane G should wait for A, C, D, and E.

## Commit Points

Recommended commit points:

1. `test(storage): add variant read executor contracts`
2. `feat(storage): add postgres variant schema and seed`
3. `refactor(storage): route sqlite variant reads through executor`
4. `feat(storage): add postgres variant small reads`
5. `feat(storage): add postgres variant query read path`
6. `refactor(ipc): route variant reads through storage sessions`
7. `feat(storage): add postgres variant filter metadata`
8. `test(e2e): cover postgres variant reads`

Each commit should be independently testable with focused Vitest commands. Docker validation can be run after commit 4 or 5 once the E2E lane has enough runtime behavior to exercise.

## TDD Requirements

Every implementation task must start with failing tests:

- Contract tests before adding `StorageReadTask` variants.
- SQLite executor dispatch tests before changing `SqliteReadExecutor`.
- PostgreSQL repository tests with mocked `pg.Pool` before writing SQL.
- Docker schema smoke tests before adding PostgreSQL variant DDL.
- Unsupported-filter tests before implementing `variants:query`.
- Handler routing tests before changing `variants-logic.ts` or `variants.ts`.
- Docker E2E before finalizing seed expectations.

Do not lower coverage, lint, or typecheck thresholds. Do not change renderer behavior to hide backend gaps.

## Acceptance Criteria

Phase 7 is complete when:

- PostgreSQL Docker schema includes variant base/extension/frequency tables and FTS-ready indexes.
- PostgreSQL seed data validates SNV, indel, SV, CNV, STR, and FTS reads.
- `variants:typeCounts` works through the active PostgreSQL storage session.
- `variants:typesPresent` works through the active PostgreSQL storage session.
- `variants:geneSymbols` works through the active PostgreSQL storage session.
- Initial `variants:query` works through the active PostgreSQL storage session for the supported filters listed in this spec.
- Unsupported variant filters fail clearly instead of being silently ignored.
- SQLite behavior and worker-pool dispatch remain unchanged.
- Docker-backed E2E validates the Phase 7 PostgreSQL slice.
- `make typecheck` and focused Vitest tests pass.
- `make ci` passes before claiming implementation complete.

## Blockers and Scope Risks

- Import is not PostgreSQL-backed, so all PostgreSQL variant validation depends on deterministic seed SQL until a later import phase.
- Full panel support depends on panel/gene reference reads that are still SQLite-service-backed.
- Tags, comments, ACMG filters, and annotation scope depend on annotation/tag PostgreSQL parity; implementing them here would expand Phase 7 too far.
- Inheritance-mode filters depend on analysis-group PostgreSQL parity and cross-case query semantics; defer them.
- Boolean FTS parity may be larger than expected. If it cannot be done with a small PostgreSQL emitter, keep simple token FTS and document boolean search as a later blocker.
- Filter metadata can grow into a broad abstraction. If it exceeds a small repository helper, defer it rather than expanding Phase 7.
