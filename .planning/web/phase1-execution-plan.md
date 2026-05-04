# Phase 1 execution plan

Status: live (2026-05-04)
Branch: `VarLens-Web`
Source: `VarLens-IaC/.internalplanning/konzept/app.html` §app2.1 (canonical criteria)
Companion: [`testing/`](testing/) (test vehicles), [`decision-postgres-as-web-backend.md`](decision-postgres-as-web-backend.md) (backend choice)

The 12 §app2.1 criteria, mapped to: blocking dependencies · test vehicle · current status. **No criterion text restated** — read the konzept for the spec.

## Order of work

The big unblockers, in order:

1. **Web build target** (`src/web/server.ts` → `out/web/server.cjs`). Activates 4 integration tests (#1, #3, #8, #9) and the web halves of parity scenarios (#5). Single highest-leverage move.
2. **StorageSession refactor** (close `getDatabaseService` / `getDbPool` loopholes). Flips `db-seam` red → green and unblocks renderer-side use of either backend. Also flips two refactor-checkpoint snapshots — drift expected and reviewed in the same PR.
3. **Auth abstraction** (provider interface in `src/main/auth/providers/`, Argon2 migrated behind it). Flips `auth-isolation` red → green and unblocks the 4 auth parity placeholders.

After (3), parity scenarios are TDD work — each PR adds the scenario for the user-facing flow it implements.

## Status table

| # | Criterion (short) | Blocked by | Test vehicle | Status |
|---|---|---|---|---|
| 1 | Web container starts w/o Electron deps | Web build | `electron-leak` + `integration/healthz` | Test exists; awaits build |
| 2 | Migrations idempotent | — | `integration/migrations-idempotent` (SQLite) + `postgres-migrations-idempotent` (real PG, gated) | ✅ both backends |
| 3 | `/healthz` 200 / 503 | Web build | `integration/healthz` (both paths) | Test exists; awaits build |
| 4 | Argon2 login + multi-user | Auth abstraction | `parity/auth-scenarios.parity.test.ts` (4 placeholders) | Skipped, awaits provider |
| 5 | Import / filter / analysis preserved | Web build (for web half) | `parity/import-and-filter` (Electron green; web skipped) | ✅ Electron pinned |
| 6 | Services use repository iface only | StorageSession refactor | `db-seam` | Red on day one — that's the work |
| 7 | Electron variant builds w/o regression | — | `make ci-full` + `tests/refactor-checkpoint/` | ✅ |
| 8 | Logs JSON to stdout | Web build | `integration/json-logs` | Test exists; awaits build |
| 9 | SIGTERM clean shutdown | Web build | `integration/sigterm` | Test exists; awaits build |
| 10 | ADRs 1, 2, 3 filed | — | Doc gate | ✅ `.planning/adr/0001..0003` |
| 11 | §bewertung1 / §bewertung3 current | IaC repo work | Doc gate | Tracked in IaC |
| 12 | Bridge-clause structural | StorageSession refactor (partial) | `db-seam` + `auth-isolation` + `user-id-schema` + `handler-seam` | Partial — gates exist, several red until #2/#3 |

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

## Exit criteria

Phase 1 is done when, on a clean clone:

```
make ci                               # green
VARLENS_WEB=1 make ci                 # green
VARLENS_RUN_WEB_GATE_PARITY=1 make web-gate-parity   # green
VARLENS_RUN_POSTGRES_E2E=1 make pg-up && \
  VARLENS_RUN_POSTGRES_E2E=1 make ci  # green
```

Plus all four `auth-scenarios.parity.test.ts` placeholders flipped to live and passing on both transports.
