# Web Narrow Hardening Parallel Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Harden the current web pilot by removing server-local path imports,
failing closed on weak CSRF signals, documenting single-user mode, and pinning
the route override seam.

**Architecture:** This is a narrow defensive pass. It keeps the current web
dispatcher and route modules, but removes the dangerous server-path branch and
adds small, testable security helpers. A later PR can replace per-domain web
overrides with a shared transport-neutral handler object.

**Tech Stack:** Electron 40, Vue/Vuetify renderer, Fastify web server,
TypeScript strict mode, Vitest web-gate tests.

---

## File Structure

- Modify `src/web/server/auth.ts`: add Fetch Metadata CSRF helper and wire it
  into the existing `/api/*` preHandler.
- Modify `tests/web-gate/auth-origin.test.ts`: add helper coverage for Fetch
  Metadata and missing-signal rejection.
- Modify `tests/web-gate/integration/auth-gate.test.ts`: update integration
  expectation names if needed.
- Modify `src/web/server/routes/server-path-import.ts`: make server-path import
  always disabled in web mode.
- Modify `src/web/server/routes/import.ts`,
  `src/web/server/routes/batch-import.ts`, and
  `src/web/server/routes/region-files.ts`: keep upload-ref resolution, remove
  any raw absolute-path success path.
- Modify `tests/web-gate/dispatcher-adapters-auth-import.test.ts`: convert raw
  path success tests to staged upload-ref tests and assert raw paths always
  reject.
- Modify `tests/web-gate/dispatcher-adapters-assets-annotations-export.test.ts`:
  convert region-file success to staged upload-ref tests and assert raw paths
  always reject.
- Modify `tests/web-gate/handler-seam.test.ts`: pin the audited route override
  module set.
- Modify `tests/web-gate/user-id-schema.test.ts` and
  `.planning/web/completed/phase1-execution-plan.md`: state the single-user
  contract explicitly.

## Parallel Work Packages

### Package A: CSRF Gate Hardening

- [ ] Add failing tests in `tests/web-gate/auth-origin.test.ts` for
  `Sec-Fetch-Site: cross-site`, `none`, `same-origin`, `same-site`, missing
  Fetch Metadata plus valid Origin, and missing both signals.
- [ ] Implement a small helper in `src/web/server/auth.ts` that returns an
  allow/reject decision for unsafe API requests.
- [ ] Wire the helper into the existing preHandler.
- [ ] Run `npx vitest run --project web-gate tests/web-gate/auth-origin.test.ts`.

### Package B: Server-Path Removal

- [ ] Add failing tests that raw absolute paths reject even when `NODE_ENV=test`
  and even if `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT=1`.
- [ ] Convert web success-path tests to call `stageExistingFileUpload(...)` and
  pass the returned `web-upload:` ref.
- [ ] Make `serverPathImportDisabled()` always return `true` and update comments
  to say browser web mode uses uploads only.
- [ ] Run:
  `npx vitest run --project web-gate tests/web-gate/dispatcher-adapters-auth-import.test.ts tests/web-gate/dispatcher-adapters-assets-annotations-export.test.ts`.

### Package C: Single-User Contract

- [ ] Update `tests/web-gate/user-id-schema.test.ts` comments to remove
  obsolete "Phase 1 will fill them in" wording and state that row-level
  multi-user isolation is out of scope for the current web pilot.
- [ ] Update `.planning/web/completed/phase1-execution-plan.md` to keep
  `auth:createUser` disabled until row-level scoping exists.
- [ ] Run `npx vitest run --project web-gate tests/web-gate/user-id-schema.test.ts`.

### Package D: Override Seam Guard

- [ ] Add a static expected override module set to
  `tests/web-gate/handler-seam.test.ts`.
- [ ] Assert the discovered `build*Overrides` route modules equal that set.
- [ ] Run `npx vitest run --project web-gate tests/web-gate/handler-seam.test.ts`.

## Final Verification

- [ ] Run:
  `npx vitest run --project web-gate tests/web-gate/auth-origin.test.ts tests/web-gate/handler-seam.test.ts tests/web-gate/dispatcher-adapters-auth-import.test.ts tests/web-gate/dispatcher-adapters-assets-annotations-export.test.ts tests/web-gate/user-id-schema.test.ts`.
- [ ] Run `rg -n "VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT|server-path import is enabled|routes an enabled absolute server path" src`.
- [ ] Run `make agent-check` if authored source structure changed.
