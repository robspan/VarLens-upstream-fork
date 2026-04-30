# VarLens PostgreSQL Roadmap Code Review

**Date:** 2026-04-28  
**Updated:** 2026-04-30
**Branch:** `feat/postgres-final-parity`
**Head at original review:** `67fda0f` (`chore(release): bump version to 0.57.0`)
**Current release candidate head:** `411330c1` (`docs(planning): refresh postgres roadmap release status`)
**Scope:** Current repository status after PR #180 / Phase 16, with emphasis on making VarLens a unified variant analysis client for both local encrypted SQLite databases and hosted/cloud PostgreSQL.

## 2026-04-30 Status Update

The final PostgreSQL parity branch has now closed the user-facing parity gaps that were selected for the 0.58.3 APR/release candidate. The roadmap below should be read as historical context plus remaining productization work, not as the current code state.

Completed in `feat/postgres-final-parity`:

- Clinical variant filter parity for PostgreSQL:
  - tags;
  - per-case/global comments;
  - ACMG classifications;
  - annotation scope;
  - panels;
  - inheritance/analysis-group/phasing filters.
- Cohort and export parity:
  - PostgreSQL cohort query, summary, carriers, gene burden, and column metadata;
  - PostgreSQL variant and cohort streaming export;
  - export IPC routing through storage executors.
- Audit/capability closure:
  - PostgreSQL audit log repository and read/write routing;
  - storage capability matrix now represents the implemented PostgreSQL feature surface more accurately;
  - active PostgreSQL workspace is visible in the database picker instead of showing no database.
- Shortlist parity:
  - `variants:shortlist` now routes PostgreSQL sessions through the storage read executor;
  - `PostgresShortlistService` supports built-in/ad-hoc shortlist configs, Stage-1 candidate generation, scoring/ranking, starred hydration, and preset validation;
  - the Shortlist tab remains visible in PostgreSQL mode and no longer calls the SQLite-only `DatabaseService`.
- Planning/spec housekeeping:
  - final parity spec and execution plans archived under `.planning/archive/completed-*`.

Verification completed on this branch:

- `make ci` passed after the PostgreSQL Shortlist parity fix:
  - 315 test files passed, 4 skipped;
  - 3468 tests passed, 29 skipped.
- After the SQLite read-executor exhaustiveness fix at `4558878a`, focused release-candidate verification passed:
  - `npx tsc --noEmit -p tsconfig.node.json --incremental false`;
  - `make typecheck`;
  - `npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/ipc/handlers/shortlist.test.ts tests/main/storage/postgres-shortlist-service.test.ts tests/main/storage/postgres-read-executor.test.ts`;
  - `npx prettier --check src/main/storage/sqlite/SqliteReadExecutor.ts`;
  - `npx eslint src/main/storage/sqlite/SqliteReadExecutor.ts`.
- Dockerized PostgreSQL 18 verification:
  - `.env.postgres.local` uses local port `55433` because `55432` was already occupied;
  - `make pg-reset`;
  - `make pg-up`;
  - `make rebuild-node`;
  - `VARLENS_RUN_POSTGRES_E2E=1 npx vitest run --project main tests/main/storage/postgres-vcf-import-repository.copy.test.ts`;
  - `make build`;
  - PostgreSQL E2Es were run in a state-safe order:
    - `tests/e2e/postgres-variants-read-dev-mode.e2e.ts` passed on a reset seed database;
    - remaining `tests/e2e/postgres-*.e2e.ts` passed separately.
- PostgreSQL Shortlist-specific verification:
  - focused Vitest suites passed:
    - `tests/main/ipc/handlers/shortlist.test.ts`;
    - `tests/main/storage/postgres-shortlist-service.test.ts`;
    - `tests/main/storage/postgres-read-executor.test.ts`;
    - `tests/main/storage/postgres-variant-read-repository.test.ts`;
    - `tests/renderer/views/CaseView.test.ts`;
    - `tests/renderer/composables/useShortlistQuery.test.ts`;
  - built Electron app E2E `tests/e2e/postgres-variants-read-dev-mode.e2e.ts` now includes a real `window.api.variants.shortlist(...)` assertion against Dockerized PostgreSQL and passed.
