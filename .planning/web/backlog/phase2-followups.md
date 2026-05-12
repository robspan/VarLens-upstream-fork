# Phase 2 — open follow-ups (Stage 3 candidates)

Date: 2026-05-07
Branch: `VarLens-Web`
Status: deferred (Stage 3 work)

The Phase 2 final-QA wave (10 holistic reviewers on the full delivery)
flagged three substantive follow-ups that are out of Phase 2 scope but
should land before the pilot is treated as production-ready for a
multi-user clinical workload.

## 1. Sessions / cookies / route auth (CRITICAL for prod)

**Status**: not implemented. The web stack ships login but no
post-login session — `/api/auth/login` returns the user payload, no
`Set-Cookie`, no JWT. `/api/cases` and `/api/variants` register no
auth middleware, so an unauthenticated client reaches the
StorageSession directly.

**Why deferred**: Phase 2 plan §"Out of scope" explicitly names OIDC
retrofit as Stage 3 work, and the Credential discriminated-union
(`{kind:'password'} | {kind:'token'}`) at `src/main/auth/types.ts`
is the seam. The pilot is single-tenant and intranet-grade; the
current login flow is a minimum gate, not a production session
layer.

**Activation trigger**: pilot graduates to broader exposure (multi-
user, public IP, real PHI). The structural-parity gate at
`tests/web-gate/parity/auth-scenarios.parity.test.ts:session expiry`
is the test that flips skip→live with the implementation.

**Scope sketch**:
- `@fastify/cookie` + `@fastify/session` (or JWT) wired in
  `src/web/server.ts`
- `/api/auth/login` issues session
- `preHandler` on cases / variants routes asserts session is valid
- Logout endpoint + session expiry middleware
- Update `WebAuthService` interface in `src/web/routes/auth.ts` to
  expose `logout()` / `currentUser()`

## 2. Multi-user data isolation (per-tenant schema)

**Status**: structural support landed (USER_ROLES, createUser, role
enum, `user-id-schema` web-gate sentinel). Row-level isolation NOT
enforced — every query in PostgresStorageSession reads/writes
without a `WHERE user_id = $X` filter.

**Why deferred**: ADR-0003 (per-tenant schema prep) frames this as
Stage 3 work. The `user_id NOT NULL DEFAULT 1` schema migration is
table-by-table and will touch every domain table (cases, variants,
analysis_groups, etc.) — much bigger than the auth surface Phase 2
delivered.

**Activation trigger**: `tests/web-gate/user-id-schema.test.ts`
sentinel flips green.

## 3. External Postgres override path

**Status**: `VARLENS_PG_URL` can be overridden to point at an
external Postgres, but compose still spins up the in-stack
`postgres` service unconditionally (it's in the default profile and
varlens depends_on it). External-PG operators get an unused local
container running.

**Why deferred**: Single-tenant Charité pilot uses the in-stack
Postgres exclusively. External-PG is a Stage 3 ops feature for
managed-DB deployments.

**Scope sketch**:
- Re-introduce a `local-postgres` profile gate
- pilot.sh detects whether VARLENS_PG_URL targets the in-stack
  service and toggles the profile accordingly
- Document in DEPLOY.md and `web-deploy/docs/database.md`

## What Phase 2 DID land (so this doc isn't all "later")

- Migration 0007 (users + database_settings + partial unique admin
  index)
- Cross-backend constants module (`src/shared/auth/auth-constants.ts`)
- Cross-backend types module (`src/shared/auth/types.ts`)
- PostgresWebAuthService — full nine-method surface, atomic lockout,
  transactional createFirstUser, AdminAlreadyExistsError sentinel
- `src/web/server.ts` Postgres-only with VARLENS_PG_URL fail-loud,
  shared pg.Pool, /healthz with timeout, recovery-key dir at
  VARLENS_RECOVERY_KEY_DIR
- Compose stack drops the `postgres` profile gate; varlens
  depends_on postgres.service_healthy; POSTGRES_PASSWORD `:?` guard
- Smoke updated for 5 services (postgres included)
- pilot.sh preflight warns on stale `VARLENS_DB_PATH` (Phase 1→2
  upgrade hint)
- Backup script Postgres-aware: `pg_dump --format=custom` before
  restic snapshot, raw PGDATA excluded, refuses to run if postgres
  not up. Cloud-init clone matches.
- restore-drill verifies pg_dump archive presence + PGDMP magic
  bytes + PGDATA exclusion
- Tests: 12/12 deploy-stack gates, 757/757 main-process auth/storage
  tests, structural parity assertions for both backends, web-gate
  postgres-required + (gated) integration tests, fail-loud test
  flipped to assert on VARLENS_PG_URL

## Cross-references

- `.planning/web/phase2-execution-plan.md` — the original plan
- `.planning/web/adr/0001-backend-split.md` — web=Postgres, desktop=SQLite
- `.planning/web/adr/0003-per-tenant-schema-prep.md` — Stage 3 isolation
- `tests/web-gate/user-id-schema.test.ts` — Stage 3 activation
  sentinel
