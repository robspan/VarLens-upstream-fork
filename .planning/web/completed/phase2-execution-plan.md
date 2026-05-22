# Phase 2 execution plan — Postgres-only web mode

Status: completed Postgres-only web mode (2026-05-07, revised); follow-ups live in `../backlog/`
Branch: `VarLens-Web`
Source: `../context/decisions/postgres-backend.md` + ADR-0001 + Phase 1 QA report follow-ups
Companion: [`phase1-execution-plan.md`](phase1-execution-plan.md) (structural prework)

The decision is settled: **the web mode runs on Postgres only, no SQLite
fallback.** Phase 1 + Stage 1.5 stopped at "data layer wired"; Phase 2
closes the gap by adding a Postgres-flavoured auth path **isolated under
`src/web/auth/`**, removing the SQLite branch from `src/web/server.ts`,
and gating `make pilot` on `VARLENS_PG_URL`.

Desktop is unchanged — SQLite stays default. **`src/main/services/auth/AuthService.ts`
is not touched.**

## Why this is mandatory, not optional

- `better-sqlite3` is synchronous. Under Fastify it serializes every HTTP
  request through one Node event loop. A single 200 ms variant query
  blocks every other concurrent user. Acceptable desktop, fatal web.
- ADR-0001 already named Postgres the web target; we just hadn't
  completed the wiring. Carrying a SQLite-on-web branch creates a
  shadow configuration nobody wants in production.
- Stage 2's multi-user story (per ADR-0003) requires Postgres for
  per-tenant schema isolation. Doing auth-on-SQLite first then re-doing
  it on Postgres is wasted work.

## Separation principle

Web-specific code lives **under `src/web/`**, never in shared `src/main/`.
The desktop AuthService is a security-critical path that's been stable
across many releases; adding a Postgres flavour by refactoring it would
expose desktop users to regression for zero desktop benefit. Instead we
ship a parallel implementation co-located with the web server, and the
two never see each other's call sites:

```
src/main/services/auth/AuthService.ts        unchanged, desktop-only
src/web/auth/PostgresWebAuthService.ts       new, web-only
src/web/server.ts                            picks PostgresWebAuthService
```

Shared schema constants (column names, role enum, lockout thresholds,
Argon2 parameters via `PasswordProvider`) move to a thin
`src/main/services/auth/auth-constants.ts` so the two implementations
can't drift on policy.

## Scope (six deliverables)

Each deliverable is **test-first**: the gate goes red first, then the
implementation lands and turns it green, in the same PR. Matches the
phase-1 pattern where `describe.skip` placeholders flipped to live with
the user-flow implementation.

| # | Deliverable | Code location | Test goes red first | Test goes green when |
|---|---|---|---|---|
| 1 | Postgres migrations for `users` + `database_settings` mirroring SQLite schemas | `src/main/storage/postgres/migrations/sql/0007_*.sql` | `postgres-migrations-idempotent` extended to assert the new tables exist after migration | the SQL files are added |
| 2 | Schema constants extracted to a single module (column names, role enum, thresholds) | `src/main/services/auth/auth-constants.ts` (new) | new `tests/main/services/auth/auth-constants.test.ts` asserts both backends consume the same constants | both `AuthService` (sqlite) and `PostgresWebAuthService` import from it |
| 3 | `PostgresWebAuthService` — full surface (createFirstUser, authenticate, createUser, listUsers, deactivate, resetPassword, changePassword, isAccountsEnabled) over `pg.Pool` | `src/web/auth/PostgresWebAuthService.ts` (new) | new `tests/web/auth/postgres-web-auth-service.test.ts` mirroring the 61 SQLite auth tests against a real pg-up container (gated by `VARLENS_RUN_POSTGRES_E2E=1`) | every mirrored test passes |
| 4 | `src/web/server.ts` — Postgres-only path, fail-loud if `VARLENS_PG_URL` missing; recovery key path moves to `VARLENS_RECOVERY_KEY_DIR` (default `/data`) | `src/web/server.ts` | new `tests/web-gate/integration/postgres-required.test.ts` asserts buildApp throws when `VARLENS_PG_URL` is unset | the SQLite branch is removed |
| 5 | Deploy/operator repo preflight requires `VARLENS_PG_URL`; compose app service receives the URL | external deploy/operator repo | deploy/operator tests live outside this app repo | live cold-start with `VARLENS_PG_URL` succeeds end-to-end |
| 6 | Flip 4 deferred parity scenarios to live: login, lockout, multi-user isolation, session expiry | `tests/web-gate/parity/auth-scenarios.parity.test.ts` | the four `describe.skip` blocks already exist (red because skipped) | each scenario implemented against PostgresWebAuthService |

## Order of work

Test goes red, then code, then test goes green — **same commit per
deliverable** to keep history bisectable.

