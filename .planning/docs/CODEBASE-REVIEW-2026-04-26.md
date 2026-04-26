# VarLens Codebase Review (Current)

**Date:** 2026-04-26
**Branch:** `main`
**Head:** `184f361` (post-merge of PR #179, post-archive of postgres parity Phase 9 + 9.1 + 2026-04-22 review)
**Release:** v0.56.14 (tag `v0.56.14`, release workflow `24951885957` in flight at the time of writing)
**Baseline reviewed:** `.planning/archive/completed-docs/CODEBASE-REVIEW-2026-04-22.md` (final 2026-04-26 update appended for v0.56.14)
**Scope:** Current repository state after PostgreSQL parity Phase 9 + 9.1, planning archive cleanup, and the v0.56.14 cut. Compared against current 2026 best practices for the stack.

## Executive Summary

The 2026-04-22 review (with its cumulative 2026-04-23/24/26 updates) is now superseded.

VarLens has continued to mature along the same axes. The Phase 9 + 9.1 PostgreSQL VCF import work is the largest delta and lifts the codebase from "PostgreSQL reads work" to "VCF imports go through a hardened storage-session-routed worker thread on both backends, with WGS-scale fixtures inside a 1 GB heap budget on commodity hardware." The remaining strategic gaps are narrower and more clearly named than they were a week ago.

**Updated overall rating: 8.5 / 10** (up from 8.4)

The deltas since 2026-04-22 are all positive:

1. PostgreSQL VCF import has shipped on the storage-session boundary, with a dedicated `worker_threads` worker, structured cancellation, BED filtering, extension tables (SV/CNV/STR), and 10 Docker-gated Playwright E2E scenarios.
2. The HLA mega-allele btree crash is closed at the schema level by a stored generated `coord_hash BYTEA` column (sha256 of length-prefixed encoding) — the cryptographic shape is correct, IMMUTABLE-clean on PG-18, and indexed for both per-case lookups and frequency upserts.
3. WGS perf has moved from "OOMing at 64 GB" to "fits inside a 1 GB Node-heap budget" via per-batch commits and `mode: 'append'` on subsequent batches.
4. Worker lifecycle is hardened — `PostgresImportWorkerClient` now `terminate()`s on both `complete` and `error` (was leaking idle workers); `uncaughtException` / `unhandledRejection` post structured `error` messages back over `parentPort` instead of being swallowed.
5. Renderer / preload / shared remain on the same architectural slope as the prior review — no regressions, three composables drifted past 600 LOC and are flagged as future-refactor candidates rather than active defects.

The remaining work is the same shape it was on 2026-04-22 but smaller in surface area: pick the next renderer-perf phase from the existing harness, finish PostgreSQL parity for the non-import write/export/delete/rebuild/lifecycle domains, escalate the PostgreSQL VCF import path to `COPY FROM STDIN` (the WGS PG/SQLite ratio is 3.09×, above the 2× threshold the spec set as the trigger), close the seed-vs-import-writing E2E isolation issue in the dev container, and (optionally) mirror a few `make` targets into `package.json` for discoverability.

## Method

This review uses the current tree at `184f361`, the freshly-cut v0.56.14 release, and recent git history as the source of truth. `.planning/` is treated as historical context only where it still matches shipped code. Four parallel codebase analyses were run (main process + IPC + workers; renderer; database + import pipelines; testing + CI + security), with web research cross-checking 2026 best practices for Electron 40, Vue 3.5 + Vuetify 4 + Pinia 3, `better-sqlite3` + `worker_threads`, and Playwright Electron testing.

## Current Strengths

### 1. Desktop security baseline holds and matches Electron's 2026 guidance

- `src/main/index.ts:68–74` keeps `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- `src/main/ipc/handlers/shell.ts:42–58` validates URLs at the IPC boundary before `shell.openExternal` and rejects with `{ success: false, error: 'URL not allowed' }`.
- `scripts/configure-fuses.mjs:14–26` continues to flip the full `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` pair (the combination Electron now explicitly recommends to prevent ASAR integrity bypass), keeps `EnableNodeCliInspectArguments: false`, and uses `strictlyRequireAllFuses: true` as a drift detector against Electron upgrades.
- `tests/e2e/packaged-smoke.e2e.ts` continues to spawn `release/linux-unpacked/varlens` directly via `child_process.spawn` (Playwright's `_electron.launch` is blocked by the `EnableNodeCliInspectArguments: false` fuse because it injects `--inspect=0`) and asserts the `IPC handlers registered` log line.

This is aligned with the current published Electron security stance — both fuses on, ASAR integrity validation enabled, sandbox kept, and a packaged-binary smoke that catches fuse-induced boot regressions.

### 2. IPC and preload are still a real strength

The domain-module pattern (`src/shared/ipc/domains/<name>.ts` contract → `src/preload/domains/<name>.ts` binding → `src/main/ipc/domains/<name>.ts` handler registration) covers the active app-facing surface. Remaining flat handlers (`shell`, `shortlist`, `system`, `updater`) are intentional. `wrapHandler` in `src/main/ipc/errorHandler.ts` continues to normalize all handler errors to `IpcResult<T | SerializableError>`, the renderer continues to call `unwrapIpcResult(...)` at the edge, and the source-parsing `tests/shared/types/preload-contract.test.ts` still gates drift between the `WindowAPI` interface, the preload `api` const, and `MockApi`.

### 3. CI and release gates are credible and tested

- `.github/workflows/build.yml` runs Linux startup smoke against the built Electron app and the Linux packaged-binary smoke against the `release/linux-unpacked/varlens` output.
- `.github/workflows/release.yml` (lines 50–77) refuses to publish unless `build.yml` passed on the exact commit SHA the tag points at — it polls `GITHUB_SHA` (the underlying commit, not the tag object), with `MAX_ATTEMPTS=20 / DELAY=30s`. v0.56.14 was tagged on a commit whose Build was already green; the release workflow accepted the gate without escalation.
- All 39 GitHub Actions usages remain pinned to immutable full-SHA refs with same-line tag comments. Dependabot watches both `npm` (grouped: prod minor+patch, dev separately) and `github-actions` (weekly).

### 4. The Mol* integration remains hardened

`src/renderer/src/composables/useMolstarViewer.ts:43–60` stays on dynamic `import(...)` through Vite's asset graph with cached `ensureMolstarRuntime()` and `markRaw()`. The `asarUnpack` exception for the old viewer bundle is still gone.

### 5. Storage-session boundary now carries real PostgreSQL VCF import

The boundary (`src/main/storage/session.ts`, `read-executor.ts`, `write-executor.ts`, `import-executor.ts`) cleanly separates interface from implementation:

- The read executor's `StorageReadTask` union now covers 26 task types: cases:query / availableBuilds, case-metadata (cohorts, HPO terms, data info), variants:typeCounts / geneSymbols / query / filterOptions. Both backends ship.
- The write executor covers cohort / HPO / external-ID writes for the PostgreSQL backend at `src/main/storage/postgres/PostgresWriteExecutor.ts:20–76`.
- The import executor (`StorageImportExecutor`) covers single-file and multi-file VCF + JSON; the PostgreSQL worker now handles both formats.

Compatibility escapes (`getDatabaseService()`, `getDbPool()`) are still present as deliberate landing strips for the SQLite-only domains that have not yet migrated.

### 6. Phase 9 + 9.1 implementation quality is high

- **`coord_hash BYTEA` GENERATED ALWAYS column** (`scripts/postgres/init-db/12-phase7-variants.sql:40–48`): sha256 of `int4send(octet_length(chr::bytea)) || chr::bytea || int8send(pos) || int4send(octet_length(ref::bytea)) || ref::bytea || int4send(octet_length(alt::bytea)) || alt::bytea`. PG-18 IMMUTABLE-clean via `col::bytea`. Length-prefixed encoding is the right choice — it makes the input pre-image collision-resistant against allele-overlap aliasing. Indexed at `(coord_hash, case_id)` for per-case lookups (line 191) and at `(coord_hash)` UNIQUE for frequency-table upserts (lines 192–193). Correctly used by `PostgresVariantReadRepository` for frequency JOINs.
- **Worker pipeline** (`src/main/workers/postgres-import-worker.ts`): `streamMappedVcfRows()` is an async generator (lines 87–176) with FILTER / QUAL / BED pre-mapping filters and GQ / DP post-mapping filters; pre-mapping skips avoid the cost of `mapVcfRecord()` for thrown-away rows. Stream errors are caught at the source (raw + gunzip listeners, lines 111–116) and re-thrown in the generator. `statSync` runs upfront for ENOENT fast-fail (line 99).
- **Per-batch flush + `mode: 'append'`** (lines 279–312): subsequent batches skip the case-name lookup and `case_data_info` upsert; commits happen per batch; this is what brought the GIAB HG002 v4.2.1 fixture inside a 1 GB Node heap.
- **Worker hardening**: `uncaughtException` / `unhandledRejection` handlers post structured `{ type: 'error' }` messages over `parentPort` (lines 54–76) instead of swallowing or `console.warn`-ing; `PostgresImportWorkerClient.ts:51–62` `terminate()`s the worker thread on both `complete` and `error` paths (was leaking idle workers).
- **Copilot review fixes** (`071d1cc`): SSL `rejectUnauthorized` semantics now treat `client.ssl === true` as `{ rejectUnauthorized: false }` (lines 209–212); `bedPadding` default unified to `?? 0` for both backends (lines 497, 514); `selectedSample` falls back to `''` to let the generator auto-pick first sample (line 250), matching the SQLite path.

### 7. Renderer hygiene continues to hold

- Logging discipline is intact — only `src/renderer/src/main.ts:12,15` (dev-mode mock API) and `src/renderer/src/stores/logStore.ts:29,41` (localStorage bootstrap) use `console.*`. All application logging routes through `logService`.
- All 67 components use `<script setup lang="ts">`; no Options-API holdouts.
- TypeScript renderer config is strict (`strict`, `strictNullChecks`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`).
- No `surface-variant` background-color regressions; the only references are in palette comments documenting the rule.
- Pinia stores use the setup-style factory pattern with explicit return types, async-action wrapping, and `unwrapIpcResult` where appropriate. Pinia's own 2026 guidance on composables vs stores is consistent with how the codebase divides global state from "branch-level" state — the latter lives in composables and is correctly not promoted to Pinia.
- Router (`src/renderer/src/router/index.ts`) lazily loads both main routes and `requestIdleCallback`-prefetches `CohortView`.

