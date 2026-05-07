import { describe, it } from 'vitest'

/**
 * Phase 2: this test was Phase 1 SQLite-flavoured (used `sqlite_master`
 * + `PRAGMA user_version` to assert idempotency on a file path the
 * web server no longer accepts). It's superseded by:
 *
 *   tests/main/storage/postgres-migrations-idempotent.test.ts
 *
 * which exercises the same property against a real Postgres instance
 * (gated by VARLENS_RUN_POSTGRES_E2E=1, requires `make pg-up`).
 *
 * The Phase 1 SQLite path is gone — the web variant is Postgres-only
 * (see .planning/web/phase2-execution-plan.md). Kept as a placeholder
 * so the suite count stays stable until the static gate lands a
 * permanent replacement test.
 */
describe.skip('migrations idempotency (web path) — superseded by postgres-migrations-idempotent', () => {
  it('see tests/main/storage/postgres-migrations-idempotent.test.ts', () => {
    /* deliberately empty */
  })
})