- PostgreSQL query performance smoke:
  - `make pg-query-perf` passed on the populated E2E database and wrote the gitignored artifact under `.planning/artifacts/perf/postgres-query/`.

Current manual dev state:

- Docker container: `varlens-postgres-dev` using PostgreSQL 18.
- Connection: `.env.postgres.local`, `127.0.0.1:55433`.
- Dev app command:
  - `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres make dev`
- After the final reset used for the Shortlist E2E, the seed database contains:
  - 3 cases;
  - 6 variants;
  - 3 built-in shortlist presets.

## What Remains Before Claiming Full PostgreSQL Product Parity

The branch is a strong APR/release candidate for the final parity work that was planned, but "full PostgreSQL product parity" still has productization gaps that should not be hidden in the PR/release description.

### Required before a broad public PostgreSQL claim

1. Add a first-class PostgreSQL connection UX.
   - Current PostgreSQL mode is environment-backed (`VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`, `VARLENS_PG_URL`, `VARLENS_PG_SCHEMA`).
   - Users still cannot enter/select a PostgreSQL URL from the normal database picker.
   - Needed UI:
     - connect to PostgreSQL URL;
     - schema field;
     - SSL mode/certificate handling;
     - test connection;
     - save recent PostgreSQL workspaces;
     - clear redacted display name in the database picker.

2. Add a production PostgreSQL migration lifecycle.
   - Docker init scripts are not enough for hosted or existing databases.
   - Needed:
     - schema version table;
     - forward-only migration runner;
     - startup verification/migration;
     - clean-install and upgrade tests;
     - destructive migration policy;
     - non-`public` schema tests.

3. Harden hosted-schema security.
   - Schema-qualify migration objects.
   - Avoid ambient `search_path` assumptions.
   - Define app role versus migration/admin role.
   - Define SSL/credential storage and rotation.
   - Document tenant/workspace model.

4. Run a final PostgreSQL E2E pass on the release candidate SHA.
   - Reset PostgreSQL.
   - Run the state-sensitive seed test first.
   - Run the remaining PostgreSQL E2Es second.
   - Then run `make ci`.
   - This was done before the roadmap update; repeat after any further code or release metadata changes if the release tag moves.

5. Do not claim WGS query readiness until the WGS query harness is rerun and reviewed.
   - `scripts/postgres/download-wgs-fixture.sh`;
   - `make pg-reset`;
   - `make pg-query-perf`.
   - This should be evidence for performance claims, not a hard release gate unless the PR/release text claims WGS query readiness.

### Recommended next implementation PRs

Current execution documents:

- Spec: `.planning/specs/2026-04-30-postgresql-product-parity-spec.md`
- Plan 1: `.planning/plans/2026-04-30-postgresql-connection-manager-ui.md`
- Plan 2: `.planning/plans/2026-04-30-postgresql-migration-lifecycle-hardening.md`
- Plan 3: `.planning/plans/2026-04-30-postgresql-hosted-verification-dev-tooling.md`
- Plan 4: `.planning/plans/2026-04-30-postgresql-wgs-query-readiness.md`

1. PostgreSQL connection manager UI and persisted workspace selection.
2. PostgreSQL migration runner and hosted schema hardening.
3. Non-`public` schema verification with quoted schema names.
4. WGS query benchmark expansion and documented p50/p95 budgets.
5. Managed/cloud PostgreSQL smoke profile distinct from the tuned local Docker profile.
6. Release workflow/CI polish:
   - ensure the exact tagged SHA has a successful GitHub `Build` workflow run before pushing the release tag;
   - keep the tag on the final release commit only.

## Executive Summary

