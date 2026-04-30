# PostgreSQL Parity Roadmap Specification

**Date:** 2026-04-29  
**Status:** Draft for planning  
**Owner:** VarLens development  
**Related review:** `.planning/code-review/CODEBASE-REVIEW-2026-04-28-POSTGRESQL-ROADMAP.md`

## 1. Purpose

VarLens must support PostgreSQL as a real workspace backend, not only as a developer-gated import/read experiment. The target end state is a storage-neutral app where new clinical features can be built once and run against both encrypted local SQLite databases and hosted/cloud PostgreSQL workspaces.

This specification defines the product, architecture, security, parity, performance, and operations requirements needed to finish PostgreSQL parity and unblock higher-value feature development such as VC data import, richer visualizations, multi-omics, DRAGEN/ONT support, ontology expansion, and additional annotation sources.

## 2. Current State

PostgreSQL support currently includes:

- experimental backend startup through `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`;
- PostgreSQL `StorageSession` with read/write/import executors;
- case list and case query reads;
- case metadata reads and writes;
- JSON import;
- VCF import using `COPY FROM STDIN` for base variants and extension tables;
- generated `search_document` columns for PostgreSQL full-text search support in `queryVariants`;
- basic variant reads and selected filters;
- Docker-gated PostgreSQL E2Es;
- opt-in WGS import benchmarks.

PostgreSQL support does not yet include:

- runtime schema migration lifecycle;
- production-safe hosted connection profiles;
- credential storage and SSL certificate UX;
- granular capability matrix;
- complete variant filter metadata;
- full panel/tag/comment/ACMG/annotation filter parity;
- export parity;
- case delete parity;
- database overview parity;
- cohort workflow parity;
- app-wide write-domain parity for tags, annotations, comments, presets, panels, gene lists, region files, metrics, audit, and analysis groups;
- WGS read/query benchmark gates;
- hosted operations guidance.

## 3. Guiding Principles

### 3.1 Storage-neutral feature development

All new major features must enter through storage-neutral interfaces unless they are explicitly backend-specific. SQLite-first features followed by a separate PostgreSQL rescue phase should stop.

### 3.2 Capability-first UX

If a backend lacks a feature, the UI must know that before the user clicks into a broken path. PostgreSQL gaps must be represented in a machine-readable capability model and shown as explicit gated UX, not raw backend exceptions.

### 3.3 Safe schema evolution before hosted adoption

No hosted PostgreSQL workspace should rely on Docker init scripts. Existing PostgreSQL databases must be versioned, migrated, checked, and diagnosed at startup.

### 3.4 Product parity before import micro-optimization

PostgreSQL does not need to beat SQLite import speed before it becomes useful. The immediate priority is workflow parity, safe lifecycle, and interactive WGS reads.

### 3.5 Evidence-based performance work

Indexes, partitioning, binary COPY, and staging-table imports should be driven by benchmark artifacts and `EXPLAIN (ANALYZE, BUFFERS)`, not speculation.

## 4. Target Product Behavior

A PostgreSQL workspace should allow a clinical geneticist or researcher to:

1. Connect to a PostgreSQL database using a saved connection profile.
2. Verify backend health and schema version.
3. Run required migrations safely or receive actionable guidance when migration is impossible with the current credentials.
4. Import JSON and VCF data, including SNV/indel, SV, CNV, STR, and multi-file cases.
5. Browse and filter variants with the same high-use workflows as SQLite.
6. Use panels, gene lists, region files, filter presets, tags, comments, ACMG/annotation filters, and analysis groups.
7. Query cohorts and summaries where PostgreSQL parity is declared.
8. Export variants and cohort results without loading WGS-sized result sets into memory.
9. Delete cases and keep frequency/cohort summaries consistent.
10. See clear capability messages for any deliberately deferred feature.
11. Generate redacted diagnostics for PostgreSQL issues.

## 5. Non-Goals

The following are not required for the first parity milestone:

