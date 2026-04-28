# VarLens PostgreSQL Roadmap Code Review

**Date:** 2026-04-28  
**Branch:** `main`  
**Head:** `67fda0f` (`chore(release): bump version to 0.57.0`)  
**Scope:** Current repository status after PR #180 / Phase 16, with emphasis on making VarLens a unified variant analysis client for both local encrypted SQLite databases and hosted/cloud PostgreSQL.

## Executive Summary

VarLens has crossed an important line: PostgreSQL is no longer only a read-parity experiment. The current `main` has PostgreSQL VCF import through `COPY FROM STDIN`, JSON import, case/variant reads, case metadata writes, Docker-gated E2Es, WGS import benchmarks, and a real storage-session boundary.

The project is not yet a unified SQLite/PostgreSQL product. It is a strong local-first desktop app with a credible PostgreSQL backend path still behind `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`. The next work should stop chasing only import speed and instead productize PostgreSQL as a hosted workspace target: migrations, connection lifecycle, security/isolation, full storage-domain parity, and WGS-scale read/query performance.

**Updated rating:** 8.6 / 10 overall.  
**PostgreSQL hosted-backend readiness:** 6.3 / 10.

The Phase 16 outcome is good but different from the original plan:

- Original target: PostgreSQL WGS import strictly faster than SQLite.
- Shipped state: PostgreSQL WGS import is much faster than pre-Phase-16 and under the Phase 9 escalation gate, but still slower than SQLite.
- Latest recorded numbers in `AGENTS.md`: **PG 97.28s vs SQLite 52.65s, ratio 1.85x** on GIAB HG002 v4.2.1.
- The residual gap is now plausibly COPY protocol/client overhead plus ID reservation/frequency rebuild work, not the old `jsonb_to_recordset` bottleneck.

## Method

Reviewed:

- Recent Git history from `184f361` through `67fda0f`.
- Phase 16 plan: `.planning/plans/2026-04-26-postgresql-parity-phase-16-copy-from-stdin.md`.
- Prior code review: `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md`.
- Current PostgreSQL import implementation:
  - `src/main/storage/postgres/PostgresVcfImportRepository.ts`
  - `src/main/storage/postgres/postgres-bulk-write.ts`
  - `src/main/storage/postgres/copy-text-encoder.ts`
  - `src/main/workers/postgres-import-worker.ts`
  - `scripts/postgres/init-db/16-phase16-search-document-fns.sql`
  - `docker-compose.postgres.yml`
- Current storage-session boundary and IPC routing.
- Current PostgreSQL tests and WGS perf harness.
- Current PostgreSQL 18 / Node stream / hosted PostgreSQL best-practice docs listed at the end.

## Current Strengths

### 1. Phase 16 materially improved PostgreSQL import

`PostgresVcfImportRepository` now pre-reserves variant IDs, writes variants and extension tables through `runBulkCopy`, and preserves extension-table foreign-key alignment by ordinal (`src/main/storage/postgres/PostgresVcfImportRepository.ts:202`, `:216`, `:241`, `:268`, `:299`). This is the right shape for high-volume VCF ingest.

`postgres-bulk-write.ts` uses `pg-copy-streams` with `node:stream/promises.pipeline`, so backpressure is handled by the stream pipeline rather than by buffering all COPY text in memory.

The encoder is isolated and heavily tested. `vitest.config.ts:208` adds a per-file coverage gate for `src/main/storage/postgres/copy-text-encoder.ts`, which is appropriate because COPY text encoding failures are data-corruption risks.

### 2. The trigger-defer design was correctly replaced

The original Phase 16 design disabled FTS triggers and ran per-batch `search_document` updates. The shipped code replaced that with STORED generated `tsvector` columns (`scripts/postgres/init-db/16-phase16-search-document-fns.sql:95`, `:100`, `:107`, `:112`). That aligns with PostgreSQL full-text-search guidance: stored `tsvector` columns with GIN indexes avoid recomputing vectors at query time and keep indexes usable.

The profile result was decisive: the per-batch bulk UPDATE path was 38.9% slower than the trigger path. Removing it was the right call.

### 3. Worker transaction shape remains WGS-aware

The PostgreSQL import worker keeps per-batch `COMMIT; BEGIN` with `SET LOCAL synchronous_commit = OFF` inside each transaction (`src/main/workers/postgres-import-worker.ts:384`, `:385`, `:386`, `:389`). The final bookkeeping transaction forces `synchronous_commit = ON` before reporting success (`:439`, `:856`). This is a pragmatic durability/performance balance for a client-side bulk import.

