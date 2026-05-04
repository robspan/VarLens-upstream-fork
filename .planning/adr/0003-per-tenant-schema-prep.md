# ADR 0003 — Per-tenant schema preparation

Status: Accepted (2026-05-04)
Related: ADR 0001 (backend split), [`../web/testing/desktop-to-web-parity.md`](../web/testing/desktop-to-web-parity.md) §user-id-schema

## Context

Phase 1 deploys VarLens-web as **single-tenant, single-user** for the Charité environment. Stage 2 introduces multi-user (multiple analysts on one instance) and may extend to multi-tenant. Retrofitting tenant isolation into a schema designed for a single user is expensive and error-prone.

## Decision

Phase 1 schema is shaped to make Stage 2 a configuration change, not a migration:

- **Every domain table carries `user_id INTEGER NOT NULL DEFAULT 1`.** Enforced by `tests/web-gate/user-id-schema.test.ts`. Single-user mode means every row gets `user_id = 1`; multi-user mode just removes the default and starts populating it.
- **Postgres deployments use schema-per-environment**, not a shared schema. The `applicationName` and `schema` parameters in `PostgresStorageConfig` are present today; only one schema is in use per instance, but the abstraction is in place.
- **Audit log columns** match the Stage 2 vocabulary `{id, ts, user_id, action, entity, entity_id, pre_state, post_state, ip, user_agent}`. Enforced by `tests/web-gate/audit-shape.test.ts`. A Phase 1 deployment writes only one user's actions, but the schema is ready for richer attribution.
- **`Credential` discriminated union** (`src/main/auth/types.ts`) declares both `kind: 'password'` and `kind: 'token'` arms. Phase 1 implements `password`; OIDC plugs into `token` in Stage 2 without touching call sites.

## Consequences

- Stage 2 multi-user activation = drop `DEFAULT 1` from `user_id` columns + add scoping to repository queries. No data migration required for existing Phase 1 deployments (every row already has a valid `user_id = 1`).
- OIDC retrofit lands behind `src/main/auth/providers/` (one new file implementing `PasswordProvider` or its sibling `TokenProvider`). Existing call sites unchanged.
- Multi-tenant deployment (multiple Charité environments on one Postgres host) uses schema-per-tenant. The migration runner is already schema-aware (`PostgresMigrationRunner(pool, schema, migrations)`).
- The forcing function — making this prep visible and enforced — is the web-gate test suite. A migration that adds a domain table without `user_id` fails CI today, even though Phase 1 ignores the column.
