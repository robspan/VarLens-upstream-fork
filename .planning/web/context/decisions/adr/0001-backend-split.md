# ADR 0001 — Backend split: SQLite (desktop) / Postgres (web)

Status: Accepted (2026-05-04)
Source: [`../postgres-backend.md`](../postgres-backend.md) — full rationale and rejected alternatives

## Context

VarLens runs both as an Electron desktop app (single user, file-based) and, in Phase 1, as a Fastify web server. A single backend choice would simplify operations, but the two contexts have different constraints.

## Decision

- **Desktop**: SQLite (`better-sqlite3-multiple-ciphers`), file-based, encrypted at rest. Unchanged.
- **Web**: Postgres, hosted, schema-isolated per operator environment. Production target.

Both implementations sit behind `StorageSession` (`src/main/storage/session.ts`). Domain logic depends only on the interface.

## Consequences

- Migrations exist in two flavours (SQLite + Postgres), tested independently. The `tests/main/storage/postgres-migrations-idempotent.test.ts` test gates Postgres migration correctness against a real instance.
- Postgres-specific SQL is allowed only in `src/main/storage/postgres/` repositories. The `db-seam` web-gate test enforces that the rest of the codebase routes through `StorageSession`.
- Performance characteristics differ. The Phase 16 work brought Postgres VCF imports to ~1.85× SQLite via COPY-from-stdin; further closing the gap is tracked separately.
- Single-tenant Postgres for Phase 1; multi-tenant schema-per-user is Stage 2 (see ADR 0003).
