# Current Findings

Date: 2026-05-12
Branch audited: `VarLens-Web` at `b71548de`
Remote: `origin/VarLens-Web`
Baseline: `upstream/main` at `3dbc9542`

## Current Verdict

Robspan's web track is substantial and current, but the repo does not yet prove full desktop-to-web behavioral equality.

What is real today:

- `src/web/server.ts` builds a Fastify web server.
- Web mode is Postgres-only and fail-loud without `VARLENS_PG_URL`.
- Login, secure-session cookies, must-change-password gating, and Postgres auth exist.
- The renderer can run through a web `window.api` HTTP shim.
- Fast structural gates exist under `tests/web-gate/`.
- `npm run build:web`, `make web-gate-static`, auth structural parity, and `make typecheck` passed locally.

What is not proven today:

- Full same-workflow equality between Electron IPC and web HTTP.
- VCF import plus filter parity through the web transport.
- Auth/session behavioral parity beyond structural assertions.
- A reliable opt-in `make web-gate-parity` lane for the current Postgres-only web server.

## Local Verification Run

Commands run during the audit:

```bash
git fetch --all --prune
npm run build:web
make web-gate-static
VARLENS_RUN_WEB_GATE_PARITY=1 npx vitest run --project web-gate-parity tests/web-gate/parity/auth-scenarios.parity.test.ts
make typecheck
```

Observed results:

- Branch was current with `origin/VarLens-Web`.
- Branch is 165 commits ahead of `upstream/main`, 0 behind.
- `npm run build:web` passed.
- `make web-gate-static` passed: 48 passed, 1 expected fail, 17 skipped.
- Auth structural parity file passed: 10 passed, 2 skipped.
- `make typecheck` passed.
- `make web-gate-parity` could not be completed in the sandbox because `npm run rebuild:electron` needs to write Electron headers under `~/.electron-gyp`.

## Main Findings

### F1. Parity Tests Are Mostly Structural

`tests/web-gate/parity/auth-scenarios.parity.test.ts` checks shared types, constants, method surface, and selected source sentinels. It does not boot both transports, perform login, verify cookie/session semantics, or compare observable responses.

### F2. Import/Filter Web Parity Is A Placeholder

`tests/web-gate/parity/import-and-filter.test.ts` claims VCF import plus filter parity, but the web half only asserts the Electron snapshot exists. It does not import a VCF through web mode and does not query variants through the web HTTP dispatcher.

### F3. Current Parity Route Shape Is Stale

The parity test still calls `GET /api/cases`. The current dispatcher exposes `POST /api/:domain/:method` with body `{ args: [...] }`, and `/api/*` is protected except public auth methods.

### F4. Web Parity Needs Current Web Prerequisites

Any parity test that imports `buildApp()` now needs a valid `VARLENS_PG_URL`, migrations, session-secret directory, and usually admin bootstrap data.

### F5. Import Is Not Exposed In Web

`src/web/server/task-types.ts` lists many read/write task types, but not `import:start`, `import:startMultiFile`, `import:vcfPreview`, or related import functions.

### F6. Web Events Are Stubbed

`src/web/client/api.ts` turns `window.api.<domain>.on*(...)` into no-op unsubscribe functions. That prevents crashes, but it means Electron event behavior is not mirrored.

### F7. Docs And Plans Are Stale

Several docs still describe Stage 1 web as SQLite-default, mention old expected-fail counts, or say sessions are absent even though web secure-session exists.

### F8. Opt-In Web Integration Needs A Fail-Loud Postgres Lane

`make web-gate-static` skipping Postgres-backed tests is correct for default desktop isolation and fast structural checks. The gap is that the web track needs a separate opt-in command whose purpose is to run Postgres-backed behavior and fail if prerequisites are absent.

### F9. Browser Build Warnings Need Follow-Up

`npm run build:web` passes, but emits Node-core externalization warnings via `h264-mp4-encoder` and large chunk warnings for Molstar/viewer and Plotly assets.
