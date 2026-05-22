# Phase 1 — QA report

Date: 2026-05-04
Branch: `VarLens-Web`
Range audited: `99ed5c2..HEAD` (10 commits, 27 files, +1,238 / −107 lines)

---

## TL;DR

**Status: green.** All claimed work verified end-to-end. No regressions introduced. Two stale docblocks corrected during the audit.

| Question | Answer |
|---|---|
| Does default `make ci` pass? | ✅ 3561/3590, 0 failures |
| Does `VARLENS_WEB=1 make ci` pass? | ✅ 3582/3612, 0 failures (1 expected-fail = visible per-tenant backlog) |
| Does the web build produce a runnable binary? | ✅ `out/web/server.cjs` (338 KB) builds in <200ms |
| Does the binary actually serve traffic? | ✅ `/healthz`, `/api/cases`, `/api/auth/login` all answer correctly |
| Does SIGTERM exit cleanly? | ✅ exit code 0, in-flight requests complete |
| Are logs JSON-only? | ✅ verified by `tests/web-gate/integration/json-logs.test.ts` and by manual probe |
| Do all the structural gates that flipped from red→green stay green? | ✅ `auth-isolation`, `db-seam`, `handler-seam` all pass |
| Are claimed test snapshots still in sync? | ✅ refactor-checkpoint snapshots match (no drift); parity snapshot matches |
| Any TODO/FIXME left in new code? | ✅ none |
| Any forbidden patterns (console.log, direct argon2 outside providers)? | ✅ none |

**Overall verdict:** the work delivered matches the commits' claims. Phase 1 structural completion is real, not paper.

---

## Detailed findings

### A. Test gates (verified by run, not by claim)

| Gate | Result | Notes |
|---|---|---|
| `make ci` | 3561 passed / 29 skipped / 0 failed | 13.65s |
| `VARLENS_WEB=1 make ci` | 3582 passed / 29 skipped / 1 expected-fail / 0 failed | 17.36s |
| `make web-gate-static` | 21 passed / 1 expected-fail across 10 files | 2.42s |
| `make web-gate-integration` | 5/5 passed across 4 files | 428ms |
| `tests/refactor-checkpoint/` | 2/2 passed | 1.42s; snapshots stable |
| `tests/main/storage/storage-session-contract.test.ts` | 7/7 passed (Postgres half skipped without `VARLENS_RUN_POSTGRES_E2E=1`) | 381ms |

The 1 expected-fail in web mode is `tests/web-gate/user-id-schema.test.ts` — the visible backlog tracking which domain tables still need `user_id NOT NULL DEFAULT 1`. Intentionally red until table-by-table migration completes (Stage 2).

### B. Build & runtime smoke

A clean rebuild from scratch (`rm -rf out/web && npm run build:web`) produced a working server in 181ms. Direct execution (`VARLENS_WEB_PORT=18080 node out/web/server.cjs`) showed:

| Probe | Response | Verdict |
|---|---|---|
| `GET /healthz` | `200` + `{"status":"ok","version":"0.59.0","db":{"open":true}}` | ✅ |
| `GET /api/cases` | `200` + `[]` | ✅ |
| `POST /api/auth/login` (empty body) | `400` + `{"error":"username and password (string) required"}` | ✅ |
| `SIGTERM` | exit 0, "shutting down" logged | ✅ |
| Log output | every line valid JSON with `level`/`time`/`pid`/`hostname`/`msg` | ✅ |

### C. Code-level guards

