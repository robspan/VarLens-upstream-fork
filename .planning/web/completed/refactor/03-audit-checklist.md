# Audit Checklist

Use this checklist when re-auditing web equality work. Keep default desktop isolation in mind: web prerequisites belong in opt-in web lanes only.

## Step 0 - Freeze The Baseline

Record:

- branch name and commit
- upstream merge-base
- `git status --short --branch`
- Node/npm versions
- whether `out/main/index.js` and `out/web/server.cjs` exist

Deliverable: one line with the exact baseline.

## Step 1 - Build And Fast Gates

Run:

```bash
npm run build:web
make web-gate-static
make typecheck
```

Record:

- pass/fail
- skipped test count
- expected-fail count
- warnings that imply browser runtime risk

Deliverable: a "fast gates are green but not sufficient because..." note.

## Step 2 - Skip And Placeholder Inventory

Inspect:

```bash
rg -n "skipIf|test\\.skip|describe\\.skip|test\\.fails|expected-fail|HAS_PG|VARLENS_RUN_WEB_GATE_PARITY" tests/web-gate Makefile vitest.config.ts
```

Classify each skip:

- correct desktop isolation
- missing Postgres prerequisite
- stale/obsolete
- placeholder for missing behavior
- acceptable in default/fast lane but fail-loud in web CI

Deliverable: skip inventory table with owner workstream and required action.

## Step 3 - API Surface Matrix

Build a matrix from:

- `src/shared/types/api.ts`
- `src/preload/domains/**`
- `src/main/ipc/**`
- `src/web/server/dispatcher.ts`
- `src/web/server/task-types.ts`
- `src/web/client/api.ts`

Columns:

- API method
- renderer caller
- Electron support
- web support
- web response shape
- file/event/native dependency
- test coverage
- action

Required first entries:

| Area | Known issue | Required action |
|---|---|---|
| RPC errors | non-2xx parsed as data | make `httpInvoke` throw on `!res.ok` or normalize errors to `SerializableError` |
| variants | renderer/preload args do not match storage params | add web adapter using desktop validation/filter-building semantics |
| cohort | renderer method names do not match storage task names | add explicit method map/adapters |
| auth management | service methods exist but HTTP routes missing | add admin-checked overrides matching desktop `auth-logic.ts` |
| database | desktop picker calls unsupported web methods | hide/gate picker or add safe web overrides |
| import | no web execution surface | design upload/staging/server-path contract and implement one-file VCF first |
| export | storage stream is not browser download | replace autoroute with download endpoints |

## Step 4 - Web Driver For Behavioral Tests

Before adding more parity assertions, add a reusable test driver:

- isolated `VARLENS_RECOVERY_KEY_DIR`
- explicit `NODE_ENV=test`
- Postgres URL prerequisite/provisioning
- admin bootstrap
- login helper preserving cookies
- `api(domain, method, ...args)` helper that calls `POST /api/:domain/:method`
- cleanup that closes Fastify and storage pools

The driver must assert error semantics:

- unauthenticated protected RPC returns a thrown/failed client result
- unknown method does not become successful renderer data
- must-change-password 403 is visible as an error

## Step 5 - Repair Existing Parity Tests

Do this before implementation work so failures expose missing behavior honestly:

- Replace stale `GET /api/cases` with authenticated `POST /api/cases/list`.
- Rename structural auth tests or move them out of behavioral parity naming.
- Keep web import/filter skipped with a precise missing-implementation reason until the web import surface exists.
- Add a failing or skipped sentinel for the RPC adapter gap, with `variants.query` as the first target.

## Step 6 - Fix Web RPC Error Contract

Required behavior:

- `httpInvoke()` rejects non-2xx responses, or
- every non-2xx dispatcher response uses the same `IpcResult`/`SerializableError` contract expected by renderer edge code.

Minimum tests:

- unauthenticated protected call
- unknown method
- must-change-password blocked call
- validation error from a routed method

## Step 7 - Implement Single-File VCF Web Import

Design decision first:

- browser upload route, or
- server-local path route gated to test/operator mode

Minimum behavior:

- validate file input
- call shared import logic/storage executor
- create a case
- return the same import result shape the renderer expects
- no Electron file dialog dependency

## Step 8 - Add Web Adapters For First Parity Workflow

Minimum adapters:

- `cases.list`
- `variants.query`
- `variants.getFilterOptions` if the import UI or workflow needs it
- `database.capabilities`, `database.health`, and safe `database.info`/`recentList` behavior for web startup

Rules:

- Do not pass renderer args directly into storage tasks unless the shapes are proven identical.
- Reuse existing shared handler logic where available.
- Add adapter tests that compare the task/params built by web and desktop logic.

## Step 9 - Turn Import/Filter Into Real Equality

Use the web driver to:

- authenticate
- import the fixture
- run unfiltered, chr22, and HIGH-impact variant queries
- normalize the same snapshot shape as Electron
- compare outputs

## Step 10 - Add Behavioral Auth Parity

Add tests for:

- login success
- invalid credentials
- lockout
- admin bootstrap with hash
- must-change-password gate
- password rotation clears the gate
- logout clears session
- deactivated user behavior
- password reset invalidates old sessions, if selected
- admin-only create/list/deactivate/reset user routes
- self-deactivation is rejected
- `auth:isAccountsEnabled` reflects real service state

Security hardening to plan:

- revalidate session user by id on authenticated requests
- enforce `is_active`
- include `password_changed_at` or session-version freshness checks
- add Origin/CSRF protection for state-changing `/api/*` calls
- harden `VARLENS_SESSION_SECRET_HEX` and session-secret file permissions

## Step 11 - Events And Progress

Priority:

1. `import.onProgress`
2. `batchImport.onProgress`
3. `batchImport.onComplete`
4. `variants.onAnnotationChanged`
5. `cohort.onSummaryRebuilt`
6. logs/updater events only if web UI keeps those surfaces

## Step 12 - Renderer Capability Gating

Initial inventory:

- database picker and profile/file actions
- import file pickers and drag/drop path assumptions
- batch import folder/zip workflows
- export "show in folder" behavior
- updater UI
- log stream UI
- gene reference, PanelApp/StringDB, VEP/myvariant/SpliceAI, HPO/protein/gnomAD/transcript workflows if not routed in web

## Step 13 - Opt-In Web CI Lane

Add a canonical opt-in web command that cannot silently skip the important pieces. This is not a replacement for default `make ci`; it is the sysadmin/web-track readiness gate.

Candidate:

```bash
make web-ci
```

It should run:

- `npm run build:web`
- web static gates
- Postgres-backed integration gates
- ready behavioral parity tests
- Docker/Compose smoke for the built image once app-level gates are green

Keep `make ci` desktop-default.

## Step 14 - Deploy Wiring Fixes

Apply operator/runtime fixes found by the explorers:

- Pass `VARLENS_ADMIN_PASSWORD_HASH` through compose.
- Remove or correct stale `/data/admin-recovery-key.txt` references.
- Add image+Postgres smoke before publish/deploy.
- Keep deploy docs Postgres-only unless a deliberate SQLite web mode is reintroduced.

## Step 15 - Docs Cleanup

Update:

- `tests/web-gate/README.md`
- `.planning/web/phase2-followups.md`
- `.planning/web/04-testing/desktop-to-web-parity.md`
- `DEPLOY.md`
- relevant `web-deploy/docs/**`

Rules:

- Do not rewrite historical QA reports as if they were current.
- Add a current-state index that says what is true now.
- Mark SQLite-first concept docs as historical/spec input where implementation has moved to Postgres-only.