### 8. Test surface and CI coverage are non-regressive

- 344 test files (288 unit/integration via Vitest, 39 E2E via Playwright Electron, 7+ perf opt-in).
- Coverage thresholds in `vitest.config.ts:143–208` are explicitly held below observed values (`lines: 35.0`, `branches: 30.8`, `statements: 34.1`, `functions: 21.5`) with `autoUpdate: false` so they don't chase exact CI numbers; per-file thresholds enforce shortlist-module spec §8.
- Skipped tests have intent comments; no `.only()`; PostgreSQL E2Es are gated on `VARLENS_RUN_POSTGRES_E2E=1` and skip with a clear message rather than being silently disabled.
- WGS perf benchmarks are gated on `VARLENS_RUN_WGS_PERF=1` and never run in CI; per-backend baselines and a comparison file land under `.planning/artifacts/perf/wgs-import/` (gitignored).

## Findings

### ✅ Resolved (v0.56.14): PostgreSQL VCF import parity

This was the last open import-side gap on the storage-session boundary. The implementation quality is good (cryptographic coord_hash, hardened worker, structured cancellation, per-batch commits, Copilot review absorbed). The one remaining import-side concern is performance, not correctness — see below.

### ✅ Resolved (v0.56.14): HLA mega-allele btree crash