- SaaS multi-tenant shared-table architecture.
- Row-level security for shared tables.
- PostgreSQL being faster than SQLite for local single-user import.
- Automatic cloud instance provisioning.
- Live multi-user collaboration semantics.
- Replacing SQLite as the default local offline backend.
- Implementing VC/multi-omics/DRAGEN/ONT features in this roadmap.

These can be future work after backend parity and development foundations are stable.

## 6. Architecture Overview

### 6.1 Storage session model

`StorageSession` remains the top-level backend abstraction. It owns workspace identity, backend capabilities, read executor, write executor, import executor, health checks, and backend lifecycle close operation.

SQLite sessions may continue exposing `DatabaseService` and `DbPool` through compatibility escape hatches. PostgreSQL sessions must not expose SQLite compatibility APIs except through explicit errors.

### 6.2 Domain repositories

Each storage-backed domain should have one repository or service per backend where behavior differs materially. PostgreSQL repositories should live under `src/main/storage/postgres/`; SQLite repositories may continue through existing `DatabaseService` components until refactoring is justified.

High-priority PostgreSQL repository groups:

- variants;
- cases;
- case metadata;
- tags;
- annotations;
- comments and metrics;
- panels/gene lists/region files;
- filter presets;
- analysis groups;
- cohort;
- export;
- database overview;
- audit log.

### 6.3 IPC routing

IPC handlers should not call `getDb()` for newly migrated storage-backed behavior. They should call `getDbManager().getCurrentSession()` and dispatch through read/write/import/domain executors.

Legacy `getDb()` paths are acceptable only for explicitly SQLite-only domains or unmigrated domains with capability gates.

### 6.4 Capability model

The current flat `StorageCapabilities` must be replaced or extended by a granular backend capability model.

Required capability groups:

```ts
interface BackendCapabilities {
  backend: 'sqlite' | 'postgres'
  workspace: {
    localFileLifecycle: boolean
    hostedConnectionLifecycle: boolean
    encryptionAtRest: boolean
    migrations: boolean
    healthDiagnostics: boolean
  }
  cases: {
    list: boolean
    query: boolean
    deleteOne: boolean
    deleteMany: boolean
    deleteAll: boolean
    overview: boolean
  }
  imports: {
    json: boolean
    vcf: boolean
    multiFileVcf: boolean
    bedFilters: boolean
    cancellation: boolean
  }
  variants: {
    query: boolean
    searchQuery: boolean
    legacySearch: boolean
    filterOptions: boolean
    columnMeta: boolean
    typeCounts: boolean
    typesPresent: boolean
    geneSymbols: boolean
    panelFilters: boolean
    tagFilters: boolean
    commentFilters: boolean
    acmgFilters: boolean
    annotationFilters: boolean
    inheritanceFilters: boolean
    analysisGroupFilters: boolean
    phasingFilters: boolean
  }
  workflow: {
    tags: boolean
    annotations: boolean
    caseComments: boolean
    caseMetrics: boolean
    filterPresets: boolean
    panels: boolean
    geneLists: boolean
    regionFiles: boolean
    analysisGroups: boolean
    auditLog: boolean
  }
  cohort: {
    query: boolean
    summary: boolean
    rebuild: boolean
    carriers: boolean
    geneBurden: boolean
    columnMeta: boolean
  }
  export: {
    variants: boolean
    cohort: boolean
    streaming: boolean
  }
}
```

The exact shape may change during implementation, but it must be nested, typed, test-covered, and specific enough for UI gating.

## 7. PostgreSQL Migration Lifecycle

### 7.1 Requirements

PostgreSQL must support runtime schema management for existing databases.

Required behavior:

1. On PostgreSQL session open, VarLens checks whether the target schema exists.
2. If the schema is empty, VarLens can create all required objects through migrations.
3. If the schema has a `schema_migrations` table, VarLens verifies applied migrations.
4. If migrations are pending and the connection has privileges, VarLens applies them in order.
5. If migrations are pending and privileges are insufficient, VarLens reports the required migration/admin role action.
6. If the schema is ahead of the app version, VarLens refuses to open in write mode and provides a clear error.
7. If a migration fails, VarLens reports the failed migration and leaves a clear state.