`relaxImportSessionLimits` also correctly lifts statement and idle-in-transaction limits for the short-lived import connection (`src/main/workers/postgres-import-worker.ts:213`, `:259`), because WGS post-import frequency rebuilds can exceed the UI/default read-path timeouts.

### 4. Storage-session boundary is now useful, not theoretical

`PostgresStorageSession` wires read, write, and import executors behind the same `StorageSession` interface (`src/main/storage/postgres/PostgresStorageSession.ts:62`, `:65`, `:71`, `:72`). The renderer and IPC call paths increasingly route through storage executors, so backend parity is now an execution problem rather than a redesign problem.

### 5. PostgreSQL test coverage has real depth

There are PostgreSQL unit, integration, E2E, and opt-in WGS perf tests:

- `tests/main/storage/postgres-vcf-import-repository.copy.test.ts`
- `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts`
- `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts`
- `tests/perf/postgres-vcf-wgs-import.perf.test.ts`
- `tests/perf/sqlite-vcf-wgs-import.perf.test.ts`

That is the right pattern: fast static guards always run, Docker-gated integration tests validate real PostgreSQL behavior, and WGS perf remains opt-in.

## Findings

### High: PostgreSQL is not product-ready for hosted/cloud use because there is no real migration lifecycle

Current PostgreSQL schema setup is dev-container initialization under `scripts/postgres/init-db/`. That is fine for `make pg-reset`, but not for hosted/cloud databases with existing data. The Phase 16.1 migration is explicitly destructive: it drops `search_document` columns and recreates them as generated columns (`scripts/postgres/init-db/16-phase16-search-document-fns.sql:18`, `:23`, `:95`).

This is acceptable for a resettable dev database. It is not acceptable for a hosted VarLens workspace. A hosted target needs versioned, idempotent, forward-only migrations with a `schema_migrations` table, transactional migration execution where PostgreSQL allows it, and documented handling for destructive transforms.

**Impact:** Cloud PostgreSQL cannot be safely adopted by real users until schema upgrades are first-class.

### High: PostgreSQL domain parity is still incomplete at the product level

The read executor exposes `variants:filterOptions` and `variants:columnMeta`, but the PostgreSQL repository still throws for both (`src/main/storage/postgres/PostgresVariantReadRepository.ts:315`, `:319`). Some filters are rejected as unsupported (`:340`, `:355`). Legacy `variants:search` also throws for PostgreSQL in `src/main/ipc/handlers/variants-logic.ts:207`, even though `queryVariants` has `search_query` support through generated `search_document`.

Other important domains remain SQLite-backed or compatibility-routed: deletes, exports, database overview, tags, comments, metrics, audit, filter presets, panels, gene lists, region files, analysis groups, annotations, transcripts, and lifecycle UX. Until these are either implemented or deliberately hidden by backend capability, PostgreSQL cannot be the same product surface as SQLite.

**Impact:** Users can import and read subsets of PostgreSQL data, but common clinical workflows will fail or be inconsistent.

### High: Hosted PostgreSQL security and tenancy model is not specified

The current model accepts a connection URL and schema. It is enough for local Docker and developer testing, but not enough for hosted/cloud operation. VarLens needs a documented security model for:

- one database per user/workspace vs one schema per workspace vs shared tables with tenant IDs;
- PostgreSQL roles and privileges;
- schema ownership and `search_path` hardening;
- SSL/TLS modes and certificate verification UX;
- credential storage and rotation;
- row-level security if shared tables are ever used.

PostgreSQL's own docs warn that schemas in `search_path` effectively trust users with `CREATE` privilege on those schemas. Current code usually qualifies identifiers with `quoteIdentifier(schema)`, which is good, but the generated-column functions in `16-phase16-search-document-fns.sql` are created unqualified in the current schema and should be part of a hardening review before hosted use.

**Impact:** The current backend is a trusted-connection feature, not a cloud-hosted product boundary.

### Medium: Local Docker tuning is useful but not portable to managed PostgreSQL

`docker-compose.postgres.yml` sets `max_wal_size=8GB`, `shared_buffers=2GB`, `wal_level=minimal`, `max_wal_senders=0`, and other import-friendly settings. These match PostgreSQL bulk-load guidance for a local single-user database, but managed services often restrict or discourage some of these knobs, especially `wal_level=minimal` when backups/replication/HA are enabled.

**Impact:** Current WGS numbers are a local tuned-container result. A hosted/cloud PostgreSQL target needs a separate benchmark profile on default managed settings and at least one realistic cloud instance class.

### Medium: Import benchmarking is strong; WGS query benchmarking is underdeveloped

The current WGS perf harness measures import wall time. For a hosted variant analysis system, query latency matters more after ingest:

