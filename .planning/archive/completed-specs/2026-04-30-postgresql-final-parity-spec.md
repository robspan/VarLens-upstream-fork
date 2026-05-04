# PostgreSQL Final Parity Spec

## Status

Implemented on `feat/postgres-final-parity` in:

- `7e0f06ec feat(postgres): add clinical variant filter parity`
- `6973526e feat(postgres): add cohort and export parity`
- `9faf91cf feat(postgres): add audit log parity`

## Problem

The PostgreSQL roadmap work merged in PR #185 delivered the main hosted-workspace foundation, but the app still declares several PostgreSQL capabilities as unavailable. The remaining gaps are user-visible: advanced clinical filters are rejected in PostgreSQL variant queries, cohort views and cohort export are gated off, and audit log reads/writes remain SQLite-only.

The goal is to close the remaining capability gaps that block PostgreSQL from being a storage-neutral workspace for current clinical workflows.

## Scope

This spec covers the remaining parity gaps proven by the current capability matrix and code:

- PostgreSQL variant clinical filters:
  - tag filters;
  - starred filters;
  - comment filters;
  - ACMG classification filters;
  - annotation scope handling;
  - active panel filters;
  - inheritance mode filters;
  - analysis group filters;
  - accepting `consider_phasing` with the same current no-op semantics as SQLite.
- PostgreSQL cohort workflows:
  - cohort variant query;
  - cohort summary;
  - cohort column metadata;
  - carriers;
  - gene burden;
  - cohort export.
- PostgreSQL audit log:
  - audit table migration;
  - audit writes for workflow mutations that already audit on SQLite;
  - audit read IPC through storage repositories.
- Capability closure:
  - update `POSTGRES_CAPABILITIES`;
  - update `.planning/artifacts/postgres-parity/capability-matrix.md`;
  - add tests that fail if a claimed PostgreSQL capability is still gated or rejected.

## Non-Goals

- Local file lifecycle parity for PostgreSQL. PostgreSQL workspaces are hosted connections, not encrypted local files.
- PostgreSQL at-rest encryption managed by VarLens. Server-side encryption is an operator responsibility.
- Bulk delete parity beyond currently shipped UI requirements.
- Automatic cloud instance provisioning.
- Row-level security or multi-tenant shared-table architecture.
- Making PostgreSQL import faster than SQLite import.
- Full phasing-aware compound heterozygous logic. The current SQLite path accepts `consider_phasing` but does not implement phasing-aware detection; PostgreSQL should match that behavior until a separate phased-genotype feature exists.

## Current Evidence

- `.planning/artifacts/postgres-parity/capability-matrix.md` still marks panel filters, tag/comment/ACMG filters, cohort query, and audit log as unsupported.
- `src/main/storage/postgres/PostgresStorageSession.ts` still sets PostgreSQL filter, cohort, cohort export, and audit capabilities to `false`.
- `src/main/storage/postgres/PostgresVariantReadRepository.ts` throws on advanced filters instead of translating them to SQL.
- `src/main/ipc/handlers/cohort-logic.ts` routes cohort work through SQLite `DatabaseService` or the SQLite worker pool path.
- `src/main/ipc/handlers/export.ts` routes `export:cohort` through SQLite-only `exportCohort`.
- `src/main/ipc/handlers/audit-log.ts` reads directly from `db.auditLog`.

## Architecture

### Variant Clinical Filters

PostgreSQL variant filters should stay in `PostgresVariantReadRepository` and use SQL fragments rather than introducing Kysely as a PostgreSQL dialect. The existing SQLite `VariantFilterBuilder` defines user-visible semantics; PostgreSQL should match those semantics with parameterized SQL and schema-qualified table references.

The repository should stop rejecting currently unsupported filter keys once each key has an implementation. Unsupported-column behavior should remain for unknown dynamic column filters.

Panel filters should use resolved `panel_intervals` when present. When only `active_panel_ids` is provided, the PostgreSQL path should resolve active panel genes/regions from workflow tables and apply a gene or region predicate matching current SQLite behavior.

Inheritance filters should match the existing SQLite SQL semantics for solo and trio modes. Phasing should be accepted but not alter SQL until the broader phased-genotype feature exists.

### Cohort

Add a PostgreSQL cohort repository behind the storage read executor. The first implementation should query PostgreSQL directly from `variants` and extension tables, grouping by variant coordinates and using `COUNT(DISTINCT case_id)` for carrier counts. It should preserve current IPC response shapes from `shared/types/cohort`.

If focused WGS query benchmarks show the direct aggregation path is too slow for common filters, add a PostgreSQL summary table in the same plan before enabling the capability. The capability must not flip to `true` until focused tests and WGS query benchmarks pass the accepted threshold in the plan.

Cohort export should reuse the PostgreSQL cohort query path and stream CSV output, mirroring the existing PostgreSQL variant export style. SQLite can keep its current XLSX export path.

### Audit Log

Add a PostgreSQL `audit_log` table with the same user-visible fields as SQLite. Route audit reads through storage read tasks instead of direct `db.auditLog` access. Route workflow mutation audit writes through storage write tasks or a small audit writer dependency passed into the existing mutation logic.

Audit writes must be best-effort only where SQLite is best-effort today. They must not obscure the primary workflow mutation error. They must never log secrets or connection strings.

### Capability Closure

Capabilities should move from `false` to `true` only in the plan that implements and tests that behavior. UI gates should remain in place but become inactive because the current PostgreSQL session reports support.

## Success Criteria

- PostgreSQL no longer throws `Unsupported PostgreSQL variant filter(s)` for the filters listed in scope.
- The case variant table can use tag, starred, comment, ACMG, annotation scope, panel, inheritance, and analysis-group filters against PostgreSQL.
- The cohort tab can query PostgreSQL, fetch summary data, fetch column metadata, fetch carriers, fetch gene burden, and export cohort results.
- Audit log views read PostgreSQL audit entries, and workflow mutations create PostgreSQL audit entries with the same action/entity semantics as SQLite.
- `POSTGRES_CAPABILITIES` reports `true` for implemented variant filters, cohort query/summary/carriers/gene burden/column metadata, cohort export, and audit log.
- `.planning/artifacts/postgres-parity/capability-matrix.md` has no unsupported rows for the scoped parity features.
- Focused tests pass before broad `make ci`.
- `make ci` passes after the final plan.

## Execution Order

1. PostgreSQL clinical variant filter parity.
2. PostgreSQL cohort and cohort export parity.
3. PostgreSQL audit log and capability closure.

This order gives users high-value single-case workflows first, then cohort workflows, then the audit/capability cleanup needed to honestly call parity complete.
