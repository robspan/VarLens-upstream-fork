# Phase 1 Gate Test Suite

Status: proposal (2026-05-04)
Branch target: `VarLens-Web`
Source plan: `VarLens-IaC/.internalplanning/konzept/app.html` §app2.1

## Purpose

Turn the 12 Phase 1 gate criteria into an executable test suite **before** any web code is written. The suite is the finish line: when every gate test is green on both Electron and the web build, Phase 1 is done. Until then, every red test names concrete remaining work.

## Guiding principle

Do what's needed, not more. The repo already has 290 test files. This suite adds only what makes Phase 1 falsifiable.

**Desktop is the default mode; web is opt-in.** VarLens ships to clinicians and researchers as a desktop app. The web variant is set up once by a developer/operator (Charité internal IT in our specific case). The gate suite reflects that asymmetry: a desktop-only contribution must never be blocked by a web-gate failure. Concretely, web-gate tests do **not** run during default `make ci` or `npm run test` — only via `npm run test:web-gate` / `make web-gate-*`. Desktop researchers can ship new IPC handlers, new tables, etc. without thinking about web parity. The web-track contributor is responsible for keeping web in sync, or accepting divergence via the allowlists (web ships with fewer features than desktop, by explicit choice).

**Forcing function — rule of three.** No abstraction (BackendDriver, normalize registry, snapshot framework) is extracted until the third scenario duplicates it. Until then, copy-paste.

## Layer 1 — Static gates (build today, no web code needed)

These are the highest-leverage tests. They make the Phase 1 backlog visible: every red test is a concrete refactor target.

| File | Mechanism | What it pins |
|---|---|---|
| `tests/web-gate/db-seam.test.ts` | ts-morph scan | No `getDatabaseService` / `getDbPool` calls outside `src/main/storage/session.ts`. Allowlist is a literal `Set`; escape hatch via `// gate-allow: db-seam — reason`. **Will be red on day one — that's the point.** |
| `tests/web-gate/auth-isolation.test.ts` | ts-morph scan | No `argon2` / `bcrypt` / `jsonwebtoken` imports outside `src/main/auth/providers/**`. Forces the auth abstraction. |
| `tests/web-gate/user-id-schema.test.ts` | `PRAGMA table_info` against a freshly-migrated tmp DB | Every domain table has `user_id NOT NULL DEFAULT 1`. Explicit allowlist for `schema_migrations`, reference data, junction tables. |
| `tests/web-gate/electron-leak.test.ts` | grep | No `electron` / `BrowserWindow` / `ipcRenderer` in `src/shared/` (and in `src/web/` once it exists). |
| `tests/web-gate/audit-shape.test.ts` | column-name subset check | `audit_log` columns are a subset of the Stage 2 vocabulary `{id, ts, user_id, action, entity, entity_id, pre_state, post_state, ip, user_agent}`. Cheap insurance against a future migration that names fields incompatibly. |
| `tests/web-gate/handler-seam.test.ts` | ts-morph + path resolution | Every domain module in `src/shared/ipc/domains/<name>.ts` has a matching main handler in `src/main/ipc/domains/<name>.ts`. **Once `src/web/` exists**, also asserts every Fastify route imports the *exact same handler function* (not a copy, not a re-implementation). Encodes "the IPC contract layer is the natural seam" as code, not folklore. Forward-compatible: skip-if-missing on the web-side check. |

The existing `tests/shared/types/preload-contract.test.ts` already locks `IpcResult<T>`. **Don't duplicate it.**

Use ts-morph from Vitest. Promote to a custom ESLint rule only if false positives become a real problem.

## Layer 2 — Web-only integration tests (red until Fastify lands)

All four are wrapped in `test.skipIf(!existsSync('out/web/server.cjs'))` so they're inert today and automatically activate the moment the web build target ships. **Electron-side regressions still go red** because Layer 1 and Layer 3 (Electron path) run unconditionally.