- first page load for a 5M-variant case;
- filtered page latency by gene, consequence, AF, CADD, ClinVar, region, variant type;
- count latency with and without `skipCount`;
- full-text search latency through `search_document`;
- cohort/multi-case query latency;
- filter metadata generation latency.

PostgreSQL can be slower than SQLite on local import and still win on concurrent hosted reads, cohort analysis, or very large multi-case workloads. That claim needs measurement.

### Medium: Remaining import-speed work should be measured, not assumed

Likely next levers:

- binary COPY;
- eliminating or changing per-batch ID reservation;
- staging tables plus server-side `INSERT ... RETURNING` or a temp ordinal map;
- partitioning by case/workspace;
- deferring some secondary indexes during initial load;
- optimizing `rebuildVariantFrequencyForCase`.

Each has tradeoffs. PostgreSQL's own COPY docs state binary format is faster but less portable and more type-specific. That makes it a good experiment, not an automatic production choice.

### Medium: The generated `search_document` migration needs a production version

The current generated-column approach is likely correct for dev reset, but production needs:

- schema-qualified function creation;
- explicit extension/function ownership;
- a no-data-loss migration path for existing rows;
- tests against non-`public` schemas;
- a rollback/repair strategy if generated expression changes;
- a comment cleanup pass in tests and docs.

There is already stale wording in `tests/main/storage/postgres-vcf-import-repository.copy.test.ts:53`, which says `search_document` is "deferred to bulk UPDATE" even though Phase 16.1 removed that. Low risk, but it signals documentation drift.

### Low: `supportsFullTextSearch` is false while query-level FTS exists

`PostgresStorageSession` sets `supportsFullTextSearch: false` (`src/main/storage/postgres/PostgresStorageSession.ts:41`), but `PostgresVariantReadRepository.queryVariants` supports `filter.search_query` through `search_document`. This may be intentional because legacy `variants:search` is still deferred, but the capability name is now too coarse.

**Recommendation:** split capability into `supportsVariantSearchQuery` and `supportsLegacyVariantSearch` or remove the stale flag if unused.

### Low: COPY array encoding is not production-safe if used later

`encodeArray` exists in `copy-text-encoder.ts:127`, but it does not fully quote PostgreSQL text array elements containing commas, braces, quotes, or backslashes. It appears unused by current COPY column lists, so this is not a current defect. Add a guard comment or make it correct before any future array column uses it.

## Updated Plan

### Phase 17: PostgreSQL Productization Baseline

**Goal:** Make PostgreSQL a safe workspace target, not only a dev-container backend.

1. Add a PostgreSQL migration runner.
   - Create `schema_migrations`.
   - Move `init-db` SQL into versioned migration files or generate init SQL from migrations.
   - Keep `make pg-reset` fast, but make runtime startup able to verify and migrate an existing hosted schema.
   - Add tests for clean install, already-current schema, failed migration rollback, and non-`public` schema.

2. Define hosted workspace configuration.
   - Add typed config for URL, schema, SSL mode, CA certificate path/text, connection timeout, pool size, and read-only health checks.
   - Replace `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres` as the only path with a UI-backed connection profile model.
   - Store credentials using the existing desktop-safe credential strategy, not plain settings JSON.

3. Harden schema/security.
   - Schema-qualify functions and extension references.
   - Remove reliance on ambient `search_path`.
   - Document minimum required privileges for app role vs migration/admin role.
   - Decide the tenancy model: recommended near-term is one schema per workspace/database owner for hosted single-tenant deployments; shared-table RLS can be a later SaaS-specific design.

4. Add capability-aware UI gates.
   - If PostgreSQL lacks a feature, hide or disable the workflow explicitly instead of letting users hit backend exceptions.
   - Add E2E coverage for the PostgreSQL workspace connection and unsupported-feature messaging.

**Acceptance:** A user can connect to an existing PostgreSQL database, VarLens verifies schema version, runs safe migrations, reports health, and clearly gates unsupported features.

### Phase 18: PostgreSQL Storage-Domain Parity

**Goal:** Make the PostgreSQL backend cover the core clinical workflow surface.

1. Implement `variants:filterOptions` and `variants:columnMeta` in `PostgresVariantReadRepository`.
   - Port SQLite base and extension-column metadata semantics.
   - Add WGS-scale timing budgets for expensive metadata queries.

2. Implement delete/export/database-overview on the storage-session boundary.
   - PostgreSQL case delete should update or rebuild frequency/cohort summaries consistently.
   - Export should stream from PostgreSQL without loading WGS result sets into memory.
   - Database overview should report backend-appropriate size/count metadata.

3. Migrate high-use write domains.
   - Tags, comments, annotations, filter presets, panels/gene lists, region files, analysis groups.
   - Keep shared contracts; add PostgreSQL repositories behind executors.