1. **#1 Migrations** — cheap, isolated. Add SQL files + extend the
   idempotency test. No code outside Postgres-migrations land touched.
2. **#2 Constants extraction** — pure refactor, mechanically split out
   policy values into a new module. AuthService keeps working
   identically (existing 61 tests gate it). Postgres impl will
   consume the same constants.
3. **#3 PostgresWebAuthService** — new file, new tests. The 61 SQLite
   auth tests are the spec; the new tests mirror them shape-for-shape
   against a real pg-up container. Ports SQL one method at a time.
   Don't refactor the existing AuthService.
4. **#4 Web server flip** — write the "throws without `VARLENS_PG_URL`"
   gate first, watch it fail (current code accepts SQLite path), then
   remove the SQLite branch and watch the gate go green. Recovery-key
   path also tested separately via the existing `integration/admin-bootstrap`
   shape.
5. **#5 Pilot + compose** — keep deploy/operator coverage outside this app repo with the
   profile-activation assertion (red because compose doesn't conditionally
   activate yet), then wire pilot.sh + Makefile + compose to make it green.
   Live cold-start verifies end-to-end.
6. **#6 Parity scenarios** — the four `describe.skip` placeholders flip
   to active assertions; each implementation lives in the same commit.

## Out of scope (Phase 2)

- **OIDC / federated identity**. The `Credential` discriminated union
  from Phase 1 is in place; OIDC is Phase 3.
- **Per-tenant schemas (`user_id NOT NULL DEFAULT 1`)**. The
  `user-id-schema` web-gate sentinel keeps tracking it. Phase 2 ships
  single-tenant Postgres; per-tenant is a follow-up.
- **Desktop Postgres mode**. Desktop stays SQLite. The
  `VARLENS_EXPERIMENTAL_STORAGE_BACKEND` flag for desktop remains
  experimental and untouched.
- **`AuthService` refactor**. Explicitly NOT in scope. Desktop's
  AuthService stays a synchronous better-sqlite3 user; the Postgres
  flavour is a parallel implementation, not a refactored generalization.
- **Connection-pool tuning**. Defaults from `buildPostgresPoolConfig`
  are fine for the Concept Pilot; revisit when monitoring says so.

## Risks

- **Schema parity drift between SQLite and Postgres `users` /
  `database_settings`**. Mitigation: `auth-constants.ts` (deliverable #2)
  is the single source of truth for column names + role enum + lockout
  thresholds. Both implementations import from there, no duplication.
- **PostgresWebAuthService bugs in security-critical paths.** Mitigation:
  the new test file mirrors the existing 61 auth tests one-for-one; if
  a desktop test passes against SQLite and the corresponding web test
  fails against Postgres, that's the bug.
- **Recovery-key path change is a deploy-time breaking change.**
  Pilot.sh preflight warns if the operator's `.env` still has the
  SQLite-mode shape; cold-start verifies the new path lands at
  `/data/admin-recovery-key.txt`.
- **Code duplication between AuthService and PostgresWebAuthService.**
  Accepted as the price of zero-touch desktop auth. If it gets painful
  (3rd backend, OIDC arrives), the right next move is the shared
  `AuthRepository` interface — but that's a deliberate Phase 3 decision,
  not Phase 2.

## Exit criteria

```
make ci                                           # desktop suite still green; AuthService unchanged
VARLENS_WEB=1 make ci                             # web suite green; user-id-schema sentinel only expected-fail
VARLENS_RUN_POSTGRES_E2E=1 make pg-up && \
  VARLENS_RUN_POSTGRES_E2E=1 make ci              # PostgresWebAuthService tests green
make pilot                                        # cold-start with VARLENS_PG_URL succeeds end-to-end
                                                  # /api/auth/login round-trip works against Postgres
                                                  # /data/admin-recovery-key.txt present
                                                  # pilot.sh preflight aborts when VARLENS_PG_URL missing
VARLENS_RUN_WEB_GATE_PARITY=1 make web-gate-parity # 4 auth-scenarios flipped from skip→live
```

## Cross-references

- Decision: `.planning/web/decision-postgres-as-web-backend.md`
- ADR-0001 backend split (web=Postgres, desktop=SQLite)
- ADR-0003 per-tenant schema prep (Stage 3 follow-up to this work)
- Phase 1 QA report §H: classifies "Postgres backend integration in
  src/web/server.ts" as Medium / Stage 1.5 — this plan supersedes that
  classification by including the auth port (under `src/web/auth/`,
  not by refactoring shared code).
- `tests/web-gate/user-id-schema.test.ts` sentinel — unchanged scope.
- Memory: "PG support is Stage 1.5 gated on PostgresWebAuthService
  landing under `src/web/auth/`" — this plan delivers that.
