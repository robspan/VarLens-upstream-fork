# PR #202 — Strategy, Architecture, and Multi-Agent Deep Review

**PR:** [`feat(web): add Postgres-backed web pilot`](https://github.com/berntpopp/VarLens/pull/202)
**Author:** Robin Spanier (@robspan), external contributor (fork: `robspan/VarLens-upstream-fork`)
**Branch:** `VarLens-Web` → `main`
**Head reviewed:** `e7c0b013`
**Volume:** +69,502 / −297 across **299 files**
**State:** Draft. CI green (Checks Ubuntu, web-ci, Package Linux/macOS pass; Package Windows pending at audit time).
**Reviews consolidated:**
  - **Strategy pass** — 2026-05-20, manual, worktree `/home/bernt-popp/development/VarLens-pr202-review`
  - **Multi-agent deep pass** — 2026-05-20, five parallel reviewer agents (architecture, security, code quality, desktop regression, tests/CI/maintenance), worktree `/tmp/varlens-pr202`
  - **Follow-up architectural pass** — 2026-05-21, focused discussion of Docker, HTTP API shape, session model vs kidney-genetics-db reference; four comments posted on PR — see "2026-05-21 follow-up" section.
**Full per-lens reports:** `/tmp/pr202-review/01-architecture.md` … `05-tests-ci-maintenance.md`

---

## TL;DR

**Decision: Restructure before merge.** Do not reject — the foundation in `src/web/` is the right architecture and aligns cleanly with the three-mode product vision. Do not accept as-is — the PR mixes ~5,000 LOC of genuine application work with ~60,000 LOC of downstream operations content, ships five blocking security issues, and contains four concrete SQLite-vs-Postgres parity bugs that would corrupt clinical data on the web path.

The strategic direction is right: the PR keeps Electron/SQLite as the default product and adds a PostgreSQL-backed hosted-web variant. That matches the three-mode strategy:

- **Mode 1, fat client + local SQLite** — preserved as the default desktop lane.
- **Mode 2, fat client + remote PostgreSQL** — already shipped in Phases 13-16 (this PR did not introduce it; it tightened it by sealing the `StorageSession` interface).
- **Mode 3, hosted thin client + PostgreSQL** — this PR's real contribution. Delivered as **single-user / shared-tenant only**. The `users` table exists; `user_id` scoping on clinical tables does not. Multi-user is the next phase, not this PR.

The problem is not the strategic choice. The problem is scope, security posture, and a small but real set of behavioural divergences between the desktop SQLite path and the web Postgres path that turn what should be a "transport adapter" into a "second domain-logic implementation" for several specific handlers.

---

## Alignment with the three-mode vision

| Mode | Status pre-PR | Status this PR | Honest assessment |
|---|---|---|---|
| **1. Electron + local SQLite** | First-class, stable | Preserved; light refactor with pinning tests (`tests/main/services/auth/auth-constants.test.ts`, `storage-session-contract.test.ts`, `tests/refactor-checkpoint/*`) | ✅ Unaffected. Smoke test recommended. |
| **2. Electron + remote PostgreSQL** | Already shipped (Phases 13-16: `PostgresStorageSession`, `PostgresReadExecutor`, `COPY FROM STDIN` import) | Strengthened: `StorageSession` interface sealed; `getDatabaseService`/`getDbPool` removed from contract and tracked via shrinking allowlist (`tests/web-gate/db-seam.test.ts:63-92`) | ✅ Quality improvement for both Electron paths. |
| **3. Hosted thin client + PostgreSQL** | Not present | Single-user delivered. Multi-user prepared but `EXPECTED_MISSING_USER_ID` snapshot is `test.fails()` at [`user-id-schema.test.ts:157`](../../tests/web-gate/user-id-schema.test.ts); ADR `0003-per-tenant-schema-prep.md:8-17` acknowledges Stage 2 is follow-up | ⚠️ Stage 1 only. `auth:createUser` works today but every created user sees every other user's clinical data. |

**The architecture supports the vision.** `src/web/server.ts:88-97` instantiates `createPostgresStorageSession(pgConfig)` — the **same factory** the Electron app uses when configured against a remote Postgres. The 1,414-line dispatcher's autoroute body delegates into the same `PostgresReadExecutor`/`PostgresWriteExecutor` (`src/web/server/dispatcher.ts:1401-1409`):

```ts
if (isReadTaskType(key))  return await deps.session.getReadExecutor().execute(task)
if (isWriteTaskType(key)) return await deps.session.getWriteExecutor().execute(task)
```

ADR 0002 (`parallel-maintainability.md`) explicitly considered the "extract a service layer that both Electron and web import" alternative and concluded that's already what exists — the `*-logic.ts` modules + executor task pattern. The dispatcher is a switchboard onto that layer. The seam choice is sound at the framework level.

What goes wrong is at the **per-handler level**: for several specific domains (transcripts, panels, annotations, variants:search) the dispatcher hand-rolls Postgres workflows that diverge from the SQLite behavior they should mirror. The shared seam exists; specific handlers walk around it.

---

## Blocking findings

### B1. Hardcoded default Basic-Auth credentials in front of `docker.sock`

**Severity: Critical** (`security`)

`web-deploy/compose/Caddyfile:113-117` ships a literal bcrypt hash for `admin:varlens-konzept` to protect Dozzle, which is mounted with `/var/run/docker.sock:/var/run/docker.sock:ro` (`docker-compose.yml:67-68`). `web-deploy/.gitleaks.toml:13-15` explicitly allowlists the literal string `varlens-konzept` so secret scanners stay silent. The credential is printed openly on the `/welcome` page (`Caddyfile:80`). Combined with `ssh_allowlist = ["0.0.0.0/0", "::/0"]` default (`tofu/environments/pilot/variables.tf:57-61`) and a public GHCR `:edge` image, this is one default-creds reach away from full container log streams on the open internet. Dozzle log streams carry Fastify request logs (usernames, paths, error payloads), so log access is patient-data access.

**Fix:** rotate to a per-deployment generated secret (same pattern as `POSTGRES_PASSWORD`). Refuse boot if the default is still present. Remove the secret from `.gitleaks.toml` allowlist and from the open `/welcome` page.

### B2. No `user_id` scoping on clinical tables despite multi-user auth machinery

**Severity: Critical** (`security`, `architecture`)

Migration `0007_create_users_and_settings.sql:15-44` adds `users` (with Argon2id hashes, lockout state, roles, `users_only_one_admin` partial unique index) but **no `user_id` FK on `cases`, `variants`, `variant_annotations`, `case_hpo_terms`, `case_comments`, `analysis_groups`, or any other clinical table**. `auth:createUser` is exposed (`dispatcher.ts:393-410`) and works. Admins can create users into a database with zero authorisation boundary between them. ADR 0003 (`per-tenant-schema-prep.md:14-21`) acknowledges this as Stage 2 follow-up; `tests/web-gate/user-id-schema.test.ts:77-95,157` tracks the gap as `test.fails()`.

Under GDPR Art. 32 for the Charité deployment target, an analyst reading another analyst's case data is a reportable breach.

**Fix:** add `user_id` scoping to clinical tables before any non-synthetic data, *or* hard-refuse `auth:createUser` until scoping ships, *or* loudly label this as single-user-shared-tenant in `DEPLOY.md` and the `/welcome` page and don't ship `auth:createUser` as a documented capability.

### B3. Authenticated arbitrary-file read on the host filesystem

**Severity: Critical** (`security`)

`region-files:importBed` (`dispatcher.ts:1097-1109`) accepts any absolute path from any authenticated session, calls `readFile(filePath, 'utf8')`, and the error path leaks unparsed line text (`dispatcher.ts:178-179, 262-272`). Unlike sibling import handlers (`import:start`, `import:startMultiFile`, `batch-import:extractZip`, `batch-import:testZipPassword` — all gated by `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT=1` at `dispatcher.ts:747, 793, 885, 904`), this handler has no path-import gate.

Reachable target: `/data/web-session-secret` (`src/web/server/auth.ts:53, 130-149`) — the cookie-signing key. Disclosure lets an attacker mint arbitrary valid sessions for any user. Other reachable paths include `/etc/passwd`, `/proc/self/environ`, migration SQL files, and any file inside `/data`.

**Fix:** gate `region-files:importBed` with `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT` like its siblings, or replace with a browser-upload route.

### B4. No CSRF token; Origin check fails open

**Severity: Critical** (`security`)

`grep -rn csrf src/web` returns one comment — there is no CSRF token machinery. The only same-origin defence is `isAllowedApiOrigin(...)` (`src/web/server/auth.ts:91-105`, used at `auth.ts:192-205`). It fails open on missing Origin: `if (params.origin === undefined || params.origin.trim() === '') return true` (line 96). SameSite=Strict on the session cookie is the load-bearing single control. For a clinical-data app this should not be a single-control defence — SameSite has documented bypass edge cases (subdomain takeover, redirect chains, browser-specific Origin-suppression bugs).

**Fix:** add a double-submit token or per-session origin pin and reject Origin-missing unsafe methods rather than allowing them.

### B5. Plaintext `VARLENS_ADMIN_PASSWORD` bootstrap path still accepted

**Severity: Critical** (`security`)

`src/web/server.ts:198-215` accepts `VARLENS_ADMIN_PASSWORD`, warns on deprecation, but **does not refuse it**. `DEPLOY.md:117-124` instructs operators to literally put `VARLENS_ADMIN_PASSWORD=` into `web-deploy/.env`. The deploy user is added to the `docker` group (`cloud-init/pilot.yaml:172`), so `docker inspect <container>` reads the env at any time. Any incident response that pulls `docker inspect`, or any future feature that exposes process env, leaks the bootstrap admin password.

**Fix:** remove the plaintext path; point `DEPLOY.md` only at `VARLENS_ADMIN_PASSWORD_HASH` (the `scripts/varlens-hash-password.ts` flow already exists and is well-designed).

### B6. SQLite-vs-Postgres parity bugs in domain logic

**Severity: High** (`correctness`)

The dispatcher hand-rolls Postgres workflows for several handlers and the workflows diverge from the SQLite behavior they should mirror. **These are real bugs, not style issues.**

- **Transcript switch / insert does not update parent `variants` row on Postgres.**
  SQLite (`src/main/database/TranscriptRepository.ts:49-100`) `switchSelectedTranscript` updates `variant_transcripts.is_selected` AND **also updates the parent `variants` row** (transcript, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi — lines 84-97). The Postgres path in `src/web/server/dispatcher.ts:1217-1252` and the matching Postgres branch in `src/main/ipc/handlers/transcripts.ts:117-128` only update `variant_transcripts.is_selected`. **The parent `variants` row goes stale.** Variant table data used by views, filters, and exports diverges from the user's selection. This applies to **both Postgres paths** (desktop Mode 2 and web Mode 3), not just web.
- **`panels:get` shape mismatch.** Desktop (`src/main/ipc/handlers/panels.ts:267`) enriches the panel row with its `genes` payload before returning. Web auto-routes through the generic executor (`dispatcher.ts:1401-1409`) and returns only the bare panel row. UI code expecting `genes` breaks on web.
- **`panels:update` argument shape mismatch.** Desktop unpacks `{ id, ...updates }` into `[panelId, updates]` (`panels.ts:307`). Web autoroutes the raw API args to the storage task (`dispatcher.ts:1406`), so the task receives `[{ id, ...updates }]` instead of `[id, updates]` — silent wrong-shape on the web path.
- **`variants:search` return-type mismatch.** The shared IPC contract expects `Variant[]`. The Postgres/web path returns a paginated query result envelope (`dispatcher.ts:1133`). Renderer code that assumed `Variant[]` may treat the envelope as data.
- **Annotation upsert: no transaction around write + audit append.** `annotations:upsertGlobal` (`dispatcher.ts:1018-1047`) bypasses the Zod validation used by the desktop handler, then performs the storage write and the audit-row append in **separate steps without a transaction**. If audit append fails, the annotation is already committed and the audit log misses the event — exactly the failure mode audit logging is supposed to prevent.

**Fix:** extract the divergent workflows into shared `*-postgres-logic.ts` modules (`transcripts-postgres-logic.ts`, `panels-postgres-logic.ts`, `annotations-postgres-logic.ts`) called from both `src/main/ipc/handlers/*.ts` and `src/web/server/dispatcher.ts`. This removes ~100-200 lines from the dispatcher and a class of "fix the bug in two places" bugs.

### B7. The handler-seam test was reduced to "file exists"

**Severity: High** (`architecture`, `tests`)

ADR 0002 says structural tests enforce that web routes do not re-implement behavior. The implementation reduced the contract: `tests/web-gate/handler-seam.test.ts:71-78` checks domain set parity between shared/preload/main (good), but the dispatcher↔handler **behavior parity** is reduced to a bare `existsSync(DISPATCHER_PATH)` / `existsSync(TASK_TYPES_PATH)`. That no longer proves web and desktop share behavior. Combined with B6, this is how the parity bugs slipped through.

**Fix:** restore an enforceable seam. Add a per-method test that for every shared IPC contract entry, either (a) the dispatcher autoroutes to the same task type the desktop handler dispatches to, or (b) the dispatcher's override and the desktop handler's body both call into the same `*-logic.ts` module.

### B8. Web transport reaches into Postgres internals directly

**Severity: High** (`architecture`)

ADR 0001 says Postgres-specific SQL should live under `src/main/storage/postgres/` and the rest of the app should route through `StorageSession` (`adr/0001-backend-split.md:15`). The web dispatcher violates that:

- `src/web/server/dispatcher.ts:62` imports `quoteIdentifier` from `../../main/storage/postgres/identifiers`
- `src/web/server/dispatcher.ts:64` imports `Pool` from `pg`
- `src/web/server/dispatcher.ts:137` and the transcripts overrides reach in via `postgresContext(session)` and run SQL directly (e.g. `dispatcher.ts:1189-1255`)

The web transport is not a transport — it is becoming a Postgres repository layer in parallel to `src/main/storage/postgres/`. Schema evolution now has to keep two SQL sites in sync.

**Fix:** move these operations into storage repositories or shared handler logic (overlaps with B6's `*-postgres-logic.ts` extraction).

### B9. `IpcResult<T>` contract not preserved across the web boundary

**Severity: High** (`code-quality`, `architecture`)

`grep -n wrapHandler src/web/` returns zero hits. Override handlers return raw application values on success; errors use ad-hoc `{ error: 'slug', message: '...' }` shapes (51 `reply.code()` calls). The browser client (`src/web/client/api.ts:46-69`) throws plain `Error` instead of returning `IpcResult<T>`. The renderer's `unwrapIpcResult` (`src/renderer/src/utils/ipc-result.ts`) is bypassed on the web path. The preload contract test (`tests/shared/types/preload-contract.test.ts`) believes the API returns `Promise<IpcResult<T>>` — true in Electron, false on web. Renderer behavior diverges between desktop and web even though they share types.

**Fix:** wrap every dispatcher handler in `wrapHandler` so error responses are `SerializableError`-shaped, and have `web/client/api.ts` return `IpcResult<T>` instead of throwing. The preload contract test then doubles as a web contract test.

### B10. Required CI does not cover the new web/deploy surfaces

**Severity: High** (`process`)

The required `build.yml` path filter does not include `Dockerfile`, `vite.web*.config.ts`, `web-deploy/**`, or the new web workflows (`build.yml:37`). The branch-protection comment says only the aggregate `CI` job plus secrets-scan should be required (`build.yml:262`). Result: web/deploy-only changes can pass required CI without `web-ci` being required.

**Fix:** either make `web-ci` a required check for relevant paths, or fold all web/deploy path detection into the required aggregator.

---

## High-risk findings

### H1. Login response leaks lockout state — username enumeration + targeted admin DoS

`src/web/login/login.html:424-428` displays "Account is temporarily locked" when the server returns `{locked: true}`, which `PostgresWebAuthService.authenticate` (line 327-330) sets only for known users. Combined with case-sensitive `WHERE username = $1` and 5-attempt lockout (`auth-constants.ts:46`, `LOCKOUT_DURATION_MINUTES = 15`), an unauthenticated attacker can probe usernames and DoS `admin` for 15 minutes by burning attempts. No `@fastify/rate-limit` is registered.

### H2. No authentication audit log

`audit_log` carries only the variant-curation event types (`acmg_classify`, `acmg_evidence_update`, `star`/`unstar` — `audit-shape.test.ts:23-32`). Authentication events (successful login, failed login, lockout, password rotation, user creation, deactivation, admin reset, session revalidation failure) are not appended. Hard finding under GDPR Art. 30 and HIPAA §164.312(b).

### H3. CSP allows `'unsafe-eval'`

`src/web/index.html:13-15` ships `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:` plus a long `connect-src` list (gnomAD, AlphaFold, Ensembl, EBI, RCSB). `'unsafe-eval'` is almost certainly there to support `pdbe-molstar` — AGENTS.md's note about loading it through Vite's asset graph is the right fix.

### H4. Temporary passwords skip the policy gate

`PostgresWebAuthService.createUser` (`PostgresWebAuthService.ts:372`) and `resetPassword` (`PostgresWebAuthService.ts:432`) hash directly without going through the password length policy declared at `PostgresWebAuthService.ts:34`. Admin-set temp passwords can be shorter than the user-set minimum.

### H5. `web-deploy/.github/workflows/ci.yml` uses floating action tags

`actions/checkout@v6`, `opentofu/setup-opentofu@v2`, `aquasecurity/trivy-action@v0.36.0` at `web-deploy/.github/workflows/ci.yml:23`. Violates the repo rule (AGENTS.md): "GitHub Actions must stay pinned to full commit SHAs." Also, YAML lint is non-blocking via `|| true` at `ci.yml:113`.

### H6. App image default is `:edge` while infrastructure is digest-pinned

`web-deploy/compose/docker-compose.yml:87` floats the app image at `:edge`. Caddy and Postgres in the same file are digest-pinned. Clinical-app default should be a reviewed digest or release tag; `edge` should be an explicit pilot/dev choice.

### H7. `npm run build` builds both Electron and web by default

`package.json:15` makes the desktop default build also build the web bundle. This conflicts with the documented default-mode model where desktop is default and web is opt-in via `VARLENS_WEB=1`. Keep `npm run build` desktop-only.

### H8. `execFileSync('sqlite3', ...)` in the web bundle

`src/web/server/web-gene-reference.ts:47` shells out to the `sqlite3` CLI. Fragile (depends on binary in PATH), slow (one process spawn per query), and not interpolation-safe (table names concatenated into SQL at `:53, 65-67`). Replace with first-class Postgres tables or a native sqlite3 binding.

### H9. TLS-ALPN 7-day cert default with no expiry monitor

`docker-compose.yml:29` defaults to `tls-le-ip` (7-day Let's Encrypt). Fast key churn (good) but fragile to network blips at the ~5-day renewal cadence with no alert path. Either move default to `tls-le-classic` (90-day) plus a Caddy `events` heartbeat hook, or add an Uptime-Kuma probe for TLS expiry.

### H10. Scope leak — operations content in the application repo

- **`web-deploy/` is 16,791 LOC** of OpenTofu + Caddy + Charité-specific Python operator scripts + SOPS+age secrets pipeline. ADR 0001 (`backend-split.md`) already names `VarLens-IaC` as the home for this work; the implementation diverged.
- **`.planning/web/context/spec/*.html` is 4,329 LOC** of German-language Confluence exports from `laborberlin.atlassian.net`. Legitimate spec source for the contributor, not idiomatic VarLens `.planning/`.
- `.github/workflows/publish-web.yml` and `release-web.yml` push to GHCR and SSH-deploy to a specific Charité host; operations, not application.

---

## Medium / hygiene findings

| # | Lens | Item | Evidence |
|---|---|---|---|
| M1 | Security | Argon2id parameters at OWASP minimum (m=64MB, t=3, p=4); bumpable on cpx32 target | `argon2-provider.ts:10-14` |
| M2 | Security | `Cache-Control: no-store` missing on `/api/*` JSON responses | `dispatcher.ts` (no cache headers set) |
| M3 | Security | Session secret lives on `/data` alongside other state — operator rsync clones it | `auth.ts:117-149` |
| M4 | Security | `wget` and `ca-certificates` in runtime image | `Dockerfile:78` |
| M5 | Security | Trivy gate is CRITICAL-only; HIGH is advisory SARIF | `publish-web.yml:179-220` |
| M6 | Security | Postgres password lives in `VARLENS_PG_URL` string visible via `docker inspect` and `/proc/<pid>/environ` | `docker-compose.yml:147-148` |
| M7 | Security | `auth:resetPassword` by admin has no step-up auth | `dispatcher.ts:440-454` |
| M8 | Desktop | `fastify`/`@fastify/*` in runtime `dependencies` — electron-builder copies into asar, bloats installer | `package.json:181-183` |
| M9 | Desktop | `(session as { getPool?(): Pool }).getPool` cast in `transcripts.ts:32` bypasses type-check | `transcripts.ts:32` |
| M10 | Architecture | Mode 3 delivered as single-user; PR description and `/welcome` page do not say so loudly | ADR 0003 |
| M11 | Code-quality | 1,414-line dispatcher bundles every domain in one file — 2.3× the largest existing handler (`panels.ts` at 614 LOC). Violates the IPC domain-module pattern AGENTS.md prescribes for new work. Recommended fix in "2026-05-21 follow-up": per-domain Fastify routes + shared Zod schemas + `@fastify/swagger`. | AGENTS.md "Code Style"; comparison via `wc -l src/main/ipc/handlers/*.ts` |
| M12 | Code-quality | Only ~14 of ~58 override handlers unit-tested; pre-rotation gate has zero direct unit tests | `dispatcher-adapters.test.ts` (445 LOC, 19 cases) |
| M13 | Code-quality | The two `src/web/stubs/*` files work around module-graph issues; dependency injection on `mainLogger`/gene-reference is the cleaner long-term fix | `src/web/stubs/` |
| M14 | Maintenance | 31,895-line `data-manifest-parity.json` snapshot will be rubber-stamped on regen | `tests/web-gate/parity/__snapshots__/data-manifest-parity.json` |
| M15 | Maintenance | 1,404-line bespoke reporter does runner + normalizer + renderer + orchestrator; orchestration duplicates `make web-ci` | `scripts/reports/run-web-test-report.mjs` |
| M16 | Maintenance | `upstream-sync-check.yml` hard-codes `berntpopp/VarLens@main` as upstream — harmful when this *is* upstream | `.github/workflows/upstream-sync-check.yml:30-39` |
| M17 | Maintenance | `tests/refactor-checkpoint/` (308 LOC, 2 snapshots) is temporary scaffold from the StorageSession extraction; needs an explicit removal date | `tests/refactor-checkpoint/README.md` |
| M18 | Hygiene | Operational audit reports (`.planning/web/operations/audits/*.md`) are point-in-time artifacts; archive to `.planning/archive/` on merge | `.planning/web/operations/audits/` |

---

## What's directionally good

The engineering posture is conscientious. Calling out where the contributor got it right matters for the conversation about what to keep.

- **Web is Postgres-only, not synchronous-SQLite-behind-Fastify.** Right backend split for a hosted thin client (`adr/0001-backend-split.md:12`, `postgres-backend.md:7`).
- **Server-side login wall** — the SPA shell is never served to unauthenticated requesters (`src/web/server/page-gate.ts:71-104`).
- **Session cookie defaults** — `__Host-` prefix + `HttpOnly` + `SameSite=Strict` + `Secure`. Textbook (`src/web/server/auth.ts:67-69, 158-182`).
- **Server-path import is double-gated** outside test (`dispatcher.ts:745, 793, 885, 904`) — the contributor knew to defang the path-import attack surface. The miss at B3 is an inconsistency, not a missing concept.
- **`as const satisfies readonly StorageReadTask['type'][]`** at `src/web/server/task-types.ts:65, 120` — the web allowlist is compile-time checked against the canonical task union. Contract-drift guardrail at the type level.
- **Atomic failed-login counter in a single SQL `UPDATE` with `CASE WHEN`** (`PostgresWebAuthService.ts:342-352`) closes a read-modify-write race that the SQLite version masked.
- **Partial unique index `users_only_one_admin`** (`0007_create_users_and_settings.sql:42-44`) — belt-and-braces over the application-level `hasAdmin()` check.
- **Pre-rotation gate** whitelists exactly `auth:changePassword + auth:logout` for `must_change_password=TRUE` sessions (`dispatcher.ts:1382-1394`). Closes the bootstrap-credential window cleanly.
- **Server-side session revalidation** on every `/api/*` request (`auth.ts:218-233`) — DB row checked against the cookie's snapshot; deactivation and rotation invalidate stale sessions even though the cookie itself is signed-stateless.
- **ts-morph static gates** — `auth-isolation.test.ts` bans `@node-rs/argon2`/`bcrypt`/`jsonwebtoken`/`jose` imports outside `src/main/auth/providers/`; `electron-leak.test.ts` bans `electron` imports under `src/shared/**` or `src/web/**` and greps the bundled `out/web/server.cjs`.
- **Accepted-divergence allowlists** in `db-seam.test.ts` and `user-id-schema.test.ts` make "web ships with fewer features than desktop" a first-class state, not an emergency.
- **`StorageSession` interface seal** + `tests/main/storage/storage-session-contract.test.ts` parameterized over both backends. Quality improvement that benefits both desktop modes.
- **Default `npm test` is `vitest run --project main --project renderer`** — web-gate doesn't pollute the desktop run. `make ci` / `make ci-full` paths are unchanged.
- **`scripts/varlens-hash-password.ts`** is well-designed: raw-TTY mode, stdin-friendly pipe mode, min-length, no FS persistence of plaintext.
- **SOPS + age** for shared secrets (`web-deploy/secrets/example.yaml`) is the right pattern.
- **`Dockerfile` is genuinely well-built.** Multi-stage with `npm prune --omit=dev` between stages; pinned `node:24.14.1-bookworm-slim` matching `.nvmrc`; non-root user `varlens:varlens` uid 1001 with `nologin` shell; `tini` as PID 1 for signal forwarding and zombie reaping; `HEALTHCHECK` against `/healthz`; `VOLUME ["/data"]` with `VARLENS_DB_PATH` intentionally **not** defaulted (fails loud on missing mount instead of silently writing to the ephemeral container layer that evaporates on `docker rm`); a real builder-stage smoke test that `require()`s the bundle, opens a `:memory:` SQLite, and runs `argon2.hash()` to exercise the dlopen path that plain `npm ci` would miss for optional native deps; targeted `npm rebuild better-sqlite3-multiple-ciphers @node-rs/argon2` after `--ignore-scripts` to dodge the Electron-only postinstall. The compose-layer hardening (`security_opt`, `cap_drop`, resource limits) is missing — but the image itself is on the right side of best-practice for Node web services.

---

## Cross-lens risk matrix

| Severity | Lens | Item | Where |
|---|---|---|---|
| 🔴 BLOCK | Security | Default `admin:varlens-konzept` in front of Dozzle + `docker.sock:ro` + GHCR `:edge` + worldwide SSH | B1 |
| 🔴 BLOCK | Security | No `user_id` scoping on clinical tables despite multi-user auth | B2 |
| 🔴 BLOCK | Security | Authenticated arbitrary-file read; reachable `/data/web-session-secret` | B3 |
| 🔴 BLOCK | Security | No CSRF token; Origin check fails open | B4 |
| 🔴 BLOCK | Security | Plaintext `VARLENS_ADMIN_PASSWORD` still accepted; DEPLOY.md recommends | B5 |
| 🔴 BLOCK | Correctness | Postgres transcript switch/insert doesn't update parent `variants` row (both web and desktop Mode 2) | B6 |
| 🔴 BLOCK | Correctness | `panels:get` / `panels:update` / `variants:search` shape divergence between desktop and web | B6 |
| 🔴 BLOCK | Correctness | Annotation upsert: write + audit append not transactional | B6 |
| 🔴 BLOCK | Architecture | Handler-seam test reduced to `existsSync` — no behavioural parity gate | B7 |
| 🔴 BLOCK | Architecture | Web dispatcher imports `pg.Pool` and `quoteIdentifier`; runs SQL directly | B8 |
| 🔴 BLOCK | Code-quality | `IpcResult<T>` envelope not preserved; renderer behavior diverges between desktop and web | B9 |
| 🔴 BLOCK | Process | Required CI doesn't include Dockerfile / web-deploy / web workflows | B10 |
| 🟠 HIGH | Security | Login lockout-state leak → username enumeration + admin DoS | H1 |
| 🟠 HIGH | Security | No auth audit log; `audit_log` only carries ACMG events | H2 |
| 🟠 HIGH | Security | CSP allows `'unsafe-eval'` | H3 |
| 🟠 HIGH | Security | Admin-set temp passwords skip the user password policy | H4 |
| 🟠 HIGH | Process | `web-deploy/.github/workflows/ci.yml` floats action tags; YAML lint non-blocking | H5 |
| 🟠 HIGH | Operations | App image default `:edge` while infrastructure is digest-pinned | H6 |
| 🟠 HIGH | Process | `npm run build` builds both — breaks desktop-default contract | H7 |
| 🟠 HIGH | Code-quality | `execFileSync('sqlite3', ...)` in `web-gene-reference.ts` | H8 |
| 🟠 HIGH | Operations | TLS-ALPN 7-day cert with no expiry monitor | H9 |
| 🟠 HIGH | Scope | 16,791 LOC `web-deploy/` + 4,329 LOC German Confluence HTML in app repo | H10 |
| 🟡 MED | (see M1–M18 above) | | |

---

## 2026-05-21 follow-up: architectural recommendations and comments posted

After the multi-agent deep pass, a focused architectural discussion clarified four concrete recommendations posted as comments on PR #202. They sharpen existing findings (H10, M11, M-tier compose items) into actionable next steps. Each is reproduced here so the review document carries the recommendation alongside the original finding.

### F1. Recommended HTTP API shape *(sharpens M11, B7, B8, B9)*

`src/web/server/dispatcher.ts` at 1,414 LOC violates the de facto repo convention: every IPC domain in `src/main/ipc/handlers/` lives in its own file (~100–600 LOC each; largest is `panels.ts` at 614). The dispatcher is 2.3× that and bundles every domain into one file.

The recommended fix is more than "split the file" — one refactor lands the LOC split, the missing OpenAPI surface, end-to-end typing, and naturally cleans up B7/B8/B9:

1. **Hoist API schemas to `src/shared/api/schemas/<domain>.ts`** as Zod schemas. Single source of truth for desktop IPC handlers, web Fastify routes, and SPA fetch wrappers. TypeScript types derive via `z.infer<typeof Schema>` — no codegen step.
2. **Split the dispatcher into `src/web/server/routes/<domain>.ts`** — one route file per domain, mirroring `src/main/ipc/handlers/<domain>.ts`. Each ~100–200 LOC, importing schemas from `src/shared/api/`.
3. **Add `@fastify/swagger` + `fastify-type-provider-zod`** so an OpenAPI spec is auto-generated at `/openapi.json` from the same Zod schemas. Useful for external clients (CLI, partner integrations) without forcing the SPA to consume it — the SPA already shares the schemas directly via the shared import path.

**Incremental, desktop-safe migration** (each step lands behind green CI; the codebase is never in a "both might be broken" state):

1. Move IPC handler input/output types into `src/shared/api/schemas/` as Zod schemas.
2. Update existing main-process handlers to import from there. Desktop CI gates this step.
3. Split the web dispatcher into per-domain routes importing the same schemas.
4. Wire up `@fastify/swagger`.

Steps 1–2 are pure desktop refactor — no web changes. Steps 3–4 are web-only — no desktop changes.

**Why this beats the alternatives for VarLens specifically:**

- **vs. `openapi-typescript` codegen path:** no codegen step to rot, no intermediate JSON-schema layer that loses Zod refinements/transforms, and the desktop IPC handlers naturally share the same source of truth (codegen would create a *third* source).
- **vs. tRPC:** no custom wire format, REST URLs for external consumers, no rewriting of the SPA's existing `fetch`/`axios` call sites, and tRPC's router shape doesn't compose with the existing IPC pattern. tRPC's only edge — automatic SPA type inference — is matched by `z.infer` on shared Zod imports.
- **vs. `ts-rest`:** smaller surface area, no new framework concept ("contract"), just standard Fastify + Zod which are already in the dependency graph.

This refactor also naturally addresses:

- **B7** (handler-seam test reduced to `existsSync`) — per-domain route files restore a per-domain assertion: for every shared IPC contract entry, assert the corresponding web route exists and imports from `src/shared/api/schemas/<domain>.ts`.
- **B8** (web transport reaches into `pg.Pool` and `quoteIdentifier`) — per-domain routes shouldn't need raw `pg.Pool` access; the storage executors plus shared `*-postgres-logic.ts` modules cover the case.
- **B9** (`IpcResult<T>` not preserved) — per-domain routes wrap success values in `IpcResult<T>` consistently, with a `wrapHandler` web-tier equivalent.

### F2. Session model defence *(clarifies the auth design choice, vindicates a "directionally good" item)*

The session-cookie model (`__Host-` + `HttpOnly` + `SameSite=Strict` + server-side revalidation) is the right choice for VarLens, not a stylistic preference. Three properties matter for the clinical-data threat model:

- **Instant revocation.** Cookie sessions hit the DB on every request; deleting a session row revokes the credential immediately. JWT models (including the hybrid stateless-access + stateful-refresh pattern used by sibling `kidney-genetics-db`) leave the access token valid until its TTL expires — typically 15–60 minutes. For off-boarded clinicians, compromised laptops, or suspected breach, "valid for up to 60 more minutes" is real residual risk.
- **No JS-readable credential.** `HttpOnly` cookies are invisible to JavaScript. A JWT in any frontend-accessible storage (Pinia, localStorage, in-memory) is XSS-readable for the token's full TTL.
- **CSRF largely solved structurally.** `__Host-` + `SameSite=Strict` makes cross-site CSRF essentially impossible for this app. JWT-in-`Authorization`-header avoids CSRF but loses the `HttpOnly` property; hybrid models need explicit CSRF tokens on the refresh endpoint regardless.

Trade-off: every authenticated request hits Postgres. For a clinical-cohort tool with bounded users this is negligible; for high-throughput public APIs it would not be. OWASP's Session Management Cheat Sheet prefers server-side sessions for apps that need real-time invalidation on logout, password change, role change, or suspected compromise — VarLens's profile exactly. The pre-rotation gate (`dispatcher.ts:1382-1394`) confirms Robin was optimising for this property deliberately.

**This does not displace B4** (no CSRF token; Origin check fails open) — even with `SameSite=Strict` doing structural work, the explicit CSRF defence is still required for browser bugs and `SameSite` bypass edge cases. The session model is right; the defence-in-depth still has a gap.

### F3. Container compose hardening *(sharpens the M-tier gap; complements the "Dockerfile is well-built" finding)*

The `Dockerfile` is on the right side of best-practice (see "What's directionally good"). The gap is at the **compose layer** for `web-deploy/compose/docker-compose.yml`. The `app`, `caddy`, `uptime-kuma`, `dozzle`, and `postgres` services all lack standard defense-in-depth flags. Reference pattern that does it correctly: sibling project `kidney-genetics-db/docker-compose.prod.yml`.

Required additions (~20 lines per service):

- `security_opt: ["no-new-privileges:true"]` — blocks setuid escalation inside the container.
- `cap_drop: ["ALL"]` — the app runs as uid 1001; no Linux capabilities are needed.
- `read_only: true` + `tmpfs` for any writable runtime paths.
- `deploy.resources.limits` (cpus, memory, pids) + `ulimits` (nproc, nofile).
- `logging` driver with `max-size` + `max-file` for rotation.

Since H10 / F4 ask for `web-deploy/` to move to a separate repo, the hardening lands in the downstream repo — but the requirement stands regardless of which repo carries it.

### F4. Repository boundary *(sharpens H10)*

ADR 0001 (`backend-split.md`) and `.planning/web/context/spec/vertrag.html` ("Vertrag: Trennung Anwendungs-Repo / IaC-Repo") both explicitly call for splitting the application repo from the IaC / operator repo. The PR violates its own ADRs:

- **`web-deploy/`** (16,800 LOC): OpenTofu modules, Caddy config, SOPS+age, Charité-specific operator scripts. **Move to a separate `varlens-web-deploy` repo, Erstbetreiber-owned**, per ADR 0001.
- **`.planning/web/context/spec/*.html`** (4,300 LOC): internal Labor Berlin Confluence exports. These contain ADR HTML, RACI tables, internal assessments, and a Robin-side path leak (`/Users/robinspanier/Documents/GitHub/VarLens` in `konzept/bewertungen.html`). They belong in the Labor Berlin-internal Confluence space, not in a public OSS repo. **Drop entirely from the PR.** A private archive of the current state is preserved at the maintainer's `berntpopp/varlens-pr202-charite-spec` repo (private).

After this split, the PR is ~4 K LOC of reviewable application work. The "swap to AWS / Hetzner / Open Telekom" decision stays a pure IaC-repo concern — nothing application-side knows where it runs.

### Comments posted on PR #202

| Comment | Topic | Cross-ref |
|---|---|---|
| [#4503112873](https://github.com/berntpopp/VarLens/pull/202#issuecomment-4503112873) | Move `web-deploy/` and `.planning/web/context/spec/` to a separate `varlens-web-deploy` repo (Erstbetreiber-owned). | F4 / H10 |
| [#4503124841](https://github.com/berntpopp/VarLens/pull/202#issuecomment-4503124841) | Drop `.planning/web/context/spec/` entirely — internal Labor Berlin content with a path-leak, not for public OSS. | F4 / H10 |
| [#4503266562](https://github.com/berntpopp/VarLens/pull/202#issuecomment-4503266562) | Add container hardening flags (`security_opt`, `cap_drop`, resource limits, `logging` rotation) to every service in `web-deploy/compose/docker-compose.yml`. | F3 |
| [#4503379012](https://github.com/berntpopp/VarLens/pull/202#issuecomment-4503379012) | Split the 1,400-LOC dispatcher into per-domain Fastify routes; hoist API schemas to `src/shared/api/schemas/<domain>.ts`; add `@fastify/swagger` for an OpenAPI surface. 4-step desktop-safe migration. | F1 / M11 |

---

## Recommendation: split before merge

Both review passes converge on the same conclusion. The application architecture in `src/web/` is the right shape, ~3,800 LOC, sound. The 70 k-line PR is dominated by content that does not need to live in the upstream application repo. Split into tractable PRs:

| Slice | Contents | Net assessment |
|---|---|---|
| **A. Refactor + StorageSession seam (desktop-only)** | `src/main/storage/` extraction, `getDatabaseService`/`getDbPool` shrinking, `tests/refactor-checkpoint/`, `db-seam` + `handler-seam` static gates, AuthService extract to shared constants/`PasswordProvider`. No web code. Demonstrates the refactor is safe on desktop alone. | Independently reviewable. Should land first. |
| **B. Web mode behind a feature flag** | `src/web/`, `vite.web*.config.ts`, Fastify server, `build:web`, web-gate Layer 1 (static) + Layer 2 (integration). Plus `electron-leak`, `auth-isolation`, `audit-shape`, `user-id-schema` gates. **Must include the parity-bug fixes** (transcripts/panels/annotations as shared `*-postgres-logic.ts` modules; restored handler-seam behavioural test; `IpcResult` envelope preserved). | The substantive web addition. Includes the B6-B9 fixes inline. |
| **C. Parity gate + reporter** | `tests/web-gate/parity/`, `tests/fixtures/ipc-parity/`, `scripts/ipc-parity/`, `scripts/api-fixtures/`, `scripts/reports/run-web-test-report.mjs`, `scripts/data-fixtures/`. | Largest opinionated piece. Reviewable on its own. Consider trimming the 1,404-line reporter first. |
| **D. Drop `web-deploy/` from upstream** | Keep in the contributor's `VarLens-IaC` repo per ADR 0001. Drop `publish-web.yml` and `release-web.yml` from upstream — those publish to GHCR and SSH-deploy to a specific host; ops, not application. | Out of scope for upstream. Contributor keeps their downstream. |
| **E. Planning archive trim** | Drop or Markdown-ify `.planning/web/context/spec/*.html`. Archive point-in-time audit/QA reports to `.planning/archive/`. Keep ADRs and refactor plans. | Small follow-up. Ship after B. |

### Required before any non-synthetic data touches a deployment

(In priority order. Security blockers.)

1. **Fix B1.** Rotate the default Dozzle credential to a per-deployment secret. Refuse boot if the default is in place. Remove from `.gitleaks.toml` allowlist and the `/welcome` page.
2. **Fix B3.** Gate `region-files:importBed` with `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT` like its siblings, or replace with a browser-upload route.
3. **Fix B4.** Add CSRF token (double-submit or per-session origin pin). Reject Origin-missing unsafe methods.
4. **Fix B2 or hard-refuse `auth:createUser`** until `user_id` scoping ships. Loudly document the single-user state.
5. **Fix B5.** Remove the plaintext `VARLENS_ADMIN_PASSWORD` path. Update `DEPLOY.md` to point only at `VARLENS_ADMIN_PASSWORD_HASH`.

### Required for merge into upstream `main`

6. **Fix B6** by extracting `transcripts-postgres-logic.ts`, `panels-postgres-logic.ts`, `annotations-postgres-logic.ts`. Both the desktop handler and the web dispatcher call the shared module. Fixes the parent-`variants`-row stale data bug, the `panels:get`/`panels:update` shape divergence, the `variants:search` shape divergence, and the annotation-without-transaction.
7. **Fix B7.** Restore a behavioural seam test: for every shared IPC contract entry, assert either autorouted-to-same-task-type or both-call-same-`*-logic.ts`-module.
8. **Fix B8.** Move dispatcher's direct `pg.Pool` usage into storage repositories (overlaps with item 6).
9. **Fix B9.** Wrap dispatcher handlers in `wrapHandler` (or web-tier equivalent), have `web/client/api.ts` return `IpcResult<T>` instead of throwing.
10. **Fix B10.** Include `Dockerfile`, `vite.web*.config.ts`, `web-deploy/**`, and the web workflows in the required-CI path filter, or fold detection into the aggregator.
11. **Fix H5.** Pin every action in `web-deploy/.github/workflows/ci.yml` to full commit SHA. Remove `|| true` on the YAML lint.
12. **Fix H6.** Replace app `:edge` default with a digest or release tag in `docker-compose.yml`.
13. **Fix H7.** Restore `npm run build` to desktop-only; web build behind `VARLENS_WEB=1` or `build:web`.
14. **Remove or repo-gate** `upstream-sync-check.yml` so it doesn't trip on the upstream repo's own merges.
15. **Move `fastify`/`@fastify/*` out of runtime `dependencies`** (use `optionalDependencies` or exclude via electron-builder `build.files` patterns) so the desktop installer doesn't carry them.
16. **`make ci-full` green** on the merge commit, including the Playwright startup-smoke E2E. Plus a one-time `make dist-linux` (or platform-of-choice) installer-size measurement and a 10-minute packaged-app manual smoke (JSON import, encrypted-SQLite open with password, export, VEP fetch).
17. **Label Mode 3 honestly** in `docs/`, README, and the PR description: "single-user hosted Postgres web pilot — multi-user is Stage 2 follow-up." Don't ship `auth:createUser` as a documented capability until scoping is in place.

### Wholly out of scope for upstream

- `web-deploy/` (operations, Charité-specific) — belongs in `VarLens-IaC` per ADR 0001.
- `.planning/web/context/spec/*.html` (German Confluence mirror) — submodule or downstream-only.
- `publish-web.yml` and `release-web.yml` (publish to GHCR + SSH-deploy to a specific host).
- `upstream-sync-check.yml` (fork-hygiene only).
- Operational audit reports (`.planning/web/operations/audits/`) — point-in-time, belong in `.planning/archive/`.

---

## Note on the contributor

Robin's engineering posture is conscientious. The architecture is sound at the framework level (executor seam reuse, accepted-divergence allowlists, opt-in test projects, ts-morph static gates, sealed cookies, atomic lockout SQL, pre-rotation gate, server-side session revalidation), the planning is thorough (ADRs, audit reports, parity manifests, refactor checkpoints), and the desktop preservation discipline is real (no `console.*` violations in the new code, refactor pinned by tests, env-gated extensions, Electron-leak gate). This is not a careless first attempt — it is a substantial body of work that took the existing codebase seriously.

The problems are:

1. **Scope** — the contributor is shipping their Charité deployment alongside the upstream feature. That's a downstream concern that ADR 0001 already named.
2. **Threat-model gap** — the deployment is framed as "intranet-only with test data" and the security defaults match that level, but the actual artifact (public GHCR image, worldwide SSH default, public ACME, default-creds Dozzle) is internet-grade. The threat model needs to match the artifact.
3. **Per-handler implementation drift** — the seam is right at the framework level, but several specific Postgres handlers (transcripts, panels, annotations, variants:search) hand-roll workflows that diverge from desktop SQLite behavior. The handler-seam test was relaxed to allow this drift to land.
4. **Single-user / multi-user honesty** — multi-user is built as foundation but not active. The PR description and deploy docs should say "single-user pilot, Stage 2 multi-user is follow-up" loudly.
5. **One genuine convention break** — `IpcResult` contract on the web boundary.

A productive next step is a conversation with Robin about:

- Splitting the PR (preserves the work, doesn't reject it).
- Moving `web-deploy/` to a sibling repo per ADR 0001.
- The five blocking security items and the four parity bugs as a Stage 1.5 follow-up before any non-synthetic data.
- Whether they want to maintain the web track upstream long-term (the `upstream-sync-check.yml` suggests they may be thinking of running their fork as the integration point — that's a separate governance conversation).

Until these steps land, PR #202 should not become the mainline foundation for hosted VarLens.

---

## Sources

- Five independent agent reviews in `/tmp/pr202-review/`:
  - `01-architecture.md` — Strategic architecture & three-mode alignment
  - `02-security.md` — Security review of web exposure & deployment
  - `03-code-quality.md` — Convention adherence vs `AGENTS.md`
  - `04-desktop-risk.md` — Electron regression risk audit
  - `05-tests-ci-maintenance.md` — Test coverage, CI, ongoing burden
- PR diff: `gh pr diff 202`
- PR worktree at review time: `/tmp/varlens-pr202` (branch `pr-202`, head `e7c0b013`)
- Earlier strategy pass: this document's prior version (2026-05-20 morning), preserved in git history.
