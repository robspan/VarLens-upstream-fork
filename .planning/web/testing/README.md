# VarLens-Web testing strategy

Status: living index (2026-05-04)
Branch: `VarLens-Web`

This folder holds the test design for the VarLens web build. The work has **two distinct purposes** that are easy to conflate but must be planned separately. Tests built for one purpose do not necessarily serve the other.

## The two purposes

### 1. Desktop → web parity ("does the web variant behave like the desktop variant?")

The web build must reproduce desktop behavior on every observable surface that matters: import semantics, filter results, export format, auth model. Where transports differ (HTTP/WebSocket vs. Electron IPC), the *observable sequence* must match.

Tests for this purpose live in **`desktop-to-web-parity.md`** (Phase 1 gate suite). This is the original web-gate suite under `tests/web-gate/`, designed to make Phase 1 falsifiable: layered static gates, integration gates, and parity scenarios. Many of its layer-1 tests are intentionally red on day one — they surface the refactor backlog as concrete work items.

The companion document **`desktop-to-web-parity-perspectives.md`** records the agent perspectives that informed the parity-suite design, kept verbatim for traceability.

### 2. Desktop → desktop sameness ("does the refactor break desktop?")

Extracting code into a `StorageSession`-injected, web-shareable shape is a non-trivial refactor of the desktop app. The IPC contract stays stable, the visible behavior stays stable, but **internal behavior** (transaction scope, worker-pool routing, error propagation, lock timing) can drift silently — and the existing 290 tests are not designed to detect that drift.

Tests for this purpose live in **`desktop-preservation.md`** (refactor checkpoint layer). Snapshot-based structural pins for the dimensions where the refactor is most likely to cause silent regressions.

## Why this split matters

The two purposes have **different failure modes** and therefore need **different test mechanics**:

| Aspect | Desktop → web parity | Desktop → desktop sameness |
|---|---|---|
| What's pinned | Behavioral equivalence across two backends | Structural facts about a single backend's current implementation |
| Mechanism | Run the same scenario on both, compare normalized outputs | ts-morph snapshot of code structure (transaction calls, pool routing, etc.) |
| Test posture | Many start red; pass as web work progresses | All start green; fail when refactor drifts unexpectedly |
| Run frequency | Web track only (`make web-gate-*`, opt-in) | Default `make test` — desktop is the default mode |
| Lifetime | Until web parity is comprehensive (Stage 2+) | Until the StorageSession refactor is done; then largely deletable |

Conflating them produces tests that satisfy neither — e.g., a "parity" test that only ever runs on Electron, or a "regression" test whose snapshot updates so freely it loses signal.

## Inventory of tests by purpose

### Desktop → web parity (`tests/web-gate/`, opt-in)

11 tests across 3 layers:

- **Layer 1 (static, 6 tests):** `db-seam`, `auth-isolation`, `user-id-schema`, `electron-leak`, `audit-shape`, `handler-seam`
- **Layer 2 (integration, 4 tests):** `healthz`, `migrations-idempotent`, `json-logs`, `sigterm` — all wrapped in `skipIf(!existsSync('out/web/server.cjs'))`
- **Layer 3 (parity, 1 test + 2 deferred):** `import-and-filter` (live), `read-concurrency` and `export-roundtrip` (named, deferred per rule-of-three)

Run via `make web-gate`, `make web-gate-static`, etc. Excluded from default `make ci` so desktop contributors are not blocked by failing web-gate tests.

### Desktop → desktop sameness (`tests/refactor-checkpoint/`, default `make test`)

Planned in `desktop-preservation.md`. Two tests at v1:

- `transaction-boundaries` — snapshot of every `db.transaction(...)` call site
- `pool-vs-main-routing` — snapshot of which IPC handlers route reads through `dbPoolManager` (Piscina) vs. main thread

A third test (`handler-storage-callgraph`) is a candidate extension if the first two prove insufficient.

## Open questions tracked across this folder

- **Postgres parity.** The decision in `../decision-postgres-as-web-backend.md` selects Postgres as the web backend. Tests under `desktop-to-web-parity.md` § Layer 3 must run against Postgres for the web track. The `read-concurrency.parity.test.ts` deferred scenario is moot for web (Postgres is async) but may stay as desktop-only regression coverage.
- **Auth parity.** Layer 3 placeholder, blocked on the auth-isolation refactor reaching done. Tracked in `desktop-to-web-parity.md`.
- **Refactor-checkpoint lifetime.** When the StorageSession extraction is fully done, the `pool-vs-main-routing` test in particular has limited remaining value — flagged for review at that milestone.

## Where this folder fits

- `../decision-postgres-as-web-backend.md` — backend choice (input to all parity tests).
- `desktop-to-web-parity.md` + `desktop-to-web-parity-perspectives.md` — Purpose 1.
- `desktop-preservation.md` — Purpose 2.
- `../../handover/README.md` — what survives the transfer to Labor Berlin (these decision and test-plan docs travel with the repo; fork-specific overrides do not).
