# Implementation Work Packages

These packages are ordered by dependency. Keep default desktop CI untouched unless a package explicitly targets an opt-in web lane.

## WP1 - Truthful Test Naming And Skip Hygiene

Owner: `tests/web-gate`  
Depends on: audit checklist Steps 1-2  
Status: completed in the first implementation pass  
Outcome: no placeholder looks like parity.

Tasks:

- Make structural auth tests read as structural.
- Update stale comments and web-gate README language.
- Document skips as default isolation, missing prerequisite, or missing behavior.

## WP2 - Web RPC Contract And Adapter Layer

Owner: `src/web/client`, `src/web/server`  
Depends on: WP1  
Status: mostly complete for the first target set; variants, cohort reads, database startup, auth startup, and import error behavior are covered. Cohort status/rebuild/association are still separate follow-ups because they do not map to `StorageSession` read tasks yet.  
Outcome: web RPC errors fail loudly and first target methods use explicit adapters instead of raw storage autoroute.

Initial methods:

- `variants.query`
- `variants.getFilterOptions`
- `cohort.getVariants`
- `cohort.getSummary`
- `database.info`
- `database.recentList`
- `auth.isAccountsEnabled`

Tasks:

- Make non-2xx web responses fail in renderer-compatible shape.
- Add adapter tests for renderer/preload args vs storage params.
- Stop treating unsupported methods as successful data.

## WP3 - Web Behavioral Test Driver

Owner: `tests/web-gate/helpers`  
Depends on: WP2  
Status: completed for authenticated Postgres-backed HTTP RPC tests  
Outcome: all web behavioral tests use the same authenticated Postgres-backed helper.

Tasks:

- Isolate `VARLENS_RECOVERY_KEY_DIR`.
- Set `NODE_ENV=test`.
- Require/provision `VARLENS_PG_URL` only in opt-in web lane.
- Bootstrap admin.
- Log in and preserve cookies.
- Provide `api(domain, method, ...args)`.
- Close app/session pools cleanly.

## WP4 - Single-File Web Import

Owner: `src/web`, import logic  
Depends on: WP3  
Status: implemented as gated server-local path mode for tests/operators; browser upload remains open  
Outcome: web can import one VCF without Electron file dialogs.

Tasks:

- Choose browser upload or server-local test/operator path mode.
- Reuse shared import logic/storage executor.
- Return renderer-compatible import result shape.
- Add invalid input and successful VCF tests.

## WP5 - Import/Filter Parity

Owner: `tests/web-gate/parity`  
Depends on: WP4  
Status: implemented as an opt-in parity path when Electron build, web build, and `VARLENS_PG_URL` are present  
Outcome: first real desktop-web workflow equality proof.

Tasks:

- Authenticate web driver.
- Import `tests/test-data/vcf/synthetic-unit-test.vcf`.
- Run the same three variant queries as Electron.
- Normalize and compare outputs.

## WP6 - Auth Behavioral Parity And Session Hardening

Owner: `src/web/auth`, `src/web/server`, auth tests  
Depends on: WP3  
Status: partially complete; auth management routes, service-backed accounts flag, session revalidation, and API Origin checks are implemented. Stale-session behavioral tests remain.  
Outcome: auth/session claims are tested as behavior and stale sessions cannot outlive auth-state changes unintentionally.

Tasks:

- Route auth-management endpoints with desktop-equivalent role checks.
- Route `auth:isAccountsEnabled` through the service.
- Revalidate session users server-side.
- Add tests for stale session after deactivate/reset.
- Add Origin/CSRF protection for state-changing `/api/*`.
- Harden session-secret validation and file permissions.

## WP7 - Renderer Capability Gating

Owner: `src/renderer`, `src/web/client`  
Depends on: WP2  
Status: partially complete; database picker and import entry points are gated in web mode. Export/updater/log/native-folder/enrichment inventory remains.  
Outcome: desktop-only workflows are hidden, replaced, or documented in web mode.

Tasks:

- Gate desktop database picker/actions.
- Gate import/export features until web semantics exist.
- Gate updater/log stream/native folder actions.
- Inventory enrichment/reference workflows and decide support vs accepted divergence.

## WP8 - Event Transport

Owner: `src/web/client`, `src/web/server`  
Depends on: WP4/WP5  
Status: partially complete; import progress is bridged over SSE for `import:onProgress`. Other event sources remain no-op or accepted divergence.  
Outcome: import progress is not silently dropped in web mode.

Tasks:

- Choose SSE or WebSocket.
- Implement import progress first.
- Add payload-sequence parity only after base import/filter parity is green.

## WP9 - Opt-In Web CI Command And Root Workflow

Owner: `Makefile`, `package.json`, root workflows  
Depends on: WP3 and at least one behavioral parity test  
Status: implemented as `make web-ci`, `make web-gate-postgres`, root `.github/workflows/web-ci.yml`, and publish/release workflow gates before web image build.  
Outcome: web track has a single honest gate without changing desktop defaults.

Tasks:

- Add `make web-ci` or `make web-gate-postgres`.
- Add root web workflow on web paths.
- Include `Dockerfile`, `vite.web*.config.ts`, `src/web/**`, `tests/web-gate/**`, `web-deploy/**`, and `*web*.yml` paths.
- Require web CI before publish/deploy.
- Keep root desktop build/test workflows desktop-focused unless `VARLENS_WEB=1` or a web workflow is explicitly selected.

## WP10 - Deploy Security/Wiring Cleanup

Owner: `Dockerfile`, `web-deploy`, `DEPLOY.md`  
Depends on: WP9 decisions  
Status: partially complete; compose now passes `VARLENS_ADMIN_PASSWORD_HASH`, and web publish/release builds depend on `make web-ci`. Built-image smoke remains open.  
Outcome: release/deploy path passes the same security env and smoke checks as local web CI.

Tasks:

- Pass `VARLENS_ADMIN_PASSWORD_HASH` through compose.
- Remove stale recovery-key references.
- Add built-image + Postgres smoke before push/deploy.
- Move/adapt nested `web-deploy/.github/workflows/ci.yml` checks into root workflows.

## WP11 - Documentation Current-State Cleanup

Owner: `.planning`, deploy docs, web-gate docs  
Depends on: WP1 decisions  
Status: in progress  
Outcome: docs match the branch's actual implementation.

Tasks:

- Update `tests/web-gate/README.md`.
- Add/refresh current-state web index.
- Mark SQLite-first concept docs historical where they no longer match implementation.
- Keep historical QA reports historical rather than rewriting them as current.
