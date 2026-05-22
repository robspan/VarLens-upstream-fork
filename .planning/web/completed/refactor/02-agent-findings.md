# Multi-Agent Findings

Four read-only explorers audited the branch on 2026-05-12. Their combined result changes the cleanup priority: before adding broad parity assertions, the web layer needs an explicit adapter/contract pass. The current generic RPC shape is too permissive and does not reliably mirror preload behavior.

## Cross-Cutting Blockers

1. **Generic web RPC is not equivalent to desktop preload adapters.**
   `src/web/client/api.ts` forwards raw method args to `POST /api/:domain/:method`, while desktop preload/main handlers often validate and transform arguments before reaching storage.

2. **Unsupported web RPCs can look successful in the renderer.**
   The web client parses JSON even on non-2xx responses. The dispatcher returns plain `{ error: ... }` bodies for 401/403/404 cases. Renderer code that expects `IpcResult`/`SerializableError` can treat these as successful data.

3. **Web import is not implemented.**
   There is no `import:*` or `batch-import:*` web surface. Renderer import flows still rely on Electron file dialogs, absolute paths, and Electron's nonstandard `File.path`.

4. **Behavioral parity is not yet proven.**
   Current parity tests include structural/source checks and placeholders. The import/filter web half does not import or query through web. Auth parity misses routed HTTP behavior.

5. **Opt-in web CI/release can be green while skipping web behavior.**
   It is correct that default desktop CI does not provision web dependencies. The gap is that `VARLENS_WEB=1 make ci` and root web release/publish workflows do not currently provide a reliable, fail-loud web lane.

6. **Session/security behavior needs a web-specific hardening pass.**
   Existing web cookies can remain valid after user deactivation or password reset. Auth-management service methods exist but are not routed over HTTP. `auth:isAccountsEnabled` is hardcoded `true`.

7. **Renderer exposes desktop-only UI/API surfaces in web mode.**
   Database picker/actions, file import/export, updater, logs, several enrichment/reference workflows, and all `on*` event subscriptions need implementation, capability gating, or documented accepted divergence.

8. **Deploy/docs drift includes an operational security mismatch.**
   External deploy documentation recommends hash-based admin bootstrap, but the app container must receive `VARLENS_ADMIN_PASSWORD_HASH`.

## Agent A - API, Import, Export

- Critical: `import:*` and `batch-import:*` are absent from web.
- Critical: generic RPC argument passthrough breaks parity for `variants.query` and other adapted IPC methods.
- High: `export:*` is incorrectly listed as read tasks; browser export needs download endpoints.
- High: browser file workflows still assume local filesystem paths.
- High: method names in renderer/preload do not consistently match storage task names.
- Medium: current import/filter parity web assertions are placeholders and stale route shape.
- Medium: event parity is absent because all web `on*` methods are no-ops.

Recommended first steps:

- Add a web RPC adapter layer that mirrors preload mappings and performs validation/argument conversion before storage executor calls.
- Implement web import explicitly under `src/web/server/`.
- Define the web file model once: browser upload/staged file IDs, or explicit server-local test/operator mode.
- Replace export autoroute with browser download endpoints.

## Agent B - Auth, Session, Security

- High: stale web sessions survive DB auth-state changes.
- High: auth-management parity is missing at HTTP layer (`createUser`, `listUsers`, `deactivateUser`, `resetPassword`).
- Medium: `auth:isAccountsEnabled` always returns `true` in web mode.
- Medium: auth/session errors are not desktop-compatible `IpcResult`/`SerializableError` shapes.
- Medium: source-grep auth parity tests give false confidence.
- Medium: authenticated writes rely on `SameSite=Strict` but lack explicit Origin/CSRF protection.
- Low/Medium: session secret validation should require exactly 64 hex chars and validate file mode.

Recommended first steps:

- Revalidate session users server-side by id on authenticated requests.
- Add web auth overrides mirroring desktop role checks.
- Route `auth:isAccountsEnabled` through the service.
- Normalize non-2xx web RPC errors.
- Add Origin/CSRF protection for state-changing `/api/*` calls.

## Agent C - CI, Build, Deploy

- High: opt-in web integration can pass while mostly skipped.
- High: no root GitHub PR lane validates web behavior before image publish/deploy.
- High: web-only path changes can skip existing desktop CI by design; they need a separate web workflow/path filter.
- Medium: Makefile lacks canonical opt-in web commands (`build-web`, `web-ci`, docker smoke).
- Medium: Docker build proves bundle load, not deploy/runtime behavior.
- Medium: deploy/operator CI does not belong in the app repo workflow.

Recommended first steps:

- Add `make web-ci` / `npm run ci:web` as an opt-in fail-loud lane.
- Add a root `web-ci.yml` on web paths.
- Require web CI before `publish-web`.
- Add built-image + Postgres compose smoke before push/deploy.

## Agent D - Renderer, Events, Docs

- High: non-2xx web RPCs can become successful renderer data.
- High: import/batch import remains Electron-path based.
- High: database picker exposes desktop database management in web app.
- Medium: renderer event subscriptions are no-op in web mode.
- Medium: many non-import renderer features call APIs absent from web dispatcher.
- High: compose env wiring does not pass `VARLENS_ADMIN_PASSWORD_HASH`.
- Medium: deployment docs still describe obsolete SQLite/default-profile behavior.
- Medium: web-gate README and parity comments are stale.

Recommended first steps:

- Make `httpInvoke` reject non-2xx or normalize dispatcher errors to canonical shapes.
- Gate or implement desktop database picker/actions in web.
- Inventory every no-op `on*` subscription and decide implementation vs accepted divergence.
- Pass `VARLENS_ADMIN_PASSWORD_HASH` through compose.
- Rewrite operator docs around Postgres-only web.