### 7.2 Migration table

Recommended table:

```sql
CREATE TABLE IF NOT EXISTS <schema>.schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_ms BIGINT NOT NULL
);
```

### 7.3 Migration file convention

Recommended path:

`src/main/storage/postgres/migrations/`

Recommended naming:

- `0001_create_cases.sql`
- `0002_create_case_metadata.sql`
- `0003_create_variants.sql`
- `0004_generated_search_documents.sql`

Migration files must be forward-only. Destructive changes require explicit design notes and tests.

### 7.4 Dev init compatibility

`make pg-reset` should stay fast. The dev container can either run generated init SQL built from the migration set, run a small bootstrap that invokes the migration runner, or keep init SQL temporarily while tests assert it matches migrations.

The long-term source of truth must be migrations, not Docker init scripts.

### 7.5 Schema hardening

Migrations must:

- schema-qualify all app objects;
- avoid relying on ambient `search_path`;
- create functions in the target schema or a dedicated app schema;
- define extension placement deliberately;
- test schemas that require quoting;
- document expected privileges.

## 8. Hosted Connection Profiles

### 8.1 Profile fields

A PostgreSQL connection profile should include:

- display name;
- connection URL without password or discrete host/port/database/user fields;
- target schema;
- SSL mode;
- CA certificate path or stored CA text;
- connection timeout;
- statement timeout;
- lock timeout;
- idle-in-transaction timeout;
- pool size;
- read-only health check mode;
- optional migration/admin profile reference.

### 8.2 Credential storage

Passwords and secrets must not be stored in plaintext settings JSON. Use the app's desktop-safe credential strategy. If no such strategy exists yet, this roadmap must add one before productizing saved PostgreSQL profiles.

### 8.3 SSL policy

The product must support at least:

- `disable` for local/dev only;
- `require-verify` for hosted production;
- CA certificate configuration for self-managed and managed provider certificates.

The implementation must resolve the current mismatch between rejecting SSL URL parameters and recommending connection-string or PG environment variables for worker SSL material.

### 8.4 Pooling policy

Default pool size must be conservative for desktop clients. Hosted docs emphasize connection pooling and connection limits. VarLens should support direct `pg` pool for simple deployments, compatibility notes for PgBouncer/session pooling, and clear warnings for transaction pooling if VarLens uses session features such as `SET`, temp tables, prepared statements, or advisory locks.

## 9. Capability-Aware UX

### 9.1 Requirements

The renderer must be able to ask what the current workspace supports. It should use this to hide unavailable actions, disable unavailable actions with explanatory copy, avoid showing workflows that will fail after user input, and show backend status in the workspace/database info UI.

### 9.2 Error boundaries

Raw errors such as `DatabaseService is not available for postgres sessions` must never be normal user-facing UX. They are acceptable as internal guardrails and tests, but user-facing paths need capability gates.

### 9.3 Capability tests

Tests must assert:

- SQLite declares all current SQLite features as supported;
- PostgreSQL declares only implemented features as supported;
- known PostgreSQL deferrals have matching UI gates or explicit IPC-level unsupported errors;
- migrated PostgreSQL domains do not call `getDb()`.

## 10. Variant Query and Filter Parity

### 10.1 Required single-case parity

PostgreSQL must support these variant query features:

- variant type tabs and counts;
- gene symbol filter and autocomplete;
- consequence and Sequence Ontology `func` filters;
- ClinVar filters;
- gnomAD AF max;
- CADD min;
- internal AF max;
- chromosome/position/ref/alt filters;
- full-text search query;
- base column filters;
- extension column filters for SV/CNV/STR;
- filter options;
- lazy column metadata;
- sorting;
- pagination;
- `skipCount` behavior.

### 10.2 Required clinical workflow filters