| File | Mechanism |
|---|---|
| `tests/web-gate/integration/healthz.test.ts` | `fastify.inject({ method:'GET', url:'/healthz' })` — 200 + `{status, version, db}` |
| `tests/web-gate/integration/migrations-idempotent.test.ts` | Boot `buildApp()` twice on the same tmp file; compare `sqlite_master` dump byte-for-byte and `PRAGMA user_version` |
| `tests/web-gate/integration/json-logs.test.ts` | Capture stdout, every line parses as JSON with `level` / `time` / `msg` |
| `tests/web-gate/integration/sigterm.test.ts` | `child_process.fork()` real listener, hold a request open with a delayed handler, send `SIGTERM`, assert exit 0 ≤ 5s and in-flight 200. **The only flake-prone test — isolate it.** |

Use `fastify.inject()` for everything except SIGTERM. No real ports, no async teardown races.

## Layer 3 — One parity test (inlined, no driver abstraction yet)

```
tests/web-gate/parity/import-and-filter.test.ts
```

Single end-to-end scenario: import `tests/test-data/vcf/giab-chinese-trio-chr22.vcf`, run 3 filter queries, assert identical results from the Electron path and the web path. **Both transports inlined in one file.** No `BackendDriver`, no `normalize()`, no snapshots.

Equivalence assertion: row counts equal, plus the first 10 rows ordered by `(chrom, pos, ref, alt, sample_id)` deep-equal after stripping `id`, `created_at`, `imported_at`, `source_file → basename`. Six lines of normalization, inline.

Until this scenario is green on Electron alone, no other parity work matters. Until it's green on web, Phase 1 isn't done.

### Named-but-deferred Layer 3 scenarios

