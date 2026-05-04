# Phase 1 Gate Test Suite — desktop → web parity

Status: live (2026-05-04)
Branch target: `VarLens-Web`
Source plan: `VarLens-IaC/.internalplanning/konzept/app.html` §app2.1
Companion: [`desktop-preservation.md`](desktop-preservation.md) · [`README.md`](README.md)

Adds an executable gate for the 12 §app2.1 criteria under `tests/web-gate/`. Opt-in (`make web-gate-*`); excluded from default `make ci`.

## Layer 1 — Static gates

| File | Mechanism | Pins |
|---|---|---|
| `db-seam.test.ts` | ts-morph | No `getDatabaseService` / `getDbPool` outside `src/main/storage/session.ts`. Allowlisted; `// gate-allow: db-seam — reason` escape hatch. **Red on day one — the work backlog.** |
| `auth-isolation.test.ts` | ts-morph | No `argon2` / `bcrypt` / `jsonwebtoken` outside `src/main/auth/providers/**`. |
| `user-id-schema.test.ts` | `PRAGMA table_info` | Every domain table has `user_id NOT NULL DEFAULT 1`. Allowlist for shared/junction tables. |
| `electron-leak.test.ts` | grep | No `electron` / `BrowserWindow` / `ipcRenderer` in `src/shared/` (and `src/web/` once it exists). |
| `audit-shape.test.ts` | column subset | `audit_log` columns ⊆ `{id, ts, user_id, action, entity, entity_id, pre_state, post_state, ip, user_agent}`. |
| `handler-seam.test.ts` | ts-morph + path | Every domain in `src/shared/ipc/domains/` has a matching main handler. Once `src/web/` exists, also asserts every Fastify route imports the same handler function. |

## Layer 2 — Web integration (skipped until `out/web/server.cjs` exists)

| File | Mechanism |
|---|---|
| `integration/healthz.test.ts` | `fastify.inject` GET /healthz; 200 + `{status, version, db}` |
| `integration/migrations-idempotent.test.ts` | Boot twice on tmp file; byte-compare `sqlite_master` + `PRAGMA user_version` |
| `integration/json-logs.test.ts` | Capture stdout; every line parses as JSON with `level` / `time` / `msg` |
| `integration/sigterm.test.ts` | `child_process.fork()`, in-flight request, SIGTERM → exit 0 ≤5s, in-flight 200. **Flake-prone — isolated.** |

## Layer 3 — Parity scenarios

Live: `parity/import-and-filter.test.ts`. One scenario, both transports inlined, no `BackendDriver` until rule-of-three triggers it.

Deferred (named, not built):

| File | Why it can't be skipped long-term |
|---|---|
| `parity/read-concurrency.parity.test.ts` | Pool-vs-HTTP-concurrency invariant. **Moot for web** since Postgres is the production backend (see `../decision-postgres-as-web-backend.md`); keep desktop-only or drop. |
| `parity/export-roundtrip.parity.test.ts` | Streamed bytes vs JSON; most likely Phase 1 silent break. |

## Bridge-clause type bets — do now

1. `Credential = {kind:'password', ...} | {kind:'token', jwt:string}` from day one. Phase 1 implements `password`; `token` throws `NotImplemented`. OIDC lands without touching call sites.
2. ULID vs INTEGER PK — needs ADR before scenario #1 lands. Rowid IDs leak creation order (§203 side-channel) and break under federation. Switch is trivial today, painful after Stage 2.

## Anti-patterns

- No retries on parity flakes. Quarantine, fix root cause, promote back.
- No `if (driver.kind === ...)` branches inside scenarios.
- No snapshot-update + normalization-change in the same PR.
- No coverage gating in this suite.
- No shared parity fixtures with E2E.

## §app2.1 coverage map

| Criterion | Test |
|---|---|
| Web container starts without Electron deps | `electron-leak` + `integration/healthz` |
| Migrations idempotent | `integration/migrations-idempotent` |
| `/healthz` returns 200 / 503 correctly | `integration/healthz` (both paths) |
| Argon2 login + multi-user | Layer 3 expansion (deferred — first auth scenario after import-and-filter green on web) |
| Import/filter/analysis preserved | `parity/import-and-filter` |
| Services use repository interface only | `db-seam` |
| Electron variant builds without regression | `make ci-full` + `tests/refactor-checkpoint/` (see `desktop-preservation.md`) |
| Logs JSON to stdout | `integration/json-logs` |
| SIGTERM clean shutdown | `integration/sigterm` |
| ADRs 1, 2, 3 filed | Doc gate |
| §bewertung1 / §bewertung3 | Doc gate, IaC repo |
| Bridge-clause structural check | `db-seam` + `auth-isolation` + `user-id-schema` + `handler-seam` |

## Open questions

- **ULID vs INTEGER PK** — ADR before scenario #1 lands.
- **Auth provider interface** — `auth-isolation` red until shape lands. Sequence: provider interface → migrate Argon2 → green → first auth parity scenario.
- **Progress events** — Electron uses IPC events; web uses WS/SSE. Recommendation: parity-asserted on payload sequence once `BackendDriver` exists. ADR before `read-concurrency` (or before retiring it as web-moot).
