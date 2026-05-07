# Phase 2 execution plan — Postgres-only web mode

Status: live (2026-05-07)
Branch: `VarLens-Web`
Source: `decision-postgres-as-web-backend.md` + ADR-0001 + Phase 1 QA report follow-ups
Companion: [`phase1-execution-plan.md`](phase1-execution-plan.md) (structural prework)

The decision is settled: **the web mode runs on Postgres only, no SQLite
fallback.** Phase 1 + Stage 1.5 stopped at "data layer wired"; Phase 2
closes the gap by porting the auth layer too, removing the SQLite branch
from `src/web/server.ts`, and gating `make pilot` on `VARLENS_PG_URL`.

Desktop is unchanged — SQLite stays the default and only desktop backend.

## Why this is mandatory, not optional

- `better-sqlite3` is synchronous. Under Fastify it serializes every HTTP
  request through one Node event loop. A single 200 ms variant query
  blocks every other concurrent user. Acceptable for the desktop
  single-user case, fatal for multi-user web.
- ADR-0001 already named Postgres the web target; we just hadn't completed
  the wiring. Carrying a SQLite-on-web branch creates a shadow
  configuration that nobody actually wants in production but that future
  contributors might keep alive "for tests."
- Stage 2's multi-user story (per ADR-0003) requires Postgres for
  per-tenant schema isolation. Doing auth-on-SQLite first and then
  re-doing it on Postgres is wasted work.

## Scope (six deliverables)

| # | Deliverable | Touches | Test vehicle |
|---|---|---|---|
| 1 | Postgres migrations for `users` + `database_settings` (mirror SQLite schemas exactly) | `src/main/storage/postgres/migrations/sql/0007_*` | `postgres-migrations-idempotent` |
| 2 | `AuthRepository` interface + `SqliteAuthRepository` + `PostgresAuthRepository` | `src/main/services/auth/` | existing 61 auth tests + new pg-flavoured copies |
| 3 | `AuthService` refactored to depend on `AuthRepository` (no direct `db.prepare`) | `src/main/services/auth/AuthService.ts` | unchanged behaviour, 61 tests stay green |
| 4 | `src/web/server.ts` — Postgres-only path, fail-loud if `VARLENS_PG_URL` missing | `src/web/server.ts` | new `web-gate/integration/postgres-bootstrap.test.ts` |
| 5 | Preflight + compose: `pilot.sh` requires `VARLENS_PG_URL`; `docker-compose` activates `postgres` profile when web mode is on | `web-deploy/scripts/pilot.sh`, `web-deploy/Makefile`, `web-deploy/compose/docker-compose.yml` | live cold-start + new web-gate `deploy-stack` assertion |
| 6 | Flip 4 deferred parity scenarios to live: login, lockout, multi-user isolation, session expiry | `tests/web-gate/parity/auth-scenarios.parity.test.ts` | the tests themselves |

## Order of work

1. **Migrations first** (#1). Cheap, isolated, proves the schema mirrors
   work without disturbing production code. Add SQL files, run
   `postgres-migrations-idempotent` against a real instance.
2. **AuthRepository interface** (#2). Introduce the interface, ship
   `SqliteAuthRepository` as a 1:1 wrapper around current code (mechanical
   refactor, no behaviour change). Existing 61 auth tests are the gate.
3. **PostgresAuthRepository** (#2 cont'd). Ports each method to async
   `pg.Pool.query`. Test against the running pg-up container.
4. **`AuthService` refactor** (#3). Swap `private db: DatabaseType` for
   `private repo: AuthRepository`. Mostly mechanical — call sites
   identical. Existing tests should pass with a Sqlite repo wired in.
5. **Web server flip** (#4). Remove SQLite branch from `src/web/server.ts`.
   Boot fails if `VARLENS_PG_URL` not set. Recovery key path now derives
   from `VARLENS_RECOVERY_KEY_DIR` (default `/data`) instead of
   `dirname(VARLENS_DB_PATH)`.
6. **Pilot + compose plumbing** (#5). Operator interface stays one
   `web-deploy/.env` file; `VARLENS_PG_URL` becomes a preflight-required
   field. Compose's `postgres` profile activates whenever the var is set.
7. **Parity scenarios** (#6). Each of the four `describe.skip` placeholders
   gets implemented against the new Postgres path. They're the behavioural
   acceptance gate.

## Out of scope (Phase 2)

- **OIDC / federated identity**. The `Credential` discriminated union from
  Phase 1 is in place; OIDC is Stage 3.
- **Per-tenant schemas (`user_id NOT NULL DEFAULT 1`)**. The
  `user-id-schema` web-gate sentinel keeps tracking it. Phase 2 ships
  single-tenant Postgres; per-tenant is a follow-up.
- **Desktop Postgres mode**. Desktop stays SQLite. The `VARLENS_EXPERIMENTAL_STORAGE_BACKEND`
  flag for desktop remains experimental.
- **Connection-pool tuning**. Defaults from `buildPostgresPoolConfig` are
  fine for the Concept Pilot; revisit only when monitoring says so.
- **Read-only mode / reporting replicas**. Single primary, Phase 3.

## Risks

- **Auth-layer refactor touches security-critical code.** Mitigation: do
  the SQLite-flavour refactor first (mechanical), let the existing 61
  auth tests gate it; only then add the Postgres flavour.
- **Migration parity drift between SQLite and Postgres**. Mitigation: a
  single source of truth for schema constants (column names, role enum,
  lockout thresholds), with two SQL renderers. Already the pattern for
  data tables.
- **Recovery key path change is a deploy-time breaking change.** Old
  `VARLENS_DB_PATH`-derived path is gone. Mitigation: pilot.sh preflight
  warns if the operator's `.env` still has the SQLite-mode shape; cold-
  start verifies the new path lands at `/data/admin-recovery-key.txt`.
- **`make dev-postgres` (desktop) and the new web-postgres path share
  `getPostgresStorageConfig`.** Test both before merging.

## Exit criteria

```
make ci                                           # desktop suite still green
VARLENS_WEB=1 make ci                             # web suite green; user-id-schema sentinel only expected-fail
VARLENS_RUN_POSTGRES_E2E=1 make pg-up && \
  VARLENS_RUN_POSTGRES_E2E=1 make ci              # postgres-flavour auth tests green
make pilot                                        # cold-start with VARLENS_PG_URL succeeds end-to-end
                                                  # /api/auth/login round-trip works
                                                  # admin-recovery-key.txt at /data/admin-recovery-key.txt
                                                  # pilot.sh preflight aborts when VARLENS_PG_URL missing
VARLENS_RUN_WEB_GATE_PARITY=1 make web-gate-parity # 4 auth-scenarios flipped from skip→live
```

## Cross-references

- Decision: `.planning/web/decision-postgres-as-web-backend.md`
- ADR-0001 backend split (web=Postgres, desktop=SQLite)
- ADR-0003 per-tenant schema prep (Stage 2 follow-up to this work)
- Phase 1 QA report §H: classifies "Postgres backend integration in
  src/web/server.ts" as Medium / Stage 1.5 — this plan supersedes that
  classification by including the auth port too.
- `tests/web-gate/user-id-schema.test.ts` sentinel — unchanged scope.