PostgreSQL must support or explicitly defer with capability gates:

- tag filters;
- starred-only filter;
- has-comment filter;
- ACMG classification filters;
- global/per-case annotation filters;
- active panel filters;
- panel intervals;
- inheritance mode filters;
- analysis group filters;
- phasing-aware filters.

Recommended near-term requirement: implement all except phasing if phasing semantics are not already stable in SQLite.

### 10.3 Filter metadata

`variants:filterOptions` and `variants:columnMeta` are priority parity blockers.

They must match SQLite semantics, support single-case scope, support cohort/multi-case scope where current UI requires it, avoid full WGS scans where index-backed alternatives exist, and have timing benchmarks before broad UI use on WGS cases.

## 11. Domain Parity

### 11.1 Cases

Required PostgreSQL parity:

- list cases;
- query cases;
- available builds;
- delete one case;
- delete batch;
- delete all where UX exposes it;
- update frequency/cohort summary state after delete;
- overview counts.

### 11.2 Case metadata

Current PostgreSQL case metadata is strong and should remain storage-session backed. Required follow-up:

- ensure all metadata UI paths use session executors;
- add missing parity tests for full user flows;
- verify HPO, cohort, data info, and external ID behavior against SQLite.

### 11.3 Tags

Required PostgreSQL parity:

- list/create/update/delete tags;
- usage count;
- get variant tags;
- assign/remove/set tags;
- tag filters in variant query.

### 11.4 Annotations and ACMG

Required PostgreSQL parity:

- global annotations;
- per-case annotations;
- batch annotation lookups;
- ACMG classification reads/writes;
- annotation-scope filters;
- ACMG filters.

### 11.5 Comments and metrics

Required PostgreSQL parity:

- case comments CRUD;
- variant comment indicators if present in SQLite workflow;
- case metric CRUD/listing;
- has-comment filters where variant comments exist.

### 11.6 Panels, gene lists, and region files

Required PostgreSQL parity:

- panel CRUD;
- panel genes;
- active panel state per case;
- gene-list CRUD;
- region-file CRUD/import;
- panel interval computation for PostgreSQL variant queries;
- BED export behavior where currently supported.

Gene reference data may remain local app resource if it is not workspace-specific.

### 11.7 Filter presets

Required PostgreSQL parity decision:

- If filter presets are user-local preferences, they may remain local app settings.
- If filter presets are workspace data, implement PostgreSQL-backed presets.

The decision must be explicit. Current SQLite behavior should be documented before choosing.

### 11.8 Analysis groups

Required PostgreSQL parity:

- group CRUD;
- group membership;
- analysis-group filters;
- cohort interactions if used by current UI.

### 11.9 Cohort

Required PostgreSQL parity:

- cohort query;
- cohort column metadata;
- cohort summary status;
- summary rebuild or backend-appropriate summary strategy;
- carriers;
- gene burden;
- gene burden compare if UI exposes it.

Cohort parity may be staged after single-case workflow parity, but capability gates must prevent broken PostgreSQL cohort UX until implemented.

### 11.10 Export

Required PostgreSQL parity:

- variant export;
- cohort export;
- streaming result pipeline;
- progress events;
- memory safety for WGS-scale exports;
- same user-visible file format as SQLite unless explicitly documented.

### 11.11 Audit log

Required PostgreSQL parity decision:

- If audit logs are workspace-level clinical records, implement PostgreSQL audit log.
- If audit logs are local activity logs, split local app audit from workspace audit.

The decision must be explicit before hosted workspaces are used with real users.

## 12. WGS Read/Query Performance

### 12.1 Benchmark scenarios

Add reproducible PostgreSQL WGS query benchmarks for:

- first page query;
- count query;
- `skipCount` query;
- gene filter;
- consequence filter;
- AF/CADD filter;
- ClinVar filter;
- text search;
- chromosome/position region filter;
- SV filter;
- CNV filter;
- STR filter;
- filter options;
- column metadata;
- panel filter;
- tag/comment/ACMG filters after implementation;
- cohort query;
- export streaming.

