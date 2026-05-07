# Phase 3 execution plan — complete web app over the internet

Status: live (2026-05-07)
Branch: `VarLens-Web`
Source: `.planning/web/spec/konzept/app.html` §app2.1 — "Argon2 login
works in the browser; multiple users can work in parallel" + "Import,
filtering, and analysis of variant data work in the browser. Core
functionality is preserved."
Companion: [`phase2-execution-plan.md`](phase2-execution-plan.md)
(backend), [`phase2-followups.md`](phase2-followups.md) (carried items)

Phases 1+2 delivered the backend (Postgres, REST API, auth service,
deploy stack). Phase 3 closes the spec by serving the actual Vue
frontend in a browser — the same SPA you see in `make dev`,
running over HTTP against the Phase 2 API.

## Constraint: no modification of non-robspan code

Phase 3 must not modify upstream-Bernt code (`src/renderer/`,
`src/preload/`, `src/main/ipc/handlers/`, `src/main/services/`,
`src/shared/ipc/`). All Phase 3 code lives under `src/web/` plus
build-config additions.

The renderer source is consumed unchanged. The HTTP transport is
injected at the **build boundary** (a new web entry HTML + a shim
that assigns to `window.api` before Vue boots), not by editing Vue
components. Where this constraint genuinely cannot hold, the
"Where touching upstream is unavoidable" section below documents it
explicitly — those carve-outs are themselves Phase 3 deliverables.

## What runs in the browser

The same `src/renderer/` Vue 3 + Vuetify SPA, compiled to vanilla
JS via a new entry point. No Electron, no preload bridge in the
container. The `window.api` object is provided by the HTTP shim
at page-load time before the Vue app boots; from the renderer's
perspective the call shape is unchanged.

```
DESKTOP (Electron)              WEB (browser)
src/renderer/ Vue SPA           src/renderer/ Vue SPA   ← same code
  ↓                               ↓
window.api.cases.list()         window.api.cases.list()
  ↓                               ↓
src/preload/ contextBridge      src/web/api-shim/ (NEW)
  ↓                               ↓
Electron IPC                    fetch('/api/cases/list')
  ↓                               ↓
src/main/ipc/handlers/cases-logic   src/main/ipc/handlers/cases-logic   ← same handler-seam
  ↓                               ↓
SqliteStorageSession            PostgresStorageSession (Phase 2)
```

## Scope (eight deliverables)

| # | Deliverable | Code location | Test goes red first | Test goes green when |
|---|---|---|---|---|
| 1 | HTTP shim — generated `window.api` mirror from `src/shared/ipc/domains/` types | `src/web/api-shim/` (new) + `scripts/web/generate-api-shim.mjs` | new `tests/web-gate/api-shim-surface.test.ts` asserts every preload domain has a matching shim entry | generator runs in `npm run build:web` and shim covers all ~33 domains |
| 2 | Domain routes — wrap each `*-logic.ts` in `src/main/ipc/handlers/` for the missing domains (Phase 1 had cases, auth, variants only) | `src/web/routes/<domain>.ts` (new files) | new `tests/web-gate/route-surface.test.ts` asserts every shim domain has a matching route | every shim call has an HTTP endpoint |
| 3 | Sessions — `@fastify/cookie` + `@fastify/session` (Postgres-backed store) | `src/web/sessions.ts` (new), `src/web/server.ts` integration | new `tests/main/web/sessions.test.ts` asserts login issues a Set-Cookie and session round-trips | `/api/auth/login` issues cookie, `/api/auth/logout` clears it |
| 4 | Route auth — `preHandler` requiring valid session on every non-`/api/auth/login`, non-`/healthz` route | `src/web/server.ts` (extend) | new `tests/main/web/route-auth.test.ts` asserts `/api/cases/list` returns 401 without session, 200 with | every protected route 401s without session |
| 5 | Web entry — new `src/web/public/web-entry.html` + bootstrap script that injects shim + imports renderer's `main.ts` | `src/web/public/web-entry.html`, `src/web/public/bootstrap.ts` (new) | new build-time test asserts `out/web/public/index.html` exists with a `<script>` referencing the bootstrap bundle | `npm run build:web` produces a runnable browser bundle |
| 6 | Vite config — `vite.web.config.ts` extends to also build the renderer with the web entry, output to `out/web/public/` | `vite.web.config.ts` (extend) | new `tests/web-gate/web-build-output.test.ts` asserts both `out/web/server.cjs` and `out/web/public/index.html` exist after build | one `npm run build:web` produces server + SPA |
| 7 | Static + SPA-fallback serving — `@fastify/static` serving `out/web/public/`, SPA fallback for any non-`/api/*` path | `src/web/server.ts` (extend) | new `tests/main/web/static-serving.test.ts` asserts `GET /varlens/foo/bar` returns the SPA `index.html` | browser-side routing works |
| 8 | End-to-end Playwright — boots web container, opens browser, logs in as bootstrapped admin, asserts cases list renders | `tests/e2e/web-app.e2e.ts` (new), gated by `VARLENS_RUN_WEB_E2E=1` | the test doesn't exist | login round-trip + cases list rendered in real Chromium |

## Order of work

