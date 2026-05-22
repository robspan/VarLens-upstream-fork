# `tests/web-gate/`

Phase 1 gate tests for the **web-migration** track. **Desktop is the default mode** of VarLens; web is an opt-in additional mode set up once by a developer/operator. These tests exist to validate the desktop↔web path and **do not run during default `make ci` or `npm run test`** — researcher and desktop-only contributors are insulated from them.

The intentional consequence: a researcher can ship a new IPC handler that imports `getDatabaseService` directly without their PR being blocked. The gate only fires when someone explicitly runs `make web-gate-*`. If the web track decides not to wrap a particular IPC for the web variant, that's accepted divergence — web ships with fewer features than desktop, by design.

If you DO see one of these tests failing (because you ran `make web-gate-static`), the failure message points at `.planning/web/completed/testing/desktop-to-web-parity.md` for context. The short version:

| Layer | What it pins | When it runs |
|---|---|---|
| **Layer 1 — Static** (`*.test.ts` at root) | Structural rules: no DB-factory leaks, no direct argon2 imports, every domain table has `user_id`, no Electron in `src/shared/`, etc. | `npm run test:web-gate` or `make web-gate-static`. **Not** part of default `npm run test`. |
| **Layer 2 — Integration** (`integration/`) | `/healthz`, JSON logs, SIGTERM, idempotent migrations against the Fastify server. | Same trigger as Layer 1. Tests that need a built web server and `VARLENS_PG_URL` skip in the fast/default lane; a future opt-in Postgres web lane should make those prerequisites fail-loud. |
| **Layer 3 — Parity** (`parity/`) | Structural parity sentinels plus behavioral scenarios as they are implemented. | `make web-gate-parity` only. Boots a real Electron app and switches the native-module ABI. |

## For desktop-only contributors (researchers, clinicians, default workflow)

**You should never have to think about this directory.** Default `make ci` and `npm run test` skip it entirely. Web-gate failures will not block your PR.

If you opt in (e.g. running `make web-gate-static` out of curiosity), two situations could surface:

1. **You added a new database table** → `user-id-schema.test.ts` flags it unless the table has `user_id INTEGER NOT NULL DEFAULT 1` or is listed in `EXEMPT_TABLES` (junction tables, KV-meta, reference data, virtual tables).
2. **You added a new IPC handler that imports `getDatabaseService` or `getDbPool`** → `db-seam.test.ts` flags it. The encouraged path is `StorageSession` injection, but it's not enforced for desktop.

Following these patterns benefits desktop too (cleaner abstractions, multi-user-ready schema), but they're guidance, not gates, for desktop-only PRs.

## For web-track contributors

The "expected fail" tests (`test.fails(...)`) are the visible web-track backlog. When your refactor PR makes the inner assertion pass, flip `test.fails()` -> `test()` in the same PR. One remains today:

- `user-id-schema.test.ts` — `EXPECTED_MISSING_USER_ID` is empty

The allowlists (`ALLOWLIST_LOOPHOLE_IMPORTERS` in `db-seam`, `EXPECTED_MISSING_USER_ID` in `user-id-schema`) are the **escape hatch for accepted divergence**. If desktop ships a feature that the web variant chooses not to mirror, the corresponding entry stays in the allowlist with a comment in the PR explaining why. The web variant runs with that feature absent.

## Running

```bash
npm run test:web-gate     # Layer 1 + Layer 2, fast
make web-gate-static      # same
make web-gate-integration # Layer 2 alone; Postgres-backed tests need out/web + VARLENS_PG_URL
make web-gate-parity      # Layer 3 — boots Electron, switches native ABI
make web-gate             # static + integration (parity is intentionally separate)
```

None of these run during `make ci` or default `npm run test`. They are a parallel CI lane the web-track contributor invokes explicitly.

Desktop remains the default path. Do not add Postgres, Docker, browser, or web-image prerequisites to default desktop CI. Web release/deploy validation should use an explicit web command that builds the web app, requires/provisions Postgres, and fails loudly if those prerequisites are absent.

`make web-gate-parity` rebuilds `better-sqlite3-multiple-ciphers` for the Electron ABI. After running it, you'll need `make rebuild-node` before running the regular Vitest suite again. This is the same dual-rebuild gotcha documented in `AGENTS.md`.

## See also

- `.planning/web/completed/testing/desktop-to-web-parity.md` — full plan + named-but-deferred scenarios
- External Concept Pilot planning — upstream Phase 1 contract