VarLens has crossed an important line: PostgreSQL is no longer only a read-parity experiment. The current codebase has PostgreSQL VCF import through `COPY FROM STDIN`, JSON import, case/variant reads, case metadata writes, Docker-gated E2Es, WGS import benchmarks, and a real storage-session boundary.

The project is not yet a unified SQLite/PostgreSQL product. It is a strong local-first desktop app with a credible PostgreSQL backend path still gated through `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`. PostgreSQL productization should now stop optimizing primarily for import speed and instead close the blockers that prevent a hosted workspace from behaving like the SQLite app: migrations, capability-aware UX, security/isolation, full storage-domain parity, export/delete lifecycle, and WGS-scale read/query performance.

**Overall codebase rating:** 8.5 / 10.  
**PostgreSQL hosted-backend readiness:** 5.5-6.0 / 10.

The readiness rating is intentionally stricter than the original 6.3 / 10. Import and basic read foundations are good, but users still hit explicit PostgreSQL deferrals or SQLite-only handlers across important clinical workflows.

The Phase 16 outcome is good but different from the original plan:

- Original target: PostgreSQL WGS import strictly faster than SQLite.
- Shipped state: PostgreSQL WGS import is much faster than pre-Phase-16 and under the Phase 9 escalation gate, but still slower than SQLite.
- Latest recorded numbers in `AGENTS.md`: **PG 97.28s vs SQLite 52.65s, ratio 1.85x** on GIAB HG002 v4.2.1.
- The residual gap is plausibly COPY protocol/client overhead plus ID reservation/frequency rebuild work, not the old `jsonb_to_recordset` bottleneck.
- This is acceptable for now. The higher-gain work is product parity and hosted-read performance, not another speculative import-speed pass.

## Method

Reviewed:

- Existing roadmap review: `.planning/code-review/CODEBASE-REVIEW-2026-04-28-POSTGRESQL-ROADMAP.md`.
- Current PostgreSQL storage/session boundary:
  - `src/main/storage/session.ts`
  - `src/main/storage/types.ts`
  - `src/main/storage/read-executor.ts`
  - `src/main/storage/write-executor.ts`
  - `src/main/storage/postgres/PostgresStorageSession.ts`
  - `src/main/storage/postgres/PostgresReadExecutor.ts`
  - `src/main/storage/postgres/PostgresWriteExecutor.ts`
- Current PostgreSQL import implementation:
  - `src/main/storage/postgres/PostgresVcfImportRepository.ts`
  - `src/main/storage/postgres/PostgresJsonImportRepository.ts`
  - `src/main/storage/postgres/postgres-bulk-write.ts`
  - `src/main/storage/postgres/copy-text-encoder.ts`
  - `src/main/workers/postgres-import-worker.ts`
  - `scripts/postgres/init-db/16-phase16-search-document-fns.sql`
  - `docker-compose.postgres.yml`
- Current IPC routing and SQLite-only compatibility paths:
  - `src/main/ipc/handlers/variants-logic.ts`
  - `src/main/ipc/handlers/cases.ts`
  - `src/main/ipc/handlers/database.ts`
  - `src/main/ipc/handlers/export.ts`
  - `src/main/ipc/handlers/import-logic.ts`
  - representative annotation/tag/panel/cohort/filter-preset handlers.
- Current PostgreSQL configuration and startup:
  - `src/main/database/startup.ts`
  - `src/main/storage/config.ts`
  - `src/shared/types/postgres-import-worker.ts`
- Current PostgreSQL tests and WGS perf harness.
- Current PostgreSQL 18 / hosted PostgreSQL documentation listed at the end.

## Current Strengths

### 1. Phase 16 materially improved PostgreSQL import

`PostgresVcfImportRepository` now pre-reserves variant IDs, writes base variants and extension tables through `runBulkCopy`, and preserves extension-table foreign-key alignment by ordinal. This is the right shape for high-volume VCF ingest.

