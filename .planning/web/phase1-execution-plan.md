# Phase 1 execution plan

Status: live (2026-05-04)
Branch: `VarLens-Web`
Source: `.planning/web/spec/konzept/app.html` §app2.1 (canonical criteria)
Companion: [`testing/`](testing/) (test vehicles), [`decision-postgres-as-web-backend.md`](decision-postgres-as-web-backend.md) (backend choice)

The 12 §app2.1 criteria, mapped to: blocking dependencies · test vehicle · current status. **No criterion text restated** — read the konzept for the spec.

## Order of work — status (2026-05-04)

The three big unblockers all landed in this PR:

1. **Web build target** (`src/web/server.ts` → `out/web/server.cjs`) ✅
   Fastify app with Pino logging, SIGTERM lifecycle, /healthz. Three domain
   routes wired (cases, auth, variants), all reusing the corresponding
   `<name>-logic` modules per the handler-seam rule.
2. **StorageSession refactor** (interface seal) ✅
   `getDatabaseService` / `getDbPool` removed from the interface. The 3
   remaining call sites (DatabaseManager, dbPoolManager, SqliteImportExecutor)
   type-narrow on `capabilities.backend` first.
3. **Auth abstraction** ✅
   Argon2 lives only in `src/main/auth/providers/argon2-provider.ts`.
   `Credential = {kind:'password'} | {kind:'token'}` is in place for the
   OIDC retrofit.

What remains: behavioral coverage. Each new user-facing flow in the web
build adds its parity scenario (TDD via the existing harness). The
`user-id-schema` web-gate tracks per-tenant prep table-by-table; not a
hard Phase 1 blocker — it's the visible Stage-2 backlog.

## Status table

| # | Criterion (short) | Blocked by | Test vehicle | Status |
|---|---|---|---|---|
| 1 | Web container starts w/o Electron deps | — | `electron-leak` + `integration/healthz` | ✅ |
| 2 | Migrations idempotent | — | `integration/migrations-idempotent` (SQLite) + `postgres-migrations-idempotent` (real PG, gated) | ✅ both backends |
| 3 | `/healthz` 200 / 503 | — | `integration/healthz` (both paths) | ✅ |
| 4 | Argon2 login + multi-user | — | `auth-isolation` (structural) + `parity/auth-scenarios` (4 deferred) | ✅ structural; parity flips with each user-flow PR |
| 5 | Import / filter / analysis preserved | Web client integration | `parity/import-and-filter` (Electron green) | ✅ Electron pinned; web HTTP wired for cases/auth/variants |
| 6 | Services use repository iface only | — | `db-seam` (interface seal) | ✅ sealed |
| 7 | Electron variant builds w/o regression | — | `make ci-full` + `tests/refactor-checkpoint/` | ✅ |
| 8 | Logs JSON to stdout | — | `integration/json-logs` | ✅ |
| 9 | SIGTERM clean shutdown | — | `integration/sigterm` | ✅ |
| 10 | ADRs 1, 2, 3 filed | — | Doc gate | ✅ `.planning/adr/0001..0003` |
| 11 | §bewertung1 / §bewertung3 current | IaC repo work | Doc gate | Tracked in IaC (out of repo scope) |
| 12 | Bridge-clause structural | — | `db-seam` + `auth-isolation` + `user-id-schema` + `handler-seam` | 3/4 ✅; `user-id-schema` tracks per-tenant prep |

## Per-criterion implementation notes (only where non-obvious)

- **#1 / #3 / #8 / #9** — single PR cluster: one Fastify entrypoint that reuses every domain handler from `src/main/ipc/domains/`. The `handler-seam` test enforces "exact same function" — no duplication.
- **#2** — done. Postgres real-instance test runs only with `VARLENS_RUN_POSTGRES_E2E=1` + `make pg-up`; default CI is unaffected.
- **#4** — sequence: provider interface (no test, structural) → Argon2 moves into `src/main/auth/providers/` (existing tests are the gate) → `auth-isolation` flips green → flip `describe.skip` on the four auth scenarios as each is wired up.
- **#5** — Electron half landed; web half is the activation test for the build target in #1. After web build lands, the parity scenario goes green or it's a real bug.
- **#6** — every IPC handler must call methods on an injected `StorageSession` rather than `getDatabaseService()` / `getDbPool()`. Allowlist in `db-seam.test.ts` shrinks PR by PR. The two refactor-checkpoint snapshots will drift during this work — review the diff each PR.
- **#7** — refactor-checkpoint covers transaction boundaries and pool routing; the 326 default-suite tests cover everything else.
- **#10 / #11** — doc work, not code. ADR 1: backend split decision (already in `decision-postgres-as-web-backend.md`). ADR 2: parallel maintainability (Electron + web). ADR 3: per-tenant schema prep. §bewertung lives in the IaC konzept and is updated when the choice it records changes.

## Out of scope for Phase 1

- Multi-user beyond `user_id NOT NULL DEFAULT 1` in the schema (single-user mode is Phase 1; multi-user is Stage 2).
- OIDC. Phase 1 is Argon2 password only; the `Credential` discriminated union (`{kind:'password'} | {kind:'token'}`) is in place so OIDC lands in Stage 2 without touching call sites.
- Postgres in production for the desktop app. Desktop stays SQLite; Postgres is the web track.
- Cross-OS web build matrix in CI. Phase 1 builds web on Linux only; macOS/Windows packaging matrix is desktop's concern.
- Renderer-side route refactors. The web track exposes the same domain logic over a different transport; the renderer is unchanged in Phase 1.

## Exit criteria — Phase 1 structural completion (status)

**Done (2026-05-04):**

```
make ci                               # ✅ 3561/3590 green, 0 expected-fail
VARLENS_WEB=1 make ci                 # ✅ 3582/3612 green, 1 expected-fail (user-id-schema sentinel)
VARLENS_RUN_WEB_GATE_PARITY=1 make web-gate-parity   # ✅ verified earlier in this PR
VARLENS_RUN_POSTGRES_E2E=1 make pg-up && \
  VARLENS_RUN_POSTGRES_E2E=1 make ci  # ✅ test exists; runs against the dev container
```

**Deferred to feature-PRs (each lands as user flow lands):**

The four `auth-scenarios.parity.test.ts` placeholders (login, lockout, multi-user isolation, session expiry) stay `describe.skip` until each scenario's web HTTP surface lands. Each flips skip → live in the same PR that implements its session/cookie/expiry handling. This is Phase 1 *ongoing*, not Phase 1 *blocker* — the structural prework is done; behavioral coverage is added per feature.

**Out of repo scope:**

`§bewertung1 / §bewertung3` (criterion #11) lives in the IaC repo and is updated by the Konzept author when the choices it records change.