### 12.2 Artifacts

Write artifacts under:

`.planning/artifacts/perf/postgres-query/`

Artifacts should include dataset identifier, PostgreSQL version, local tuned versus portable-default profile, query parameters, p50/p95 timings where possible, `EXPLAIN (ANALYZE, BUFFERS)` for slow queries, index list, and comparison against SQLite where meaningful.

### 12.3 Budgets

Do not set strict budgets from a single run. Establish budgets after at least two stable baselines.

## 13. Import-Speed Follow-Up

### 13.1 Current position

Current PostgreSQL import speed is acceptable for parity work. It is slower than SQLite locally but under the Phase 9 escalation gate.

### 13.2 Future experiments

Run only after workflow parity and read benchmarks are underway:

- binary COPY for variants only;
- alternative ID strategy;
- staging-table load with set-based merge;
- frequency rebuild optimization;
- portable-default PostgreSQL profile;
- managed/cloud-like profile.

### 13.3 Shipping criteria

Ship an import-speed change only if it improves wall time materially, does not increase memory risk, works on managed PostgreSQL constraints, does not make migrations brittle, preserves cancellation behavior, preserves large allele correctness, and preserves extension-table integrity.

## 14. Hosted Operations

### 14.1 Health diagnostics

PostgreSQL workspace health should show:

- connection status;
- round-trip time;
- PostgreSQL server version;
- current schema;
- schema migration status;
- current role;
- read/write/migration privilege status;
- SSL status where available;
- pool configuration;
- last migration failure if any.

### 14.2 Diagnostic bundle

Add a redacted diagnostic bundle for PostgreSQL issues.

It should include:

- app version;
- backend kind;
- redacted connection label;
- schema name;
- migration status;
- capability matrix;
- recent PostgreSQL errors without secrets;
- slow query artifact references if available;
- import profile summary if enabled.

### 14.3 Backup and restore guidance

Documentation must explain database-level backup expectations, schema-level backup if one schema per workspace is used, `pg_dump` and `pg_restore` guidance, restore compatibility with migrations, and clinical data handling and PHI caution.

### 14.4 Cloud/provider notes

Minimum guidance should cover local Docker dev profile limitations, pool sizing and connection limits, SSL certificate configuration, maintenance windows, backup/restore testing, and unsupported transaction-pooling features if relevant.

## 15. Recommended Implementation Phases

### Phase 17: Capability Matrix and UX Gates

Deliverables:

- typed granular capability model;
- SQLite/PostgreSQL capability definitions;
- IPC or preload exposure for current capabilities;
- renderer gates for known PostgreSQL deferrals;
- parity checklist artifact under `.planning/`;
- tests that PostgreSQL does not fall through to SQLite-only paths for gated actions.

Exit criteria:

- PostgreSQL users do not hit unplanned SQLite-only exceptions during normal navigation.
- Future agentic work has a concrete parity checklist.

### Phase 18: Migration Lifecycle and Schema Hardening

Deliverables:

- migration runner;
- `schema_migrations` table;
- converted migration files;
- startup schema check;
- non-`public` schema tests;
- schema-qualified functions/indexes/tables;
- privilege and SSL profile design finalized.

Exit criteria:

- VarLens can initialize or migrate an existing PostgreSQL schema without Docker init scripts.

### Phase 19: Variant Metadata and Filter Parity

Deliverables:

- PostgreSQL `variants:filterOptions`;
- PostgreSQL `variants:columnMeta`;
- panel filters;
- tag/comment/ACMG/annotation filters;
- tests against SQLite semantics;
- initial WGS timing artifacts for filter metadata.

Exit criteria:

- PostgreSQL single-case variant filtering supports the high-use clinical workflow surface.

### Phase 20: Export/Delete/Overview Lifecycle Parity

Deliverables:

