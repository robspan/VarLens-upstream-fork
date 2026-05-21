# Implementation Status

Date: 2026-05-12

Status: completed cleanup pass; deferred product/release work is split into `../../backlog/`.

This file tracks the cleanup pass after the initial audit. The desktop-default contract still applies: web requirements belong only under `VARLENS_WEB=1`, explicit `make web-*` targets, or web release/deploy workflows.

## Completed In This Pass

- Web RPC client now rejects non-2xx HTTP responses instead of treating error JSON as successful renderer data.
- Dispatcher has explicit adapters for `variants.query`, `variants.getFilterOptions`, supported cohort read methods, `database.info`, `database.recentList`, and `auth.isAccountsEnabled`.
- Web auth management endpoints exist for create/list/deactivate/reset with admin checks and self-deactivation protection.
- Web sessions revalidate the live DB user on protected API requests, so deactivation or password reset invalidates stale cookies.
- Postgres-backed behavioral tests now prove stale sessions are rejected after user deactivation and password reset.
- Web API POSTs reject mismatched browser `Origin` values before reaching public or authenticated RPC handlers.
- A shared authenticated web test driver boots `buildApp()`, logs in, rotates the bootstrap password, calls RPC endpoints, and tears down an isolated Postgres schema.
- Web single-file import exists as gated server-local path mode for tests/operators: `NODE_ENV=test` or `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT=1`.
- Import/filter parity now has a real web HTTP path when the web build, Electron build, and `VARLENS_PG_URL` are present.
- Renderer database picker and import entry points are gated in web mode so desktop file/workspace actions do not leak into the browser UI.
- Web capabilities now hide browser-incompatible export features, and direct export calls fail with explicit `unsupported-web-capability` responses instead of leaking storage row streams.
- Web cohort status has a stable Postgres response, while rebuild and association actions fail explicitly as unsupported web capabilities.
- Import progress is bridged over server-sent events for `window.api.import.onProgress`.
- `make web-ci` and `make web-gate-postgres` provide explicit Postgres-backed web gates; default `make ci` is unchanged.
- operator environment files no longer auto-enable `VARLENS_WEB`; web mode requires explicit `VARLENS_WEB=1` or a direct `make web-*` target.
- Root `.github/workflows/web-ci.yml` runs the opt-in web gate on web-relevant paths.
- Compose now passes `VARLENS_ADMIN_PASSWORD_HASH` through to the app container.
- `publish-web.yml` runs `make web-ci` before building and publishing a web image.

## Still Open

No current-lane cleanup items remain in this folder.

Deferred work:

- Browser-native upload/download support is tracked in `../../backlog/web-browser-upload-and-downloads.md`.
- Built-image + Postgres smoke before image publication is tracked in `../../backlog/web-built-image-postgres-smoke.md`.
- Full browser gene-burden association support is tracked in `../../backlog/web-cohort-association-support.md`.

## Verification In This Pass

Passed locally:

```bash
npx vitest run --project web-gate tests/web-gate/web-client-api.test.ts tests/web-gate/dispatcher-adapters.test.ts
npx vitest run --project web-gate tests/web-gate/dispatcher-adapters.test.ts tests/web-gate/web-client-api.test.ts tests/web-gate/integration/session-revalidation.test.ts
VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev npx vitest run --project web-gate tests/web-gate/integration/session-revalidation.test.ts tests/web-gate/dispatcher-adapters.test.ts
npx vitest run --project web-gate tests/web-gate/auth-origin.test.ts
npx vitest run --project web-gate tests/web-gate/web-ci-target.test.ts
npx vitest run --project renderer tests/renderer/components/DatabasePicker.test.ts
make ci
make web-gate-static
make typecheck
npm run build:web
npx vitest run --project web-gate-parity tests/web-gate/parity/auth-scenarios.parity.test.ts tests/web-gate/parity/import-and-filter.test.ts
VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev VARLENS_PG_SCHEMA=public VARLENS_RECOVERY_KEY_DIR=/tmp/varlens-web-ci-secrets make web-ci
```