4. Close legacy `DatabaseService` compatibility paths.
   - Keep compatibility escapes only where consciously deferred.
   - Add tests that PostgreSQL sessions do not call SQLite-only getters for migrated domains.

**Acceptance:** A PostgreSQL workspace supports import, browse, filter, annotate/tag/comment, manage panels/presets, export, and delete with behavior matching SQLite unless explicitly documented otherwise.

### Phase 19: WGS Read/Query Performance Program

**Goal:** Prove PostgreSQL is not only correct at WGS scale, but interactive.

1. Add WGS query benchmarks.
   - First-page query.
   - Gene/consequence/AF/CADD/ClinVar filters.
   - SV/CNV/STR extension filters.
   - Search query.
   - Count vs `skipCount`.
   - Column metadata generation.
   - Cohort/multi-case query.

2. Capture `EXPLAIN (ANALYZE, BUFFERS)` artifacts for slow queries.
   - Store generated artifacts under `.planning/artifacts/perf/postgres-query/`.
   - Add regression budgets only after two stable baselines.

3. Tune indexes from evidence.
   - Avoid speculative indexes.
   - Candidate areas: `(case_id, variant_type, pos)`, gene prefix search, common filter combinations, extension-table FK/filter columns, and FTS query shape.

4. Revisit partitioning only after query evidence.
   - Partition by workspace/case can improve lifecycle operations and index locality, but it complicates migrations, global frequency tables, and hosted operations.

**Acceptance:** Current WGS query workflows have documented p50/p95 local and hosted timings, with clear budgets and query plans.

### Phase 20: Import-Speed Follow-Up

**Goal:** Decide whether PostgreSQL should chase SQLite import speed or accept a slower import in exchange for hosted scale.

1. Profile current WGS import with `VARLENS_PG_IMPORT_PROFILE=1`.
   - Separate COPY variants, COPY extension tables, ID reservation, final case update, and frequency rebuild.

2. Run three isolated experiments.
   - Binary COPY for variants only.
   - Alternative ID strategy that avoids pre-reserving every ID through `nextval`.
   - Staging-table load plus set-based merge.

3. Test on both local tuned Docker and a managed/cloud-like profile.
   - Keep `docker-compose.postgres.yml` as the aggressive local profile.
   - Add a second "portable defaults" profile without `wal_level=minimal` and large memory assumptions.

4. Pick the lever only if it improves wall time without increasing memory or making hosted deployments brittle.

**Acceptance:** A short design note decides whether to ship an import-speed change, defer it, or accept PG slower-than-SQLite import as a product tradeoff.

### Phase 21: Hosted Operations

**Goal:** Make hosted PostgreSQL supportable.

1. Add backup/restore guidance.
2. Add connection-pool sizing and timeout guidance.
3. Add health diagnostics visible in the UI.
4. Add cloud-provider smoke tests where feasible.
5. Add a redacted diagnostic bundle for PostgreSQL workspace issues.

**Acceptance:** A clinical/research group can operate a hosted VarLens PostgreSQL database with documented backup, migration, security, and performance expectations.

## Recommended Immediate Next PRs

1. **Docs/cleanup PR:** Fix Phase 16.1 stale comments in tests and docs; clarify that `search_document` is generated, not bulk-updated.
2. **Migration design spec:** Write `.planning/specs/2026-04-28-postgresql-migration-lifecycle.md`.
3. **Migration runner implementation:** Add the runner and convert current init SQL into versioned migrations.
4. **Filter metadata parity:** Implement PostgreSQL `variants:filterOptions` and `variants:columnMeta`.
5. **WGS query benchmark harness:** Add query benchmarks before adding more indexes.

## Best-Practice References

- PostgreSQL 18 generated columns: https://www.postgresql.org/docs/current/ddl-generated-columns.html
- PostgreSQL 18 populating a database / bulk load: https://www.postgresql.org/docs/18/populate.html
- PostgreSQL 18 COPY command, including binary format tradeoffs: https://www.postgresql.org/docs/18/sql-copy.html
- PostgreSQL full-text-search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
- PostgreSQL row security policies: https://www.postgresql.org/docs/18/ddl-rowsecurity.html
- PostgreSQL schemas and `search_path` security: https://www.postgresql.org/docs/18/ddl-schemas.html
- `pg-copy-streams` documentation: https://github.com/brianc/node-pg-copy-streams
- Node.js stream backpressure: https://nodejs.org/ro/learn/modules/backpressuring-in-streams
- Google Cloud SQL PostgreSQL best practices / connection pooling: https://cloud.google.com/sql/docs/postgres/best-practices and https://cloud.google.com/sql/docs/postgres/managed-connection-pooling
