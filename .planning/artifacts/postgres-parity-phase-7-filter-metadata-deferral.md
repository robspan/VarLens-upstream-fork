# PostgreSQL Phase 7 Filter Metadata Deferral

**Date:** 2026-04-24
**Decision:** Defer `variants:filterOptions` and `variants:columnMeta` from Phase 7.

## Reason

The implementation requires more than a small read-only repository helper and would expand Phase 7 beyond variant read parity.

## Required Follow-up

- Add PostgreSQL base column metadata aggregation.
- Add PostgreSQL extension column metadata aggregation.
- Decide whether cohort-scoped `caseIds` metadata belongs with variant reads or cohort parity.
- Add Docker E2E coverage after metadata is implemented.
