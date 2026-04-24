# PostgreSQL WGS-readiness Inventory

**Date:** 2026-04-24
**Scope:** Planning artifact only; no runtime code changes.

## Variant Tables Required

- `variants`
- `variant_transcripts`
- `variant_frequency`
- `variant_sv`
- `variant_cnv`
- `variant_str`
- PostgreSQL replacement for SQLite FTS tables

## First Variant-read Slice

Implement `variants:typeCounts`, `variants:typesPresent`, and `variants:geneSymbols` before full `variants:query`.

Reason: these are small, user-visible, case-scoped queries that validate variant table shape and indexes before porting the full filter builder.

## Indexes To Evaluate

- `variants(case_id, variant_type)`
- `variants(case_id, gene_symbol)`
- `variants(case_id, chr, pos)`
- `variants(case_id, consequence)`
- `variants(case_id, func)`
- `variant_frequency(chr, pos, ref, alt)`
- extension table indexes on `variant_id`

## PostgreSQL Full-text Options

- `to_tsvector` generated/search column plus GIN index for basic text search
- trigram index for gene/HGVS-ish prefix/fuzzy lookups
- explicit degraded mode only if search is excluded from early PG beta

## Import Scale Blockers

- current import worker accepts `dbPath` and SQLite key
- current import SQL is synchronous better-sqlite3 statements
- current FTS trigger teardown/rebuild is SQLite-specific
- PostgreSQL bulk path needs `COPY` or batched `INSERT ... ON CONFLICT`

## Measurement Commands For Phase 7

```bash
make pg-reset
make pg-up
VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-*.e2e.ts
```
