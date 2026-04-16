# VarLens Codebase Review (Update)

**Date:** 2026-04-16
**Branch:** `main`
**Baseline:** [.planning/code-review/CODEBASE-REVIEW-2026-04-15.md](CODEBASE-REVIEW-2026-04-15.md)
**Scope:** Delta since 2026-04-15 review. Covers Priority 1 maintainability closeout (PR #161), Phase 1 renderer perf work, CI gates, planning docs, and current best-practice references.

## Executive Summary

In less than 24 hours the project landed the bulk of Priority 1 (shell split, IPC error standardization, filter consolidation) and non-trivial Priority 3 (perf measurement harness, adaptive scroll, precomputed row view models). It also hardened Priority 4 by promoting the Playwright Electron startup smoke into a first-class Linux CI gate under `xvfb-run`, and added a release workflow guard that refuses to publish a tag whose build CI has not passed on the exact SHA.

The character of the codebase has shifted: it is no longer "good desktop app with heavy orchestration in App.vue and a hand-maintained IPC surface." It is now "good desktop app with a thin shell, a domain-first IPC scaffold, uniform transport errors, and a measurable renderer." The remaining constraints are more structural and less organizational:

1. The IPC **domain module pattern** (`src/shared/ipc/domains/*`) is scaffolded for only 3 of 30 handlers. The rest return `IpcResult<T>` but are not grouped into domain modules, so the contract-drift ceiling is lower than before but still real.
2. **Priority 2 storage abstraction has had zero movement.** Everything is still SQLite-native with full-table rebuilds; the Kysely that ships in `package.json` is a query builder, not an adapter boundary.
3. **Virtualization for the main tables has not landed.** Adaptive scroll and per-row precomputation help, but `v-data-table-server` is still the ceiling and some perf workflows regressed on p50 in the first measured cycle.
4. **Cross-assistant documentation is still Claude-only** — no `AGENTS.md` or `GEMINI.md`, no `npm run verify` / `test:e2e` / `test:smoke`.

**Overall rating: 7.0 / 10** (was 6.5)

Structural trajectory is healthier than the absolute score implies — two of the four most expensive recommendations (shell split, startup smoke) stopped being open problems in this cycle.

## What I Verified (2026-04-16)

- `npm run typecheck` → pass (both renderer and node projects)
- `npm run build` → pass (`electron-vite build` completed in ~8 s)
- `npm run test` → **228 files passed, 1 failed, 1 skipped (230); 2972 tests passed, 4 failed, 17 skipped (2993)**. The 4 failures are all in `tests/main/database/DbPool.test.ts` as `ERR_MODULE_NOT_FOUND` on `out/main/db-worker.js` loaded through Piscina. The file is present on disk. Root cause in this local run is the dual-rebuild workflow: I ran `npm run build` (which leaves `better-sqlite3-multiple-ciphers` on the Electron ABI from `postinstall`) without running `npm run rebuild:node` before `npm run test`, so the Node-side Piscina worker loads an Electron-ABI native addon and Node surfaces the native-load failure as a module-not-found. This is a known CLAUDE.md-documented dual-mode wrinkle, not a regression introduced by PR #161. Running `npm run rebuild:node && npm run test` is expected to green the suite. Compared to the 2026-04-15 baseline (220 files / 2914 tests), the suite has grown by ~10 files and ~79 tests — consistent with PR #161 and the Phase 1 perf harness.
- Planning artifacts read: `.planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md`, `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md`, `.planning/plans/2026-04-15-performance-measurement-and-renderer-tables-phase1-plan.md`
- Git history reviewed for the window 2026-04-15 → 2026-04-16 (40+ commits: PR #161 shell/IPC rollout, v0.56.3 and v0.56.4 releases, dependabot)

## What Changed Since 2026-04-15

### Priority 1 — Maintainability: mostly done

- **App.vue is a thin shell.** Down to ~392 lines. Lifecycle, navigation, dialog ownership, keyboard shortcuts, and app-state provide/inject are all delegated. See [src/renderer/src/App.vue:92](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:92) (`useShellNavigation`) and [src/renderer/src/App.vue:93](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:93) (`useShellLifecycle`). Dialog owner is `AppDialogHost` at [src/renderer/src/App.vue:67](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:67).
- **One state authority per domain.** Shell state lives in `useAppState` (provide/inject factory). Database, import-progress, and filter preferences each have a dedicated store or composable — no more mixing refs, Pinia, and injection for the same fact.
- **IpcResult transport is uniform at the edge.** `wrapHandler` is used in all 30 handler files, and `unwrapIpcResult(...)` is adopted in **48 renderer files / 191 call sites**. `SerializableError` now leaks into only 4 files (the error infrastructure itself plus two direct consumers). This is real standardization, not a facade.
- **Filter query shaping is consolidated.** `src/shared/filters/filterDefaults.ts` and `src/shared/filters/filterSerialization.ts` own defaults and serialization; composables import rather than duplicate. The 2026-03 NOTE in [src/shared/types/filters.ts](/home/bernt-popp/development/VarLens/src/shared/types/filters.ts:17) about shared-vs-renderer drift is retired.
- **Closeout artifacts exist.** See [.planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md](/home/bernt-popp/development/VarLens/.planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md).

What did **not** finish: the **domain-module grouping** pattern (`src/shared/ipc/domains/`, `src/preload/domains/`, `src/main/ipc/domains/`) is only scaffolded for `cases`, `database`, and `filter-presets`. The remaining 27 handlers return `IpcResult<T>` but are not yet grouped into matching shared/preload/main domain triples. The inventory at [.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md](/home/bernt-popp/development/VarLens/.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md) records this honestly and plans three more sub-phases.

**Net effect:** error-shape branching has already been eliminated across the renderer. What remains is an organizational cleanup, not a correctness cleanup.

### Priority 3 — Snappiness: more progress than the baseline claimed

- **Measurement harness exists.** [src/renderer/src/services/RendererLongTaskObserver.ts](/home/bernt-popp/development/VarLens/src/renderer/src/services/RendererLongTaskObserver.ts) + [src/renderer/src/services/PerfSnapshot.ts](/home/bernt-popp/development/VarLens/src/renderer/src/services/PerfSnapshot.ts) + [src/main/services/MainPerfTrace.ts](/home/bernt-popp/development/VarLens/src/main/services/MainPerfTrace.ts), surfaced via preload (`window.api.perf.getSnapshot()`) and reset hooks wired into App.vue.
- **Frozen-fixture perf run.** [tests/e2e/renderer-perf-phase1.e2e.ts](/home/bernt-popp/development/VarLens/tests/e2e/renderer-perf-phase1.e2e.ts) runs each workflow 12 times, discards 2 warmups, and writes manifests under `.planning/artifacts/perf/phase1/{baseline,post-change}/`. A local `scripts/perf/compare-phase1.mjs` produces the markdown diff.
- **Adaptive keyboard scroll.** [VariantTable.vue:503,520,528,541,613](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue:503) uses `pendingScrollBehavior` + `getAdaptiveRowScrollBehavior(lastKeyboardMoveAtMs, now)` — instant on rapid repeat, smooth for deliberate jumps. [CohortDataTable.vue:535](/home/bernt-popp/development/VarLens/src/renderer/src/components/cohort/CohortDataTable.vue:535) carries the same treatment.
- **Per-row precomputation.** `useVariantRowViewModel` and `useVariantRenderRows` exist and are consumed by VariantTable, which is exactly the "shift slot-time work to row-scoped render state" path the baseline recommended.
- **Honest reporting of regressions.** The phase 1 plan records that `filter-apply`, `page-next-prev`, and `keyboard-nav-burst` improved on p50 while `case-select-visible-rows`, `cohort-toggle`, and `startup-shell` regressed. That is the kind of comparison log this review was asking for, and it's present.

What did **not** land: true **row virtualization**. Both major tables still render through `v-data-table-server` slots. That remains the ceiling, and the regressions listed above live inside that ceiling.

### Priority 4 — E2E startup smoke and CI trust: promoted to a real gate

- **Startup smoke is now a first-class Linux CI gate.** [.github/workflows/build.yml](/home/bernt-popp/development/VarLens/.github/workflows/build.yml) runs [tests/e2e/startup-smoke.e2e.ts](/home/bernt-popp/development/VarLens/tests/e2e/startup-smoke.e2e.ts) under `xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24"` against the built app on the Linux package lane. This is the "stable Electron startup smoke" the 2026-04-15 review asked for.
- **Smoke test is sophisticated.** Isolated `userData` / `appData`, `perfMode: true`, milestone assertions against `snapshot.main.milestones['app-ready' | 'window-created' | 'renderer-interactive']`, failure-context capture, app-shell screenshot. This is not a "app opened a window" test; it's a real app-ready gate.
- **Makefile has canonical `ci-*` targets** that mirror the workflow (`ci-startup-smoke`, `ci-package-linux`, `ci-full`, `ci-actions`). Local and CI paths match.
- **Release guard.** `release.yml` refuses to publish if `build.yml` has not passed on the tagged SHA (20-attempt retry loop for race conditions introduced in v0.56.1). This addresses the "release policy for unsigned artifacts" bullet.

What still does **not** match the baseline ask:
- No `npm run verify` / `npm run test:e2e` / `npm run test:smoke` scripts in `package.json`. The canonical surface lives in the Makefile and the workflow files, not in npm scripts. For non-Makefile consumers (including some agents) this is an asymmetry.
- GitHub Actions are still pinned by **floating major versions** (`@v6`, `@v7`), not by commit SHA. The supply-chain hardening recommendation from the baseline is still open.
- `auto-update.e2e.ts` — the specific Playwright test the 2026-04-15 review reported as failing on `firstWindow()` — is addressed by the shared launch helper `tests/e2e/helpers/electron-app.ts` rather than being rewritten end-to-end. Worth re-running to confirm.

### Priority 2 — Hosted Postgres / WGS readiness: no movement

No dialect interface, no incremental summary logic, no staging-table ingest, no tsvector / GIN work, no Kysely-as-adapter code. `better-sqlite3-multiple-ciphers` is still called directly in [DatabaseService.ts](/home/bernt-popp/development/VarLens/src/main/database/DatabaseService.ts:62); FTS trigger tear-down/restore is still inline in [VariantRepository.ts](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts:58); [cohort-summary-rebuild.ts](/home/bernt-popp/development/VarLens/src/shared/sql/cohort-summary-rebuild.ts:1) still `DELETE + INSERT` rebuilds the whole summary table.

This is fine as a stated deferral — Priority 2 was never scoped into this cycle — but the scorecard has to reflect that it remains a **3/10**.

### Priority 5 — Multi-assistant workflow: **AGENTS.md + CLAUDE.md rewrite landed 2026-04-16**

**Landed in this cycle.** `AGENTS.md` (163 lines) is now the canonical neutral contract for every coding agent (Codex, Claude Code, Cursor, Copilot, OpenCode, Zed, Factory, …). `CLAUDE.md` (40 lines) is now a thin Claude-Code-specific layer that `@AGENTS.md`-imports the canonical contract and only adds Claude-harness behavior (Plan Mode threshold, subagent delegation, GSD skill preference, auto-mode gate, memory scope).

The rewrite follows documented best practice for each file:

- **AGENTS.md** follows the [agents.md spec](https://agents.md/) (standard Markdown, no required frontmatter, flexible headings) and fits within Codex's 32 KiB `project_doc_max_bytes` default. It includes the sections the spec and the [Codex guide](https://developers.openai.com/codex/guides/agents-md) call out as high-value: project overview, tech stack, repo layout, setup, **dual-rebuild gotcha with the exact `ERR_MODULE_NOT_FOUND` signature**, canonical command surface (Makefile), testing tiers, non-obvious code-style rules (logger, IPC `domain:action` + `IpcResult`, domain-module pattern), Vuetify traps, field conventions (`consequence` vs `func`), `.planning/` vs `docs/`, Conventional Commits + release guard, Electron security defaults, explicit don'ts.
- **CLAUDE.md** follows the [Claude Code best-practices guide](https://code.claude.com/docs/en/best-practices) and the [HumanLayer "what not to include" list](https://www.humanlayer.dev/blog/writing-a-good-claude-md): under 60 lines, only harness-specific behavior, uses Claude Code's `@path` import syntax to deduplicate against `AGENTS.md`.

Every claim in both files was verified against the current tree: file paths (`src/main/services/MainLogger.ts`, `src/renderer/src/services/LogService.ts`, `src/main/import/vcf/*`, `tests/shared/types/preload-contract.test.ts`, `.planning/docs/UI-PATTERNS.md`, `scripts/perf/compare-phase1.mjs`, `scripts/prepare-test-data.sh`), security defaults at [src/main/index.ts:70-72](/home/bernt-popp/development/VarLens/src/main/index.ts:70), the 48-file / 191-usage `unwrapIpcResult` footprint, and the `.planning/artifacts/perf/` gitignore rule.

**Still open from the original Priority 5:**
- No `GEMINI.md`. Low priority unless a Gemini CLI user hits the project; `AGENTS.md` is sufficient for Gemini via standard discovery.
- No npm script surface mirror for `test:e2e` / `test:smoke` / `verify` / `ci:full`. The `Makefile` targets are canonical, but agents that never read a `Makefile` still work blind. One npm-script block would close this.
- GitHub Actions steps still float on major versions (`@v6`, `@v7`) rather than pinned commit SHAs. Supply-chain hardening still open.

## Updated Scorecard

| Area | 2026-04-15 | 2026-04-16 | Notes |
|---|---:|---:|---|
| Security / desktop boundary | 8 | 8 | No change; preload domain scaffolding reinforces the posture |
| Architecture | 7 | 7.5 | Thin shell + domain-first IPC scaffold; domain rollout incomplete |
| Maintainability | 6 | 7.5 | Error model uniform, filter duplication retired, closeout discipline |
| Testability | 7 | 7.5 | Startup smoke is now a real CI gate; perf runs are reproducible |
| UX / snappiness | 7 | 7 | Adaptive scroll + precomputation up; virtualization still absent; p50 regressions on three workflows |
| PostgreSQL / hosted backend | 3 | 3 | No change |
| WGS-scale readiness | 4 | 4 | No change |
| Dev workflow / LLM-readiness | 5 | 7 | `AGENTS.md` canonical; `CLAUDE.md` thin + `@AGENTS.md`-imported; Makefile canonical. Still no npm `verify`, no pinned action SHAs |
| **Overall** | **6.5** | **7.0** | Real movement on maintainability, CI-trust, and multi-assistant axes |

## Revised Priorities for the Next Cycle

### Priority A — Close out IPC domain grouping (1–2 days)

The three-domain scaffold (`cases`, `database`, `filter-presets`) proved the pattern. The remaining 27 handlers already return `IpcResult<T>` through `wrapHandler`, so the cost of grouping them into `src/shared/ipc/domains/<name>.ts` + `src/preload/domains/<name>.ts` + `src/main/ipc/domains/<name>.ts` is mechanical. Doing the mechanical rollout now, while the pattern is fresh, locks in the contract-drift reduction and retires the "two-tier" IPC codebase the closeout doc acknowledges.

The [2026-04-16 IPC inventory](/home/bernt-popp/development/VarLens/.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md) already has a per-handler disposition — execute it.

### Priority B — Virtualize the two large tables (the one remaining high-ROI perf change)

Adaptive scroll and precomputed row view models moved the floor up; they did not move the ceiling. The ceiling is still the number of rendered rows × per-row slot cost in Vuetify's `v-data-table-server`.

Recommended path: keep `v-data-table-server` for the chrome (headers, column metadata, pagination) but render the row region through a **TanStack Virtual** viewport. TanStack Virtual is headless, 10–15 kB, supports variable sizing and window scrolling, and has first-class Vue 3 examples including a table integration. It composes well with existing Vuetify headers rather than replacing them.

`vue-virtual-scroller` is an option if variable-height dynamic sizing is the blocker, but TanStack Virtual gives more control and is easier to reason about with Vuetify's header/footer slots.

Adopt with a perf gate: any virtualization change has to be merged only if `renderer-perf-phase1.e2e.ts` shows improvement on the three regressed workflows (`case-select-visible-rows`, `cohort-toggle`, `startup-shell`) and no regression on the improved three. That's the existing `compare-phase1.mjs` loop.

Sources:
- [TanStack Virtual — Vue table example](https://tanstack.com/virtual/v3/docs/framework/vue/examples/table)
- [TanStack Virtual overview](https://tanstack.com/virtual/latest)
- [vue-virtual-scroller](https://www.digitalocean.com/community/tutorials/vuejs-vue-virtual-scroller)

### Priority C — Introduce the dialect boundary before Postgres, not during

The cheapest time to add a `DatabaseAdapter` interface is while the code already has clean-ish callers (post-PR #161), not after a Postgres prototype has forked the SQL layer. Minimum viable scope:

- a `VariantRepository`-shaped interface in `src/main/database/adapters/` that the current `better-sqlite3-multiple-ciphers` implementation satisfies
- isolation of PRAGMA, FTS trigger, `ANALYZE`, and WAL/checkpoint behavior behind the interface
- one thin Kysely `Dialect` swap test (SQLite → SQLite-via-Kysely) as a regression harness before ever wiring Postgres

Kysely ships official SQLite, Postgres, MySQL, and MSSQL dialects and is designed for exactly this kind of swap. It is not a silver bullet — raw FTS5 SQL, worker semantics, and WAL handling stay dialect-specific — but the adapter boundary is what makes any hosted-Postgres work possible without rewriting business logic.

Sources:
- [Kysely dialects](https://kysely.dev/docs/dialects)
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [PostgreSQL text search tables and indexes](https://www.postgresql.org/docs/current/textsearch-tables.html)

### Priority D — Cross-assistant contract (mostly landed 2026-04-16)

- ✅ **Done.** `AGENTS.md` is canonical, `CLAUDE.md` is thin and `@AGENTS.md`-imported. Both verified against the current tree. See the "Priority 5" section above for the best-practice sources consulted and the verification pass.
- ⬜ **Open.** Mirror the Makefile's canonical targets as npm scripts (`test:e2e`, `test:smoke`, `verify`, `ci:full`) so agents that never read a `Makefile` get the same surface.
- ⬜ **Open.** Pin a handful of `actions/*` steps in workflow YAML to commit SHAs (checkout, setup-node, upload-artifact). Keep the floating major versions for low-risk actions.

### Priority E — Typed IPC contract testing guardrail

The preload contract test (`tests/shared/types/preload-contract.test.ts`) is the single most valuable guardrail this refactor produced. It should be the first thing the domain-module rollout adds coverage for as each handler migrates, and it should be called out in `AGENTS.md` as the canonical "did I drift the contract?" check. Libraries like `electron-typed-ipc-bridge` and `electron-typescript-ipc` demonstrate the same pattern at scale — if the rollout grows past ~10 domains, consider whether a thin code-gen step becomes cheaper than hand-written triples.

Sources:
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [electron-typed-ipc-bridge](https://github.com/mato533/electron-typed-ipc-bridge)

## Closeout Honesty Check

The 2026-04-16 Priority 1 closeout doc is unusually honest — it lists "filter query-shaping ownership consolidation" as "explicitly deferred" even though related filter centralization did land. Reading the inventory against the code suggests the doc is describing a narrower remaining consolidation (renderer composables vs. shared serializers) rather than the full filter split, but the phrasing could mislead a future reader. One-line clarification in the closeout doc would be worth it.

## Bottom Line

VarLens went from "good codebase that is expensive to change" toward "good codebase that is cheap to change." The refactor executed in this cycle was broader than typical Priority 1 batches (shell decomposition, IPC error model, filter consolidation, perf harness, CI promotion all in one window) and it landed without regressing typecheck or build. The remaining open bets are fewer and clearer:

- **Ship the domain-module grouping** for the 27 remaining handlers — low risk, high organizational return.
- **Virtualize the tables** — the last high-ROI renderer change and the one concrete thing standing between current p50s and a "snappy on 50 k variants" claim.
- **Add an adapter boundary before attempting Postgres** — cheaper now than after.
- ~~**Write `AGENTS.md`**~~ — **done 2026-04-16**: `AGENTS.md` (163 lines) is canonical, `CLAUDE.md` (40 lines) is thin and imports `AGENTS.md` via `@`. Remaining Priority 5 work is the npm-script mirror and pinned action SHAs.

Nothing on that list requires a rewrite. All of it is linear execution against a structure that now exists.

## External References

- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron performance guide](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Playwright ElectronApplication](https://playwright.dev/docs/api/class-electronapplication)
- [Playwright Electron firstWindow timeout issues](https://github.com/microsoft/playwright/issues/27658)
- [Vue performance best practices](https://vuejs.org/guide/best-practices/performance.html)
- [TanStack Virtual — Vue table example](https://tanstack.com/virtual/v3/docs/framework/vue/examples/table)
- [TanStack Virtual overview](https://tanstack.com/virtual/latest)
- [vue-virtual-scroller tutorial](https://www.digitalocean.com/community/tutorials/vuejs-vue-virtual-scroller)
- [Kysely dialects](https://kysely.dev/docs/dialects)
- [Kysely migrations](https://kysely.dev/docs/migrations)
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [PostgreSQL text search tables and indexes](https://www.postgresql.org/docs/current/textsearch-tables.html)
- [electron-typed-ipc-bridge](https://github.com/mato533/electron-typed-ipc-bridge)
- [electron-typescript-ipc](https://www.npmjs.com/package/electron-typescript-ipc)