Test-first, one deliverable per commit, each commit independently
revertable. Same QA wave (10 reviewers, 3+ consensus) per step.

1. **#1 + #2** ship together — the shim and the routes are two
   sides of the same surface. Generator runs; routes follow the
   IPC-contract module list. Every domain Bernt added to
   `src/shared/ipc/domains/` gets a route + shim entry by code-gen.
2. **#3 + #4** ship together — sessions without route-auth is a
   half-state where cookies exist but don't gate anything.
3. **#5 + #6** ship together — entry HTML and the build pipeline
   that consumes it must converge in one commit.
4. **#7** — static serving turns the build output into a real page.
5. **#8** — Playwright proves the whole stack from browser ↔ Postgres.

## Out of scope (Phase 3)

- **OIDC / federated identity.** Phase 2 plan §"Out of scope" still
  applies. Phase 3 ships browser sessions backed by the existing
  username/password flow.
- **Per-tenant data isolation.** ADR-0003 / `user-id-schema`
  sentinel. Phase 3 ships single-tenant; multi-user isolation is
  Stage 4.
- **Renderer feature changes.** No Vue components edited. If the
  renderer calls a desktop-only feature (file dialog, system tray)
  the shim returns a documented no-op or browser-equivalent (HTML
  `<input type=file>` for file dialogs); the component code is
  untouched.
- **PWA / offline.** Service worker, IndexedDB caching — not part
  of the §app2.1 spec. Future work.

## Where touching upstream is unavoidable

The constraint is "do not modify non-robspan code." Three concrete
boundaries where the constraint cannot hold; each documented with
the minimum diff and the reason.

1. **CSP in `src/renderer/index.html`.** The current Content
   Security Policy is `default-src 'self'`. The Phase 3 web entry
   needs to load the renderer JS bundle (same-origin — fine) and
   the shim script (same-origin — fine). However, **the shim
   POSTs to `/api/*` on the same origin** which CSP allows by
   default. **No change needed.** If a future requirement adds a
   different-origin API host, `connect-src` would need editing.
   Documented here so the next reviewer doesn't get surprised.

2. **Renderer entry HTML reference.** The renderer's `index.html`
   contains `<script src="./src/main.ts">`. We will not edit it.
   Phase 3 ships its own `web-entry.html` under `src/web/public/`
   that imports `./src/renderer/src/main.ts` after the shim is
   installed. Vite resolves the relative import; the renderer
   source is consumed as a library, not as a page entry.

3. **Renderer assumptions about Electron globals.** If any
   renderer module imports `electron` directly at module top
   level (audit needed in deliverable #1), vite must be configured
   to alias those imports to a stub for the web build. The stub
   lives under `src/web/stubs/` (precedent: Phase 1's
   `main-logger-stub.ts`). **This is a build-config carve-out, not
   a renderer source modification.** If the renderer accesses
   `process.platform` / `__dirname` / etc., the shim's bootstrap
   script can shim those globals on `window` before Vue boots.

If a renderer code path proves to need a behavioural change to
work in browser (not just an alias or a window-global shim),
Phase 3 documents it in `phase3-known-limitations.md` with a
proposed upstream PR. We do not silently edit it.

## Risks

- **Shim surface drift.** The generator must run on every CI
  build; if a contributor adds a new IPC domain on the desktop
  side and forgets to regenerate, the web build silently misses
  the new domain. Mitigation: deliverable #1's surface test reads
  both the IPC contracts AND the generated shim, asserts equality.
- **Renderer expectations beyond `window.api`.** Anything the
  renderer reads from `process.env`, `import.meta.env`,
  `localStorage` keys named after Electron, etc. needs the
  bootstrap shim to provide a stand-in.
- **Bundle size.** The renderer bundle includes `pdbe-molstar`,
  Vuetify icons, etc. — likely 5–15 MB. Acceptable for a clinical
  intranet pilot; Caddy gzip middleware is already enabled. Flag
  if it crosses 30 MB.
- **CSRF.** Cookie sessions need a CSRF token on state-changing
  routes. Deliverable #4 includes `@fastify/csrf-protection` or
  equivalent.

## Exit criteria

```
make ci                                            # desktop unaffected
VARLENS_WEB=1 make ci                              # web suite green
VARLENS_RUN_POSTGRES_E2E=1 make pg-up && \
  VARLENS_RUN_POSTGRES_E2E=1 make ci               # Postgres-flavour tests green
make pilot                                         # cold-start succeeds
                                                   # browser at https://<ip>/varlens/ shows login
                                                   # admin logs in, sees cases list
VARLENS_RUN_WEB_E2E=1 npx playwright test \
  tests/e2e/web-app.e2e.ts                         # full browser flow green
```

## Cross-references

- `decision-postgres-as-web-backend.md` — the backend (Phase 2)
- `phase2-execution-plan.md` — the API the shim posts to
- `phase2-followups.md` — sessions+route-auth promised here are the
  follow-ups Phase 2 deferred
- `tests/web-gate/handler-seam.test.ts` — already enforces "web
  routes reuse main IPC handlers"; deliverable #2's new routes
  must satisfy this gate
- `src/shared/ipc/domains/` — the source of truth for the shim
  generator (deliverable #1)
