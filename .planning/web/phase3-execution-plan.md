# Phase 3 execution plan — complete web app

Status: live (2026-05-07, rewritten)
Branch: `VarLens-Web`
Source: `.planning/web/spec/konzept/app.html` §app2.1 — "Argon2 login
works in the browser; multiple users can work in parallel" + "Import,
filtering, and analysis of variant data work in the browser."

Phase 2 delivered the Postgres backend + REST API. Phase 3 makes the
existing Vue 3 + Vuetify SPA usable in a browser by serving it from
the web container, sessioned, with HTTP transport replacing IPC.

## The boundary

One feature flag, set at build time:

```ts
import.meta.env.MODE === 'web'
```

Components are unchanged. They call `window.api.cases.list()`. The
only thing that differs between Electron and browser is **who installs
`window.api`**:

- Desktop: `src/preload/index.ts` (Electron contextBridge — unchanged)
- Web: `src/web/bootstrap.ts` (new — assigns the HTTP shim before
  the Vue app dynamic-imports)

Where a renderer file has a genuinely-different code path between
modes (file dialogs, system tray), it gets a one-site `if (web) {} else {}`
or a vite alias. Don't generalise speculatively.

## Order of work

1. **HTTP shim.** Hand-written, ~25 files under `src/web/api-shim/`,
   one per domain. Each implements its `*DomainContract` interface
   and calls a shared `httpInvoke` helper. TypeScript catches missing
   methods at compile time. No codegen, no regex parsers.
2. **Routes.** Hand-written `src/web/routes/<domain>.ts`, one per
   domain. Each delegates to `src/main/ipc/handlers/<domain>-logic.ts`.
   Where the `-logic.ts` file doesn't exist yet, **extract it** —
   that's a normal refactor (move handler body into a pure function,
   call it from both the Electron handler and the web route). Existing
   handler tests gate the extraction.
3. **Sessions + route auth.** `@fastify/cookie` + `@fastify/session`
   with a Postgres-backed store. `/api/auth/login` issues the cookie;
   a Fastify `preHandler` rejects un-sessioned requests with 401 on
   every `/api/*` path except `/api/auth/login` and `/healthz`.
4. **Web bootstrap + entry.** New `src/web/index.html` loads
   `src/web/bootstrap.ts`, which assigns `window.api = createApiShim()`
   then `await import('../renderer/src/main.ts')`. Order matters —
   Vue components read `window.api` synchronously during setup.
5. **Vite web build.** `vite.web.config.ts` builds both the server
   (existing) and the renderer with `mode: 'web'`, output to
   `out/web/server.cjs` + `out/web/public/`.
6. **Fastify static + SPA fallback.** `@fastify/static` serves
   `out/web/public/`; any non-`/api/*` non-`/healthz` GET falls back
   to `index.html` for client-side routing.
7. **End-to-end test.** Playwright (gated by `VARLENS_RUN_WEB_E2E=1`)
   boots the container, opens Chromium, logs in, asserts the cases
   list renders.

## Commits

Group naturally — no rule that each step is its own commit:
- (1) + (2) together where the route delegates work, plus per-domain
  extraction commits where `-logic.ts` is missing
- (3) + (4) together (sessions are useless without bootstrap)
- (5) + (6) together
- (7) standalone

## Out of scope

- OIDC. Username/password sessions only.
- Multi-user data isolation (per-tenant schema). ADR-0003 / Stage 4.
- Renderer feature changes. We may refactor at one site to add a
  feature-flag branch where genuinely needed; we do not redesign
  components.
- PWA / offline.

## Risks

- **Auth middleware ordering.** The `preHandler` must run BEFORE
  any route logic, and `/api/auth/login` itself must be exempt or
  the user can't authenticate.
- **Bootstrap import order.** `window.api` must exist before any
  Vue setup function runs. The dynamic-import-after-assignment
  pattern in `bootstrap.ts` is the load-bearing detail.
- **Renderer's Electron-specific imports.** If any `src/renderer/`
  module imports `electron` at module top level, the web build
  fails. Vite alias to a stub (precedent: `src/web/stubs/`).
- **CSRF.** Cookie sessions need a CSRF token on state-changing
  POSTs. `@fastify/csrf-protection` if it's clean; rolled-by-hand
  if not.
- **Bundle size.** `pdbe-molstar` + Vuetify icons → ~5–15 MB. Caddy
  gzip is on. Flag if over 30 MB.

## Exit criteria

```
make ci                                          # desktop unaffected
VARLENS_WEB=1 make ci                            # web suite green
make pilot                                       # cold-start succeeds
                                                 # browser at https://<ip>/varlens/ shows login
                                                 # admin logs in, sees cases
VARLENS_RUN_WEB_E2E=1 npx playwright test \
  tests/e2e/web-app.e2e.ts                       # full browser flow
```

## QA cadence

QA waves only on the parts where something can actually go wrong:

- After (3) + (4) — auth middleware + session is the security surface
- Final wave on the whole delivery once (1)–(7) lands

Mechanical things (writing 25 typed shim files, extracting `-logic.ts`)
don't need a QA round each — TypeScript and the existing tests are
the gate.