The pre-9.1 column-tuple btree on `(chr, pos, ref, alt, case_id)` is replaced with a stored generated `coord_hash BYTEA` index. The blocker artifact (`.planning/artifacts/perf/wgs-import/2026-04-25-postgres-blocker.md`) carries a Resolution footer pointing at the spec/plan and the post-fix WGS comparison.

### ✅ Resolved (v0.56.14): worker idle-leak

`PostgresImportWorkerClient` now `terminate()`s the worker thread on `complete` / `error`. The pre-9.1 shape kept idle workers around for the lifetime of the renderer.

### Medium: PostgreSQL VCF import is now correct, but slow enough to trigger Phase 16

Most-recent measurement (`.planning/artifacts/perf/wgs-import/2026-04-26T07-01-37-561Z-comparison.md`): PG 170.93 s vs SQLite 52.88 s, ratio 3.09×. The Phase 9 spec set 2× as the trigger for `COPY FROM STDIN` escalation.

The current PostgreSQL path uses multi-row `INSERT INTO … VALUES (…), (…)` per batch. `pg-copy-streams` would close the gap; the AGENTS.md WGS section already documents this as the next step.

This is now properly framed as a perf-only follow-up (the schema, worker shape, and correctness gate are all green). It is not blocking renderer-side PostgreSQL exposure on its own; lifecycle UX is.