- PostgreSQL case delete;
- PostgreSQL batch/delete-all where exposed;
- PostgreSQL database overview;
- PostgreSQL variant export;
- PostgreSQL cohort export if cohort query exists;
- streaming export path;
- WGS memory-safety tests or benchmarks.

Exit criteria:

- A PostgreSQL workspace can be operated safely after import, including cleanup and export.

### Phase 21: Workflow Domain Parity

Deliverables:

- tags;
- annotations and ACMG;
- comments and metrics;
- panels/gene lists/region files;
- filter presets decision and implementation if workspace-scoped;
- analysis groups;
- audit-log decision and implementation if workspace-scoped.

Exit criteria:

- Core clinical workflow features work on PostgreSQL or are explicitly documented as out of scope.

### Phase 22: WGS Query Performance Program

Deliverables:

- reproducible query benchmark harness;
- local tuned and portable-default profiles;
- query plan artifacts;
- evidence-backed index changes;
- baseline budgets after stable runs.

Exit criteria:

- PostgreSQL has documented interactive-read performance at WGS scale.

### Phase 23: Import-Speed Decision

Deliverables:

- import profile artifact;
- binary COPY experiment;
- ID strategy experiment;
- staging-table experiment;
- decision note.

Exit criteria:

- Team decides whether to ship an import-speed optimization or accept current import speed as a product tradeoff.

### Phase 24: Hosted Operations

Deliverables:

- connection profile UI completion;
- credential storage;
- SSL/CA UX;
- backup/restore docs;
- diagnostic bundle;
- cloud/provider guidance;
- optional provider smoke tests.

Exit criteria:

- A clinical/research group can operate a hosted VarLens PostgreSQL workspace with documented security, backup, migration, and performance expectations.

## 16. Risks

### 16.1 Scope creep

Trying to finish every domain before creating capability gates will keep PostgreSQL brittle. Capability gates must come first.

### 16.2 Migration complexity

Converting Docker init SQL to migrations can reveal schema drift. Treat this as a required cleanup, not a distraction.

### 16.3 Managed PostgreSQL constraints

Local Docker tuning may hide production bottlenecks or unsupported settings. Add portable-default benchmarks before making hosted claims.

### 16.4 UI inconsistency

If capability checks are partial, users will see inconsistent PostgreSQL behavior. Capability tests must cover known deferrals.

### 16.5 Future feature drag

If VC/multi-omics/DRAGEN/ONT features are built SQLite-first before this foundation lands, every one will add to PostgreSQL parity debt.

## 17. Acceptance Criteria for PostgreSQL Parity

PostgreSQL parity is complete enough to resume major feature development when:

1. PostgreSQL workspaces open through a productized connection profile.
2. Schema version is checked and migrations run safely.
3. Capability matrix is exposed and used by UI gates.
4. Import works for JSON and VCF, including multi-file VCF and current variant classes.
5. Single-case variant browse/filter matches SQLite for high-use workflows.
6. Tags, annotations, comments, panels, presets, gene lists/region files, and analysis groups are implemented or explicitly out of scope with gates.
7. Export and delete work safely.
8. Database overview and health diagnostics work.
9. WGS read/query performance is benchmarked and documented.
10. Hosted operation guidance exists.

## 18. Immediate Next Planning Artifacts

Create implementation plans in this order:

1. `.planning/plans/2026-04-29-postgresql-capability-matrix-and-ux-gates.md`
2. `.planning/plans/2026-04-29-postgresql-migration-lifecycle.md`
3. `.planning/plans/2026-04-29-postgresql-variant-filter-parity.md`
4. `.planning/plans/2026-04-29-postgresql-export-delete-overview-parity.md`
5. `.planning/plans/2026-04-29-postgresql-workflow-domain-parity.md`
6. `.planning/plans/2026-04-29-postgresql-wgs-query-performance.md`
7. `.planning/plans/2026-04-29-postgresql-hosted-operations.md`

The import-speed follow-up should wait until after at least the first WGS query-performance baseline.