`postgres-bulk-write.ts` uses `pg-copy-streams` with `node:stream/promises.pipeline`, so backpressure is handled by the stream pipeline rather than by buffering all COPY text in memory.

The COPY encoder is isolated and heavily tested. This is appropriate because COPY text encoding failures are data-corruption risks.

### 2. The trigger-defer design was correctly replaced

The original Phase 16 design disabled FTS triggers and ran per-batch `search_document` updates. The shipped code replaced that with STORED generated `tsvector` columns in `scripts/postgres/init-db/16-phase16-search-document-fns.sql`.

That aligns with PostgreSQL full-text-search guidance: practical text search usually needs an index, and PostgreSQL documents stored generated `tsvector` columns with GIN indexes as a way to keep search vectors automatically up to date and avoid recomputing vectors during indexed search.

### 3. Worker transaction shape remains WGS-aware

The PostgreSQL import worker keeps per-batch `COMMIT; BEGIN` with `SET LOCAL synchronous_commit = OFF` inside each transaction. The final bookkeeping transaction forces `synchronous_commit = ON` before reporting success. This is a pragmatic durability/performance balance for a client-side bulk import.

`relaxImportSessionLimits` lifts statement, lock, and idle-in-transaction limits for the short-lived import connection. That is appropriate because WGS post-import frequency rebuilds can exceed renderer/default read-path timeouts.

### 4. Storage-session boundary is now useful, not theoretical

`PostgresStorageSession` wires read, write, and import executors behind the same `StorageSession` interface. The renderer and IPC call paths increasingly route through storage executors, so backend parity is now an execution and prioritization problem rather than a redesign problem.

### 5. PostgreSQL test coverage has real depth

There are PostgreSQL unit, integration, E2E, cancellation, large-allele, extension-table, and opt-in WGS perf tests. This is the right shape: fast static guards always run, Docker-gated integration tests validate real PostgreSQL behavior, and WGS perf remains opt-in.

## Findings

### High: PostgreSQL is not product-ready for hosted/cloud use because there is no runtime migration lifecycle

Current PostgreSQL schema setup is dev-container initialization under `scripts/postgres/init-db/`. Those scripts run only when Docker initializes a fresh volume. They are not a production migration system.

The Phase 16.1 migration is explicitly destructive: it drops `search_document` columns and recreates them as generated columns. This is acceptable for a resettable dev database. It is not acceptable for a hosted VarLens workspace with existing clinical/research data.

A hosted target needs:

- `schema_migrations` or equivalent version table;
- forward-only migration files;
- startup schema version verification;
- transactional migration execution where PostgreSQL allows it;
- explicit handling for destructive transforms;
- clean-install and upgrade tests;
- non-`public` schema tests.

**Impact:** Cloud PostgreSQL cannot be safely adopted by real users until schema upgrades are first-class.

### High: non-`public` schema support is incomplete and security-sensitive

Runtime repositories generally qualify identifiers with `quoteIdentifier(schema)`, which is good. But init SQL creates objects unqualified in the active schema. Phase 16 generated-column functions and indexes are also unqualified.

PostgreSQL's schema docs warn that unqualified names and `search_path` are security-sensitive: adding a schema to `search_path` effectively trusts users with `CREATE` privilege on that schema. A production VarLens PostgreSQL setup must not rely on ambient search path behavior.

Needed changes:

- schema-qualify all application tables, indexes, functions, and extension references in migrations;
- set or avoid `search_path` deliberately;
- test a schema name that requires quoting;
- define app-role versus migration-role privileges;
- decide who owns generated-column functions;
- document whether `public` should have `CREATE` revoked.

**Impact:** Current PostgreSQL is a trusted dev connection feature, not yet a hardened hosted workspace boundary.

### High: PostgreSQL domain parity is still incomplete at the product level