### Medium: storage-session parity is real for cases / variants reads / imports — and still incomplete elsewhere

What ships on PostgreSQL today:
- `cases:list`, `cases:query`, `cases:availableBuilds`
- case-metadata reads (cohorts, HPO terms, data info)
- variants:typeCounts / geneSymbols / query
- VCF + JSON imports through the storage-session import executor

What does not yet ship on PostgreSQL:
- variant `filterOptions` and `columnMeta` (deferral artifact: `.planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md`)
- variant deletes, exports, FTS rebuilds
- `database:overview` (file size, case count, variant count summary)
- lifecycle UX (import progress rendering, asset management)
- non-metadata domains: tags, comments / metrics, audit, presets, panels, gene-lists, region-files, analysis-groups, auth, transcripts, annotations

This is now the single biggest open architectural item, but the right framing has shifted: it is parity execution on a real boundary, not boundary design. The compatibility escapes in `src/main/storage/session.ts:21–26` exist on purpose so these domains can migrate one at a time.

The Kysely usage continues to be ergonomic-only — both backends write raw SQL or use Kysely for query construction inside backend-specific repositories, with no cross-backend leaks observed. That matches Kysely's own 2026 dialect-boundary guidance: Kysely is the typed-helper, not the portability layer.

### Medium: renderer Phase 2 should still be chosen from evidence

No new perf-harness comparisons have landed since the 2026-04-22 baseline. The harness exists (`tests/e2e/renderer-perf-phase1.e2e.ts`, `scripts/perf/compare-phase1.mjs`, frozen-fixture artifacts under `.planning/artifacts/perf/phase1/`); the next step is to take a fresh measurement against current main and pick from:

1. further row-cost reduction
2. hidden-work suppression
3. selective virtualization
4. table primitive replacement

Vue's own 2026 perf guidance ("avoid zombie effects with `effectScope()`", "composables are 1.5×–20× faster than Pinia for ref changes") is already congruent with the codebase's current shape. The next decision is which of those four levers, not whether the architecture is wrong.

### Low: composable size creep in three viewer composables

- `src/renderer/src/composables/useLollipopPlot.ts` — ~982 lines
- `src/renderer/src/composables/useAnnotations.ts` — ~923 lines
- `src/renderer/src/composables/useGeneStructurePlot.ts` — ~654 lines

No shared logic is duplicated into components, no rule-violations, and these are the most domain-rich viewers in the renderer — but they are the most plausible candidates for sub-composable extraction in any future refactor pass. Not a defect; just a flag.

### Low: PostgreSQL E2E test isolation in the shared dev container

`postgres-variants-read-dev-mode.e2e.ts` and `postgres-cases-list-dev-mode.e2e.ts` assume a seed-only DB and clash with import-writing E2Es when sharing the dev container. Tests pass on a fresh `make pg-reset && make pg-up`. The fix is fixture-based test isolation or separate container pools per test family; the prior review's footer already named this as a Phase 9.x cleanup follow-up.

### Low: macOS / Windows packaged-smoke remain follow-ups

Linux packaged smoke gates CI; macOS and Windows do not yet have an equivalent gate. This was an explicit deferral in the 2026-04-23 update; nothing about Phase 9 changes the priority.

### Low: bare `.catch` in one renderer composable

`src/renderer/src/composables/useAssociation.ts:35` has `api.cohort.cancelAssociation().catch((e) => { … })` without routing the rejection to `logService`. Most other composables route to `logService`. Low-risk (UI cancel), but inconsistent with the pattern.

### Low: `package.json` script mirroring still optional

The Makefile is correctly the source of truth, but a few high-value entry points (`make dev`, `make ci`, `make test`) are not mirrored as `package.json` scripts. Worth doing only if it can be done without diluting the rule that `make` is canonical.

## What 2026 best practices say about this stack

