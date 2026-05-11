# Implementation Status

Date: 2026-05-12

This file tracks the cleanup pass after the initial audit. The desktop-default contract still applies: web requirements belong only under `VARLENS_WEB=1`, explicit `make web-*` targets, or web release/deploy workflows.

## Completed In This Pass

- Web RPC client now rejects non-2xx HTTP responses instead of treating error JSON as successful renderer data.
- Dispatcher has explicit adapters for `variants.query`, `variants.getFilterOptions`, supported cohort read methods, `database.info`, `database.recentList`, and `auth.isAccountsEnabled`.
- Web auth management endpoints exist for create/list/deactivate/reset with admin checks and self-deactivation protection.
- Web sessions revalidate the live DB user on protected API requests, so deactivation or password reset invalidates stale cookies.
- Web API POSTs reject mismatched browser `Origin` values before reaching public or authenticated RPC handlers.
- A shared authenticated web test driver boots `buildApp()`, logs in, rotates the bootstrap password, calls RPC endpoints, and tears down an isolated Postgres schema.
- Web single-file import exists as gated server-local path mode for tests/operators: `NODE_ENV=test` or `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT=1`.
- Import/filter parity now has a real web HTTP path when the web build, Electron build, and `VARLENS_PG_URL` are present.
- Renderer database picker and import entry points are gated in web mode so desktop file/workspace actions do not leak into the browser UI.
- Import progress is bridged over server-sent events for `window.api.import.onProgress`.
- `make web-ci` and `make web-gate-postgres` provide explicit Postgres-backed web gates; default `make ci` is unchanged.
- `web-deploy/.env` no longer auto-enables `VARLENS_WEB`; web mode requires explicit `VARLENS_WEB=1` or a direct `make web-*` target.
- Root `.github/workflows/web-ci.yml` runs the opt-in web gate on web-relevant paths.
- Compose now passes `VARLENS_ADMIN_PASSWORD_HASH` through to the app container.
- `publish-web.yml` and build-path `release-web.yml` run `make web-ci` before building and publishing a web image.

## Still Open

- Add support for cohort status/rebuild/association methods in web mode or gate those UI paths; the basic cohort read methods now have explicit adapters.
- Add behavioral tests for stale sessions after deactivate/reset password, not only route-level/session-code coverage.
- Decide and gate export, updater/log stream, native folder actions, and enrichment/reference workflows in web mode.
- Replace server-local import with a browser upload/staging contract before claiming end-user web import support.
- Add built-image + Postgres smoke before push/deploy.

## Verification In This Pass

Passed locally:

```bash
npx vitest run --project web-gate tests/web-gate/web-client-api.test.ts tests/web-gate/dispatcher-adapters.test.ts
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