The read executor exposes `variants:filterOptions` and `variants:columnMeta`, but `PostgresVariantReadRepository` still throws for both. `variants:search` also throws for PostgreSQL in `variants-logic.ts`, even though `queryVariants` has `search_query` support through generated `search_document`.

More importantly, many app domains still call `getDb()` directly and therefore remain SQLite-oriented:

- annotations;
- tags;
- filter presets;
- panels and active panel state;
- gene lists and region files;
- analysis groups;
- case comments and metrics;
- cohort queries and summaries;
- export;
- database overview;
- audit log;
- external API caches such as gnomAD/HPO/MyVariant/SpliceAI/VEP/protein helpers;
- batch import duplicate checks.

Until these are implemented behind storage executors or deliberately hidden by backend capability, PostgreSQL cannot be the same product surface as SQLite.

**Impact:** Users can import and read subsets of PostgreSQL data, but common clinical workflows still fail or behave inconsistently.

### High: variant filtering rejects important clinical workflows

`PostgresVariantReadRepository.assertSupportedQueryFilter` rejects several filters that users will expect to work:

- `tag_ids`;
- `starred_only`;
- `has_comment`;
- `acmg_classifications`;
- `annotation_scope`;
- `active_panel_ids` and `panel_intervals`;
- `inheritance_modes`;
- `analysis_group_id`;
- `consider_phasing`.

This is a higher-gain gap than import speed. If a clinical geneticist cannot filter by panel, tags, comments, ACMG classification, inheritance, or analysis group, PostgreSQL is not a practical workspace backend.

**Impact:** PostgreSQL browse/query works for base filters but not for the richer workflows that make VarLens useful.

### High: hosted PostgreSQL security, SSL, credentials, and tenancy model are not specified

The current model accepts environment variables for URL, schema, SSL mode, timeouts, and pool size. This is enough for local Docker and developer testing, but not enough for product use.

Open issues:

- one database per user/workspace versus one schema per workspace versus shared tables with tenant IDs;
- PostgreSQL roles and privileges;
- migration/admin role versus app runtime role;
- schema ownership and `search_path` hardening;
- SSL/TLS mode UX and certificate verification;
- credential storage and rotation;
- row-level security if shared tables are ever used;
- connection-pool sizing and cloud pooler compatibility.

There is also a config inconsistency to resolve: `src/main/storage/config.ts` rejects SSL URL params like `sslrootcert`, while `src/shared/types/postgres-import-worker.ts` says SSL cert/key/CA material should be provided through the connection string or PG environment variables. Productized PostgreSQL needs one coherent credential/SSL profile model.

**Impact:** The current backend is a developer-controlled connection feature, not a cloud-hosted product boundary.

### Medium: local Docker tuning is useful but not portable to managed PostgreSQL

`docker-compose.postgres.yml` sets aggressive import-friendly flags including `max_wal_size=8GB`, `shared_buffers=2GB`, `wal_level=minimal`, and `max_wal_senders=0`. These match local bulk-load goals, but managed services often restrict or discourage some knobs, especially `wal_level=minimal` when backups, replication, or HA are enabled.

Cloud provider docs emphasize connection management, pooling, exponential backoff, operational windows, and provider-specific pooling limitations. Managed poolers can also restrict session features such as `SET`, prepared statements, temp tables, or session-level locks in transaction-pooling modes.

**Impact:** Current WGS numbers are a tuned local-container result. A hosted/cloud PostgreSQL target needs a separate portable-default benchmark profile and eventually a managed-instance benchmark.

### Medium: import benchmarking is strong; WGS query benchmarking is underdeveloped

The current WGS perf harness measures import wall time. For a hosted variant analysis system, query latency matters more after ingest:

- first page load for a 5M-variant case;
- filtered page latency by gene, consequence, AF, CADD, ClinVar, region, variant type;
- count latency with and without `skipCount`;
- full-text search latency through `search_document`;
- panel-filter latency;
- tag/comment/ACMG-filter latency once implemented;
- cohort/multi-case query latency;
- filter metadata generation latency;
- export streaming throughput.