This pass cross-checked the codebase against current documentation and recent industry guidance for the load-bearing pieces of the stack. The codebase is broadly aligned; the load-bearing decisions all match current advice rather than legacy practice.

- **Electron security** — context isolation on, sandbox on, `nodeIntegration: false`, ASAR integrity validation + `OnlyLoadAppFromAsar` paired together, fuse drift detection on Electron upgrades. The published Electron 2026 stance treats these as the bare minimum; VarLens has all of them. ([Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [ASAR integrity bypass advisory GHSA-vmqv-hx8q-j7mg](https://github.com/electron/electron/security/advisories/GHSA-vmqv-hx8q-j7mg))
- **Vue 3.5 + Pinia 3 + composables** — Pinia for global state (auth, theme, cross-route stores), composables for "branch-level" state, `effectScope()` for grouped reactive disposal, Composition API + `<script setup lang="ts">` everywhere. VarLens follows all of this. ([Vue best practices 2026](https://onehorizon.ai/blog/vue-best-practices-in-2026-architecting-for-speed-scale-and-sanity), [Pinia composables cookbook](https://pinia.vuejs.org/cookbook/composables.html), [Vue performance guide](https://vuejs.org/guide/best-practices/performance))
- **`better-sqlite3` + `worker_threads`** — main-thread for typical workloads, worker thread + message-passing for slow queries, the worker owns its own DB connection, transactions wrap multi-step writes, queue / respawn pattern for crash resilience. VarLens runs SQLite imports on a worker thread for cancellation, runs PostgreSQL imports on a separate `pg`-backed worker thread, and per-batch transactions inside the PostgreSQL worker keep the heap budget honest. ([better-sqlite3 README](https://www.npmjs.com/package/better-sqlite3), [better-sqlite3 threads.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md))
- **Playwright + Electron** — `_electron.launch` is the supported path for development-mode tests; packaged-binary tests typically need `child_process.spawn` because some fuse configurations block `_electron.launch` (the `--inspect=0` injection). VarLens uses `_electron.launch` for app-mode tests and `child_process.spawn` for the fuse-locked packaged smoke — exactly the split the published guidance recommends. ([Playwright Electron API](https://playwright.dev/docs/api/class-electron), [Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing))
- **GitHub Actions hardening** — pin to immutable SHAs, keep human-readable tag comments for Dependabot, group dependency updates, ignore native ABI-breaking majors. Already the policy here. ([GitHub Actions hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions))
- **Kysely** — typed query builder, not a portability layer; backend-specific repositories own dialect specifics. VarLens already lands here. ([Kysely dialects](https://kysely.dev/docs/dialects))

The places the codebase is most aligned with current best practice are exactly the places earlier reviews flagged for hardening (security baseline, IPC discipline, CI / release gates). The places with open work are the places where best practice is under-determined — picking the right perf phase is intrinsically a measurement problem, and PostgreSQL parity is intrinsically a domain-coverage problem.

## Updated Scorecard

| Area | 2026-04-22 (final) | 2026-04-26 | Notes |
|---|---:|---:|---|
| Security / desktop boundary | 8.7 | 8.7 | No deltas; baseline holds; macOS / Windows packaged smoke still follow-ups |
| Architecture | 8.4 | 8.6 | Storage-session boundary now carries imports as well as reads on PostgreSQL |
| Maintainability | 8.5 | 8.5 | Phase docs continue to be archived promptly |
| Testability / CI trust | 8.7 | 8.7 | 10 Docker-gated PostgreSQL E2Es shipped with Phase 9; non-regressive |
| UX / snappiness | 7.2 | 7.2 | Unchanged — Priority B still open |
| PostgreSQL / hosted backend readiness | 4.2 | 5.5 | VCF + JSON import parity, hardened worker, WGS-scale fixtures fit in 1 GB heap |
| Supply chain / CI posture | 8.2 | 8.2 | No material change |
| WGS-scale readiness | 4.5 | 6.0 | HLA mega-allele crash resolved; WGS fits 1 GB heap; PG/SQLite ratio 3.09× still triggers Phase 16 |
| Dev workflow / agent-readiness | 8.6 | 8.7 | Phase 9 + 9.1 archive discipline matches AGENTS.md guidance |
| **Overall** | **8.4** | **8.5** | Priority A + D shipped; C now in import + read parity; B + E remain open; perf escalation framed as Phase 16 |

## Revised Priorities

### Priority A — Packaged-app integrity hardening — ✅ Resolved (v0.56.6)

`onlyLoadAppFromAsar: true` is flipped on all three platforms; fuses are owned by `scripts/configure-fuses.mjs` with `strictlyRequireAllFuses: true`; Linux packaged-binary smoke is a CI gate. macOS / Windows packaged-binary smoke and `GrantFileProtocolExtraPrivileges` tightening remain explicit follow-ups.

### Priority B — Decide the next renderer-performance phase from measurements

- take a fresh measurement against the perf harness on current main
- pick among row-cost reduction, hidden-work suppression, selective virtualization, table primitive replacement
- document the choice in a phase plan rather than a code-review footer

### Priority C — Continue PostgreSQL parity on the storage-session boundary — 🟡 Partially resolved

What is now in scope:
- variant `filterOptions` / `columnMeta` (Phase 7 deferral)
- variant deletes / exports / FTS rebuilds
- `database:overview`
- non-metadata domains: tags, comments / metrics, audit, presets, panels, gene-lists, region-files, analysis-groups, auth, transcripts, annotations
- lifecycle UX (import progress rendering, asset management)
- close the seed-vs-import-writing E2E isolation issue in the dev container

Do not expose renderer PostgreSQL settings to end users until the lifecycle UX and the major non-import write paths are honest.

### Priority D — Local verification hermetic to packaged artifacts — ✅ Resolved (commit `a8a80fc`)

`release/**` is in the `eslint.config.js` ignore list; a local `make dist` does not poison subsequent `make ci` runs.

### Priority E — Optional `package.json` script mirroring

Mirror a few high-value `make` targets into `package.json` only if it improves discoverability without weakening the "Makefile is canonical" rule.

### Priority F — Phase 16: PostgreSQL VCF import `COPY FROM STDIN` escalation

The WGS PG/SQLite ratio of 3.09× is above the 2× threshold the Phase 9 spec set as the trigger. The path forward is `pg-copy-streams`, with the schema and worker shape unchanged.

## Bottom Line

VarLens has continued to compound. The Phase 9 + 9.1 work was non-trivial — a stored generated `coord_hash BYTEA` column to replace a column-tuple btree, a hardened `worker_threads` import path with structured cancellation and per-batch commits, ten Docker-gated E2Es, and a WGS perf fix that took the GIAB HG002 fixture from "OOMing at 64 GB" to "fits in 1 GB" — and it landed cleanly with Copilot review absorbed in a single follow-up commit.

The strategic shape of the remaining work is unchanged from a week ago: pick the next renderer-performance phase from evidence, finish PostgreSQL parity on the non-import write / export / delete / rebuild / lifecycle domains, escalate PostgreSQL VCF import to `COPY FROM STDIN` (now Priority F), close the dev-container E2E isolation issue, and treat `package.json` script mirroring as a low-priority ergonomics tweak.

The next code-review snapshot should start from whichever of B, C, or F gets picked up next.

## External References

- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron ASAR integrity: https://www.electronjs.org/docs/latest/tutorial/asar-integrity
- Electron ASAR integrity bypass advisory: https://github.com/electron/electron/security/advisories/GHSA-vmqv-hx8q-j7mg
- electron-builder fuse configuration: https://www.electron.build/tutorials/adding-electron-fuses.html
- Electron performance guide: https://www.electronjs.org/docs/latest/tutorial/performance
- Electron automated testing: https://www.electronjs.org/docs/latest/tutorial/automated-testing
- Vue performance guide: https://vuejs.org/guide/best-practices/performance
- Vue best practices 2026: https://onehorizon.ai/blog/vue-best-practices-in-2026-architecting-for-speed-scale-and-sanity
- Pinia composables cookbook: https://pinia.vuejs.org/cookbook/composables.html
- Playwright Electron docs: https://playwright.dev/docs/api/class-electron
- better-sqlite3 README: https://www.npmjs.com/package/better-sqlite3
- better-sqlite3 worker threads: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md
- GitHub Actions security hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- Kysely dialects: https://kysely.dev/docs/dialects
- PostgreSQL partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL text search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
- pg-copy-streams (Phase 16 candidate): https://github.com/brianc/node-pg-copy-streams
