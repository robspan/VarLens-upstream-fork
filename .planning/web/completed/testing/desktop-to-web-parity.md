# Phase 1 Gate Test Suite — desktop → web parity

Status: implemented web-gate strategy (2026-05-12)
Branch target: `VarLens-Web`
Source: external Concept Pilot planning
Companion: [`desktop-preservation.md`](desktop-preservation.md) · [`README.md`](README.md)

Adds an executable gate for the 12 §app2.1 criteria under `tests/web-gate/`. Opt-in (`make web-gate-*`); excluded from default `make ci`.

## Layer 1 — Static gates

| File | Mechanism | Pins |
|---|---|---|
| `db-seam.test.ts` | ts-morph | No `getDatabaseService` / `getDbPool` outside `src/main/storage/session.ts`. Allowlisted; `// gate-allow: db-seam — reason` escape hatch. |
| `auth-isolation.test.ts` | ts-morph | No `argon2` / `bcrypt` / `jsonwebtoken` outside `src/main/auth/providers/**`. |
| `user-id-schema.test.ts` | `PRAGMA table_info` | Every domain table has `user_id NOT NULL DEFAULT 1`. Allowlist for shared/junction tables. |
| `electron-leak.test.ts` | grep | No `electron` / `BrowserWindow` / `ipcRenderer` in `src/shared/` (and `src/web/` once it exists). |
| `audit-shape.test.ts` | column subset | `audit_log` columns ⊆ `{id, ts, user_id, action, entity, entity_id, pre_state, post_state, ip, user_agent}`. |
| `handler-seam.test.ts` | ts-morph + path | Every domain in `src/shared/ipc/domains/` has a matching main handler. Once `src/web/` exists, also asserts every Fastify route imports the same handler function. |

## Layer 2 — Web Integration

| File | Mechanism |
|---|---|
| `integration/healthz.test.ts` | `fastify.inject` GET /healthz; 200 + `{status, version, db}` |
| `integration/migrations-idempotent.test.ts` | Boot Postgres-backed web integration twice and verify migration idempotency. |
| `integration/json-logs.test.ts` | Capture stdout; every line parses as JSON with `level` / `time` / `msg` |
| `integration/sigterm.test.ts` | `child_process.fork()`, in-flight request, SIGTERM → exit 0 ≤5s, in-flight 200. **Flake-prone — isolated.** |

## Layer 3 — Parity scenarios

Live:

- `parity/import-and-filter.test.ts`
- `parity/data-manifest-parity.test.ts`

Deferred expansions are tracked in `../../backlog/testing-followups.md`.

## Bridge-clause Decisions

1. `Credential = {kind:'password', ...} | {kind:'token', jwt:string}` exists. Phase 1 implements `password`; OIDC/token work remains Stage 3.
2. Per-tenant schema preparation is recorded in `../../context/decisions/adr/0003-per-tenant-schema-prep.md`.

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
| Argon2 login + multi-user | `parity/auth-scenarios.parity.test.ts` plus backlog expansions |
| Import/filter/analysis preserved | `parity/import-and-filter` |
| Services use repository interface only | `db-seam` |
| Electron variant builds without regression | `make ci-full` + `tests/refactor-checkpoint/` (see `desktop-preservation.md`) |
| Logs JSON to stdout | `integration/json-logs` |
| SIGTERM clean shutdown | `integration/sigterm` |
| ADRs 1, 2, 3 filed | Doc gate |
| §assessment1 / §assessment3 | Doc gate, IaC repo |
| Bridge-clause structural check | `db-seam` + `auth-isolation` + `user-id-schema` + `handler-seam` |

Remaining scenario expansions are not part of this completed test-strategy record; they live in `../../backlog/testing-followups.md`.