PostgreSQL can be slower than SQLite on local import and still win on concurrent hosted reads, cohort analysis, or very large multi-case workloads. That claim needs measurement.

### Medium: remaining import-speed work should be measured, not assumed

Likely next levers:

- binary COPY;
- eliminating or changing per-batch ID reservation;
- staging tables plus server-side `INSERT ... RETURNING` or a temp ordinal map;
- partitioning by workspace/case;
- deferring secondary indexes during initial load;
- optimizing `rebuildVariantFrequencyForCase`.

PostgreSQL COPY docs confirm that `COPY FROM STDIN` sends data over the client connection. Older PostgreSQL docs and current ecosystem guidance describe binary format as faster but less portable and more type-specific. That makes binary COPY a good experiment, not an automatic production choice.

### Medium: generated `search_document` production migration needs a safer contract

The generated-column approach is likely correct for the dev schema and high-volume insert path, but production needs:

- schema-qualified function creation;
- explicit extension/function ownership;
- no-data-loss migration path for existing rows;
- tests against non-`public` schemas;
- repair strategy if generated expression changes;
- comments explaining why the wrapper functions are marked `IMMUTABLE`.

PostgreSQL generated columns can only use immutable functions. PostgreSQL volatility categories are a promise to the optimizer; labeling a function `IMMUTABLE` when it is not truly immutable can produce stale values under reused plans. The current wrapper around `concat_ws` may be defensible because the inputs are plain text columns and the expression is effectively deterministic, but production migrations should document that assumption explicitly.

### Medium: capabilities are too coarse for safe UI gating and agentic development

`StorageCapabilities` currently has broad flags such as `supportsFullTextSearch`, `supportsLocalFileLifecycle`, and `supportsHostedConnectionLifecycle`. PostgreSQL sets `supportsFullTextSearch: false`, while `queryVariants` supports `search_query` through generated `search_document` and legacy `variants:search` is what remains deferred.

This should become a granular, machine-readable parity/capability matrix. Suggested flags:

- `variants.query`;
- `variants.searchQuery`;
- `variants.legacySearch`;
- `variants.filterOptions`;
- `variants.columnMeta`;
- `variants.panelFilters`;
- `variants.tagFilters`;
- `variants.annotationFilters`;
- `cases.delete`;
- `exports.variants`;
- `exports.cohort`;
- `cohort.query`;
- `annotations.write`;
- `tags.write`;
- `panels.write`;
- `filterPresets.write`;
- `database.overview`;
- `workspace.migrations`.

**Impact:** Without a granular contract, agents and humans keep discovering parity gaps only after UI clicks or failed tests.

### Low: COPY array encoding is not production-safe if used later

`encodeArray` exists in `copy-text-encoder.ts`, but it does not fully quote PostgreSQL text array elements containing commas, braces, quotes, or backslashes. It appears unused by current COPY column lists, so this is not a current defect. Add a guard comment or make it correct before any future array column uses it.

## Updated Roadmap

### Phase 17: PostgreSQL Parity Matrix and Capability-Aware UX

**Goal:** Stop accidental PostgreSQL dead ends and create a reliable agentic development basis.

1. Create a machine-readable backend capability matrix.
   - Include SQLite and PostgreSQL capabilities by domain/action.
   - Keep it close to `StorageCapabilities` or replace `StorageCapabilities` with a nested capability object.
   - Add tests that known PostgreSQL deferrals are represented in capabilities.

2. Add capability-aware UI and IPC gates.
   - If PostgreSQL lacks a feature, hide or disable the workflow explicitly.
   - Convert raw backend exceptions into clear “not available for PostgreSQL yet” UX only where intentionally deferred.
   - Avoid masking accidental parity regressions.

3. Create a `.planning/` parity checklist.
   - One row per IPC domain/action.
   - Columns: SQLite implementation, PostgreSQL implementation, UI gate, tests, WGS/perf relevance, priority.