Two scenarios are *named* now (so they're not forgotten) but follow the rule-of-three deferral on the `BackendDriver` abstraction. Both target load-bearing flows the import-and-filter scenario does not exercise.

| File | Why it can't be skipped long-term |
|---|---|
| `tests/web-gate/parity/read-concurrency.parity.test.ts` | Better-sqlite3's synchronous API is the reason `dbPoolManager.ts` exists. Under Fastify, every concurrent HTTP request wants a read; the pool either scales or serializes. Serial-query parity is silent on this. Scenario: N=10 concurrent filter queries from independent clients return identical, complete result sets on both backends, with no pool exhaustion. |
| `tests/web-gate/parity/export-roundtrip.parity.test.ts` | Export is a different transport profile than query — streamed bytes vs JSON, file path vs HTTP body. The most likely place for Phase 1 to silently break. Scenario: export filtered variants, re-import, assert canonical content hash of the resulting DB matches across backends. |

These land *after* the import-and-filter scenario goes green on web. They are the trigger for extracting the `BackendDriver` abstraction.

## What we defer (until something demands it)

| Deferred | Trigger to build |
|---|---|
| `BackendDriver` interface, `ElectronDriver`, `WebDriver` | 3rd parity scenario |
| `normalize()` registry / golden snapshots | 5th parity scenario, or first scenario where inline masking exceeds ~10 lines |
| Mutation canary / mask-budget meta-tests | Whenever snapshots exist |
| ESLint custom rules | Ts-morph false-positive count > 3 in a month |
| Cross-OS CI matrix for the gate | Release tag only; Linux on every PR |
| Sticky PR comment with N/12 | When the gate has 5+ green criteria worth showing off |
| Sharding / parallel Playwright workers | Suite runtime > 90s |
| Per-criterion CI status checks | Never — single composite check, drill down via artifact |
| Auth parity scenarios (success, lockout, multi-user, expiry, etc.) | After Layer 3 lands and web auth path exists |
| Postgres-readiness lints (AUTOINCREMENT, etc.) | Only when Stage 2 starts |

## Bridge-Clause type bets — cheap, do them now

Two type-shape decisions that cost nothing today and prevent expensive retrofits:

1. **`Credential` is a discriminated union from day one**: `{kind:'password', ...} | {kind:'token', jwt: string}`. Phase 1 only implements the `password` arm; `token` throws `NotImplemented`. Every call site already destructures by `kind`, so OIDC lands without touching service code.
2. **Decide ULID vs INTEGER PK now.** Rowid IDs leak creation order (a §203 side-channel for the Charité tenant) and break under any future federation. Switching from INTEGER to TEXT PK is trivial today and painful after Stage 2. **This is a team decision, not a test.** Track it as an ADR before the first parity scenario lands.

## Makefile additions

```make
web-gate-static      # ts-morph + schema introspection, <30s; opt-in (NOT in `make ci`)
web-gate-integration # fastify.inject tests, skipped until out/web/ exists
web-gate-parity      # the one scenario, Electron-only until web lands
web-gate             # = web-gate-static + web-gate-integration + web-gate-parity
web-gate-report      # writes .planning/artifacts/web-gate/summary.md (N/12, manual until annoying)
```

**The entire web-gate suite is opt-in.** Default `make ci` and `npm run test` filter projects to `main` + `renderer` only (see `package.json`'s `test` script). Web track contributors run `npm run test:web-gate` explicitly. CI mirroring: desktop checks job (existing) runs `make ci`; a future web-checks job would run `make web-gate-static` triggered on PRs labeled `web` or touching `tests/web-gate/` / `src/web/`. Linux only for PRs; matrix only on release tags.

## Anti-patterns to refuse upfront

- **No retries on parity flakes.** A retried parity test hides the exact race conditions this suite exists to catch. Quarantine to a non-blocking target, fix root cause, promote back.
- **No `if (driver.kind === 'electron')` branches in scenarios.** If behavior differs by transport, it's not a parity scenario — it's a transport-specific test.
- **No snapshot updates and normalization changes in the same PR.** Forces small, reviewable diffs.
- **Don't gate on coverage in this suite.** Coverage is a separate signal.
- **Don't share parity fixtures with existing E2E.** Parity fixtures must be reset per scenario.

## Mapping to the 12 Phase 1 gate criteria

| §app2.1 criterion | Covered by |
|---|---|
| Web container starts without Electron deps | `web-gate/electron-leak.test.ts` + `web-gate/integration/healthz.test.ts` |
| Migrations run idempotently at startup | `web-gate/integration/migrations-idempotent.test.ts` |
| `/healthz` returns 200 and 503 correctly | `web-gate/integration/healthz.test.ts` |
| Argon2 login works in browser; multi-user | Layer 3 expansion (deferred — first auth scenario after import-and-filter is green on web) |
| Import, filtering, analysis preserved | `web-gate/parity/import-and-filter.test.ts` |
| Services use repository interface only | `web-gate/db-seam.test.ts` |
| Electron variant builds without regression | Existing `make ci-full` |
| Logs are JSON to stdout | `web-gate/integration/json-logs.test.ts` |
| SIGTERM clean shutdown | `web-gate/integration/sigterm.test.ts` |
| ADRs 1, 2, 3 filed | Documentation gate, not a test |
| §bewertung1 / §bewertung3 current | Documentation gate, lives in IaC repo |
| Bridge Clause structural check | `web-gate/db-seam.test.ts` + `web-gate/auth-isolation.test.ts` + `web-gate/user-id-schema.test.ts` + `web-gate/handler-seam.test.ts` |

## Mapping to the data flows (per coworker analysis 2026-05-04)

VarLens has five flows: import (file → worker → DB), storage (StorageSession + read-pool), IPC three-layer contract, renderer (Pinia + composables), export (query → worker → file). Coverage check:

| Flow | Gate coverage | Notes |
|---|---|---|
| Import: file → worker → DB | Layer 3 import-and-filter scenario | SQLite path only; Postgres covered by existing perf benchmarks |
| Storage: StorageSession boundary | `web-gate/db-seam.test.ts` | Boundary pinned |
| Storage: read-pool concurrency | `read-concurrency.parity.test.ts` (named, deferred) | The load-bearing point: better-sqlite3 sync API + Piscina pool under HTTP concurrency |
| IPC three-layer contract | existing `preload-contract.test.ts` + new `handler-seam.test.ts` | Envelope locked; seam reuse enforced |
| Renderer: Pinia + composables | not gated | Shared code, not a parity dimension |
| Export: query → worker → file | `export-roundtrip.parity.test.ts` (named, deferred) | Different transport profile than query |
| Worker progress events | **not yet decided** — see open questions | Different transport in web (WS/SSE) vs Electron (IPC events) |

## First commit (concrete shopping list)

On a `feat/phase1-gate-tests` branch off `VarLens-Web`:

1. `tests/web-gate/db-seam.test.ts` — **expected to be RED**, that's the work backlog
2. `tests/web-gate/user-id-schema.test.ts` — likely red
3. `tests/web-gate/electron-leak.test.ts` — likely green
4. `tests/web-gate/auth-isolation.test.ts` — probably red
5. `tests/web-gate/audit-shape.test.ts` — green
6. `tests/web-gate/handler-seam.test.ts` — should be green on Electron side; web-side check skips until `src/web/` exists
7. Layer 2 web tests with `test.skipIf` guards (all skipped today)
8. `tests/web-gate/parity/import-and-filter.test.ts` — Electron side only, **must go green**
9. `Makefile` additions for `web-gate-static` / `web-gate-integration` / `web-gate-parity` / `gate`
10. This document committed at `.planning/web/phase1-gate-tests.md`

That commit sets the finish line. After that, every Phase 1 PR is judged by "does it move a red gate to green without regressing a green one."

## Open questions

- **ULID vs INTEGER PK** — needs an ADR before scenario #1 lands. Switching is trivial today, painful after Stage 2 (rowid IDs leak creation order, collide under per-tenant sharding, break federation/export).
- **Plan home** — the Phase 1 plan currently lives in `VarLens-IaC/.internalplanning/konzept/app.html`; the IaC plan itself flags a move to the app repo. Recommend mirroring its content into `.planning/web/phase1-plan.md` so this gate doc has a stable in-repo neighbour.
- **Auth provider interface shape** — not required for the gate on day one, but `web-gate/auth-isolation.test.ts` stays red until it exists. Sequence: provider interface → migrate Argon2 behind it → static test goes green → first auth parity scenario. Adopt `Credential = {kind:'password', ...} | {kind:'token', jwt:string}` from day one (`token` arm throws `NotImplemented`) so OIDC lands without touching call sites.
- **Progress events: parity-asserted or transport-specific?** Worker → renderer progress in Electron is `parentPort.postMessage()` → IPC event. In web it has to be WebSocket/SSE/long-poll. The *transport* differs by design, but the *observable sequence* (which events fire, in what order, with what payload shape) is user-visible (progress bars). Decide before the import scenario goes green on web:
  - **Option A — parity-asserted on payload sequence**: scenarios collect progress events from both backends and compare the normalized sequence (mask timestamps, mask sequence-id, sort by logical step). Strongest invariant; small extra cost in driver setup.
  - **Option B — transport-specific tests on each side**: Electron asserts IPC event sequence; web asserts WS frame sequence. Each verified independently against the same expected logical sequence captured as a fixture. Simpler driver, weaker invariant (drift between sides only caught at fixture-update time).
  - Recommendation: **Option A** once the `BackendDriver` exists; until then, document expected sequence as a fixture used by Electron tests today and web tests later. The decision belongs in an ADR before the read-concurrency scenario lands.
- **Postgres in the gate** — currently scoped out. Phase 1 gate is web-vs-Electron, not SQLite-vs-Postgres. If the chosen Phase 1 backend is Postgres (per §bewertung2 outcome), the import-and-filter scenario must run against Postgres; if SQLite, no change. Confirm with stakeholders before scenario #1.