- **No `console.*` in new src/** — verified via `grep "console\\." src/web/ src/main/auth/`. Clean.
- **`@node-rs/argon2` import location** — present *only* in `src/main/auth/providers/argon2-provider.ts`. `AuthService.ts` consumes via the `PasswordProvider` interface. Enforced by `auth-isolation` web-gate test.
- **`StorageSession` interface** — declares no `getDatabaseService()` or `getDbPool()`. Removed in commit `e641da9`. Concrete `SqliteStorageSession` keeps them; consumers type-narrow on `capabilities.backend` before calling. Enforced by `db-seam` web-gate test.
- **Web routes vs. handler-seam** — all three web routes import from `src/main/ipc/handlers/<domain>-logic`:
  - `cases.ts` → `cases-logic`
  - `auth.ts` → `auth-logic`
  - `variants.ts` → `variants-logic`
  - Enforced by `handler-seam` web-gate test (now an active assertion, not a stub).

### D. Cross-references

- No dangling `.planning/web/phase1-gate-tests.md` references (all rewritten to `.planning/web/04-testing/desktop-to-web-parity.md` earlier in the day).
- Memory entries point to current paths.

### E. Defects found and fixed during the audit

Two stale docblocks were correcting during this QA pass — they still described the pre-refactor state ("test.fails today", "currently FAILS") even though the code had been flipped to active assertions:

- `tests/web-gate/auth-isolation.test.ts` lines 4–14 — rewritten to describe the sealed state.
- `tests/web-gate/db-seam.test.ts` lines 4–28 — rewritten to describe the sealed-interface assertion.

Comment-only changes; no behavioral impact. Tests still 6/6 green after the edit.

### F. Commit-by-commit verification

| Commit | Claim | Verified |
|---|---|---|
| `99ed5c2` | Phase 1 execution plan added (additive, ~70 lines) | ✅ exists, 70 lines, references web readiness planning |
| `a8feccf` | Web build target with healthz, JSON logs, SIGTERM | ✅ build works, all 4 integration tests pass |
| `9381f13` | `cases` route via handler-seam | ✅ route serves `[]` on fresh DB; handler-seam test enforces import |
| `16cf3ea` | Argon2 behind `PasswordProvider`; auth-isolation green | ✅ `AuthService` clean of direct argon2; 61 existing auth tests still green |
| `0c1f35c` | ADRs 0001–0003 filed | ✅ three short ADR files + index README |
| `516d731` | `auth` + `variants` routes wired | ✅ 3 routes live; handler-seam validates all three |
| `e641da9` | `StorageSession` interface seal | ✅ interface no longer declares escape hatches; type-check passes; postgres-storage-session test updated to drop the gone-stub assertions |
| `6372252` | Plan status update | ✅ matches actual state |
| `ab06b96` | Prettier auto-format | ✅ `make format-check` clean |
| `dff8518` | Honest exit-criteria | ✅ matches the verified state |

### G. What's NOT covered by this audit

These items are intentionally out of scope:

- **Postgres E2E behavioral verification.** The `postgres-migrations-idempotent` test exists but I didn't spin up the dev container during this QA. The test's structure was reviewed; it requires `make pg-up` + `VARLENS_RUN_POSTGRES_E2E=1` to actually run.
- **`web-gate-parity`** (the Electron-boot parity scenario). Verified earlier in the PR by Agent A's run; not re-run here because rebuilding the native module for Electron ABI takes minutes and would have to be undone afterwards.
- **Multi-OS packaging.** Phase 1 builds web on Linux only by design (per the web readiness plan).

### H. Open follow-ups (not blockers, but worth noting)

| Item | Severity | Action |
|---|---|---|
| `tests/web-gate/user-id-schema.test.ts` expected-fail sentinel | Low (intentional backlog) | Shrinks as tables get migrated for Stage 2; not Phase 1 work |
| `auth-scenarios.parity.test.ts` 4 placeholders all `describe.skip` | Low (intentional deferred) | Each flips skip→live in the PR that implements its session/cookie/expiry handling |
| `db-seam` allowlist of legacy importers | Low | Trends toward empty as the migration of remaining IPC domains continues; no hard deadline |
| Postgres backend integration in `src/web/server.ts` | Medium (Stage 1.5) | Server currently builds a SQLite session; switching to Postgres-by-default needs env-driven config wiring + test |

None of these block Phase 1 structural completion.

---

## Conclusion

The work landed in this PR matches its claims. The web build is real and runnable. The auth abstraction is properly isolated. The StorageSession interface is sealed. All structural gates are green. Snapshots are stable. No console pollution, no forbidden imports, no dangling cross-references.

Two stale docblocks were corrected during the audit; that change is committed alongside this report.

**Phase 1 structural completion is verified.**