**Acceptance:** A PostgreSQL user can navigate the app without hitting unplanned SQLite-only exceptions, and future agents have a concrete parity checklist.

### Phase 18: PostgreSQL Migration Lifecycle and Hosted Schema Hardening

**Goal:** Make PostgreSQL safe for existing databases, not only resettable dev containers.

1. Add a PostgreSQL migration runner.
   - Create `schema_migrations`.
   - Convert current init SQL into ordered migrations or generate dev init SQL from migrations.
   - Keep `make pg-reset` fast.
   - Make runtime startup verify and migrate an existing schema.

2. Harden schema/security.
   - Schema-qualify all app objects.
   - Remove reliance on ambient `search_path`.
   - Document app role versus migration/admin role privileges.
   - Test non-`public` schemas and quoted schema names.

3. Define hosted workspace configuration.
   - URL, schema, SSL mode, CA material strategy, connection timeout, pool size, health check.
   - Resolve the current SSL URL-param versus worker-serialization inconsistency.
   - Store credentials using a desktop-safe credential strategy, not plain settings JSON.

**Acceptance:** A user can connect to an existing PostgreSQL database, VarLens verifies schema version, runs safe migrations, reports health, and does not rely on Docker init scripts.

### Phase 19: Variant Filter Metadata and High-Value Query Parity

**Goal:** Make PostgreSQL variant browsing clinically useful.

1. Implement `variants:filterOptions` and `variants:columnMeta` in `PostgresVariantReadRepository`.
2. Implement panel filter support.
3. Implement tag/comment/ACMG/annotation filter support.
4. Implement inheritance/analysis-group/phasing support or explicitly defer with capability gates.
5. Add WGS-scale timing budgets for metadata and common filters.

**Acceptance:** PostgreSQL supports the same high-use filtering surface as SQLite for single-case variant analysis unless a gap is explicitly documented and gated.

### Phase 20: Export, Delete, and Lifecycle Parity

**Goal:** Make PostgreSQL workspaces manageable, not only importable.

1. Implement case delete for PostgreSQL.
   - Delete variants and extension rows through FK cascades.
   - Rebuild/update frequency summaries consistently.
   - Emit expected UI events.

2. Implement database overview for PostgreSQL.
   - Counts, size estimates, cases, cohorts, tags, phenotypes.
   - Backend-appropriate size metadata.

3. Implement variant and cohort export from PostgreSQL.
   - Stream rows from PostgreSQL.
   - Do not load WGS result sets into memory.
   - Preserve Excel/CSV behavior expected by users.

4. Close obvious legacy `DatabaseService` compatibility paths.
   - Add tests that PostgreSQL sessions do not call SQLite-only getters for migrated domains.

**Acceptance:** A PostgreSQL workspace supports import, browse, filter, export, delete, and overview lifecycle operations.

### Phase 21: Annotation, Tags, Panels, Presets, Gene Lists, Region Files, and Analysis Groups

**Goal:** Move the app’s clinical workflow layer onto the storage-session boundary.

1. Add PostgreSQL repositories and storage tasks for tags.
2. Add PostgreSQL repositories and storage tasks for annotations and ACMG classifications.
3. Add PostgreSQL repositories and storage tasks for comments and metrics.
4. Add PostgreSQL repositories and storage tasks for panels, gene lists, and region files.
5. Add PostgreSQL repositories and storage tasks for filter presets and analysis groups.
6. Keep shared IPC contracts stable.

**Acceptance:** Users can annotate, tag, comment, use panels/presets/gene lists/region files, and organize analysis groups in PostgreSQL workspaces.

### Phase 22: WGS Read/Query Performance Program

**Goal:** Prove PostgreSQL is interactive at WGS scale.

1. Add WGS query benchmarks.
   - First-page query.
   - Gene/consequence/AF/CADD/ClinVar filters.
   - SV/CNV/STR extension filters.
   - Search query.
   - Count versus `skipCount`.
   - Column metadata generation.
   - Panel/tag/comment/ACMG filters after implementation.
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

### Phase 23: Import-Speed Follow-Up

**Goal:** Decide whether PostgreSQL should chase SQLite import speed or accept a slower import in exchange for hosted scale.

1. Profile current WGS import with `VARLENS_PG_IMPORT_PROFILE=1`.
2. Run isolated experiments.
   - Binary COPY for variants only.
   - Alternative ID strategy that avoids pre-reserving every ID through `nextval`.
   - Staging-table load plus set-based merge.
3. Test on both local tuned Docker and a managed/cloud-like profile.
4. Ship only if the change improves wall time without increasing memory risk or making hosted deployments brittle.

**Acceptance:** A short design note decides whether to ship an import-speed change, defer it, or accept PG slower-than-SQLite import as a product tradeoff.

### Phase 24: Hosted Operations

**Goal:** Make hosted PostgreSQL supportable.

1. Add backup/restore guidance.
2. Add connection-pool sizing and timeout guidance.
3. Add health diagnostics visible in the UI.
4. Add cloud-provider smoke tests where feasible.
5. Add a redacted diagnostic bundle for PostgreSQL workspace issues.

**Acceptance:** A clinical/research group can operate a hosted VarLens PostgreSQL database with documented backup, migration, security, and performance expectations.

## Recommended Immediate Next PRs

1. **Parity matrix and capability gates.** This is the highest leverage because it gives users clear behavior and gives future agents a reliable map.
2. **Migration lifecycle spec.** Write `.planning/specs/2026-04-29-postgresql-migration-lifecycle-and-capabilities.md` covering migrations, schema hardening, and capability model.
3. **Migration runner implementation.** Add runtime schema verification and forward-only migrations.
4. **Filter metadata parity.** Implement PostgreSQL `variants:filterOptions` and `variants:columnMeta`.
5. **High-value variant filter parity.** Panels, tags, comments, ACMG, annotations, analysis groups.
6. **Export/delete parity.** Required before real users can safely operate PostgreSQL workspaces.
7. **WGS query benchmark harness.** Add before adding speculative indexes.

## Strategic Recommendation

Do not block future feature development on PostgreSQL becoming faster than SQLite at import. Block future major clinical features on PostgreSQL having a clear parity contract and safe migration lifecycle.

The path that maximizes development velocity is:

1. Make backend capabilities explicit and visible.
2. Make PostgreSQL schema evolution safe.
3. Close the core clinical workflow gaps.
4. Benchmark WGS reads.
5. Then move feature development for VC data import, visualization, multi-omics, DRAGEN, ONT, ontology/HPO expansion, and external annotation support onto storage-neutral interfaces from the start.

This prevents every future feature from becoming a SQLite-first implementation followed by a separate PostgreSQL rescue phase.

## Best-Practice References

- PostgreSQL generated columns: https://www.postgresql.org/docs/current/ddl-generated-columns.html
- PostgreSQL function volatility categories: https://www.postgresql.org/docs/current/xfunc-volatility.html
- PostgreSQL full-text-search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
- PostgreSQL schemas and `search_path` security: https://www.postgresql.org/docs/current/ddl-schemas.html
- PostgreSQL COPY command: https://www.postgresql.org/docs/current/sql-copy.html
- PostgreSQL row security policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- `pg-copy-streams` documentation: https://github.com/brianc/node-pg-copy-streams
- Node.js stream backpressure: https://nodejs.org/en/learn/modules/backpressuring-in-streams
- Google Cloud SQL PostgreSQL best practices: https://docs.cloud.google.com/sql/docs/postgres/best-practices
- Google Cloud SQL managed connection pooling: https://docs.cloud.google.com/sql/docs/postgres/managed-connection-pooling
- Azure Database for PostgreSQL connection pooling best practices: https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-connection-pooling-best-practices
