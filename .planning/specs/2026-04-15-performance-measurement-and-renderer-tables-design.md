# Performance Measurement and Renderer Tables — Design

**Date:** 2026-04-15  
**Status:** Design approved, pending plan  
**Scope:** Phase 1 only — establish trustworthy performance measurement, stabilize Electron startup/perf verification, and improve renderer responsiveness in the two main data tables  
**Primary goal:** Improve day-to-day development speed and user-perceived responsiveness by measuring first, then optimizing the highest-cost renderer paths with before/after evidence

---

## 1 · Goals

1. **Make performance measurable before changing behavior.** Add baseline instrumentation and repeatable verification so this work produces evidence, not anecdotes.
2. **Stabilize the Electron startup/perf test path.** Current Playwright startup coverage is not trustworthy enough to act as a regression gate.
3. **Reduce renderer work in the two main data tables.** Focus on visible-row cost, keyboard navigation responsiveness, and hidden-view background work.
4. **Produce before/after comparisons for every claimed improvement.** The implementation plan must require baseline capture, post-change capture, and explicit deltas.
5. **Keep Phase 1 tightly scoped to speed and responsiveness.** Do not let this turn into a storage abstraction or broad architecture rewrite.

## 2 · Non-goals

- PostgreSQL or hosted-backend preparation
- SQLite dialect abstraction
- IPC contract redesign beyond measurement needs
- Replacing `v-data-table-server` wholesale
- Blind migration to `v-data-table-virtual`
- Materialized summary redesign
- Import pipeline performance work beyond test-harness support
- Large UI redesigns unrelated to responsiveness

## 3 · Why This Spec Exists

The 2026-04-15 codebase review correctly identified renderer table density, hidden-view work, startup-smoke trust, and shell orchestration as the highest-value speed-first concerns. Local verification in this session refined that conclusion:

1. **The table problem is primarily work-per-visible-row, not row-count alone.** Both main data surfaces already use server-side pagination with small page sizes, but they still do substantial slot-time work per visible row.
2. **The repo already has partial performance instrumentation.** `PerfTrace`, startup milestones, and perf-adjacent E2Es exist, but they do not yet provide reliable blocking and interaction evidence.
3. **The current Playwright Electron path is not a dependable regression signal.** Multiple existing E2Es failed before `firstWindow()`, including failures caused by Electron process/profile isolation problems.
4. **The codebase has a prior documented constraint against naive virtual-table migration.** A previous internal perf design explicitly excluded `v-data-table-virtual` because of poor behavior on very wide tables.

The correct next move is therefore:

- measurement first
- harness hardening second
- targeted renderer-table optimization third

That ordering matches Electron guidance to measure before optimizing and Vue guidance to focus on list rendering, props stability, and reactivity cost when update performance is the bottleneck.

## 4 · Current State (verified against codebase)

### 4.1 App shell and hidden-view behavior

- `App.vue` keeps routed views alive with `<keep-alive :max="2">` in `src/renderer/src/App.vue`.
- `CaseView` intentionally keeps the main `VariantTable` mounted under `v-show` while the shortlist tab is active so the table stays warm and does not reload.
- This is a valid UX trade-off, but it requires explicit suspension of hidden work to avoid background competition for renderer time.

### 4.2 Variant table

`src/renderer/src/components/VariantTable.vue` uses `v-data-table-server` with many custom item slots:

- annotation slot
- external-link slots
- ClinVar / gene / position slots
- tooltip-heavy transcript / func fields
- dynamic virtual-link columns

The component already contains a good optimization primitive:

- `useVariantRowViewModel()` precomputes a `Map<variantKey, RowViewModel>`

However, the template still performs repeated `getViewModel(...)` calls within multiple slots for the same row. The optimization exists, but the render path still pays repeated lookup overhead and repeated null-branch evaluation at slot time.

### 4.3 Cohort table

`src/renderer/src/components/cohort/CohortDataTable.vue` also uses `v-data-table-server` with multiple custom slots. Its main renderer cost pattern is different:

- repeated `getLinkForColumn(...)`
- repeated `resolveLink(...)`
- inline branch-heavy URL selection inside slots

This table has less annotation complexity than `VariantTable`, but its repeated link-resolution work is still expensive relative to the small number of visible rows.

### 4.4 Keyboard navigation

Both main tables call:

```ts
row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
```

on selection movement. Smooth scrolling is a good fit for deliberate jumps, but it is a poor fit for held-arrow-key repetition and can make repeated navigation feel slower than the data query itself.

### 4.5 Existing measurement primitives

The codebase already contains:

- renderer flow timing via `src/renderer/src/services/PerfTrace.ts`
- startup milestones in `src/main/services/MainPerfTrace.ts`
- renderer interactive reporting via `api.perf.reportInteractive()`
- perf-adjacent E2Es such as `startup-large-db.e2e.ts`, `benchmark-import-delete.e2e.ts`, and `perf-audit-monkey.e2e.ts`

The current gaps are:

- no renderer long-task measurement
- no explicit interaction latency summary for key workflows
- no dependable trace artifact capture in current Playwright config
- no stable startup smoke path that can be trusted in CI/local perf work

### 4.6 Current Playwright state

Earlier startup-failure framing from this session is now outdated.

Current verified state:

- the root cause of the earlier startup failures was native module ABI mismatch in the shell state, not a persistent Playwright or Electron `firstWindow()` defect
- after `npm run rebuild:electron`, direct Electron launch works and Playwright reaches `firstWindow()`
- current Playwright spot-check status is:
  - `tests/e2e/auto-update.e2e.ts`: 1 passed, 1 failed
  - the remaining failure is a stale selector in `AppFooter.vue` for `.mdi-wifi, .mdi-wifi-off`
- `playwright.config.ts` still uses `trace: 'on-first-retry'` with `retries: 0`, so first-failure artifact capture remains effectively disabled

Conclusion: Phase 1 still needs startup/perf harness hardening, but for the current reasons:

- deterministic Electron profile isolation
- canonical startup smoke coverage
- useful failure artifacts on first failure
- removal of brittle selectors that make Playwright status noisier than the actual app state

## 5 · External Guidance and Fit

### 5.1 Electron guidance

Electron’s performance guide emphasizes:

- measure first
- do not block the main process
- do not block the renderer process
- defer startup work not needed for first interaction

This directly supports a Phase-1 design focused on startup trust, renderer blocking measurement, and hidden-work suppression.

### 5.2 Vue guidance

Vue’s performance guide emphasizes:

- profile locally using DevTools and framework markers
- virtualize large lists when row count is the dominant issue
- reduce reactivity overhead for large immutable structures
- keep props stable and avoid unnecessary subtree updates

Fit to VarLens:

- `shallowRef` usage in pagination is already aligned with Vue guidance
- the next fit-for-codebase step is reducing per-row slot work and stabilizing row-scoped inputs
- virtualization remains an option, but only after row-cost measurement because page size is already small and the tables are unusually wide

### 5.3 Playwright guidance

Playwright’s Electron API supports:

- direct Electron launch
- `firstWindow()`
- main-process evaluation
- trace capture and viewer workflows

Playwright’s trace guidance supports:

- `retain-on-failure` for failure artifact collection without retries
- `on-first-retry` when retries are enabled, which is not the current repo state

Fit to VarLens:

- Phase 1 should introduce a startup smoke path that isolates Electron app state and always yields useful failure artifacts
- Phase 1 should standardize on `retain-on-failure` with `retries: 0` for the startup/perf smoke path so artifact capture is deterministic

### 5.4 Long-task guidance

MDN’s `PerformanceLongTaskTiming` guidance defines long tasks as UI-thread work of 50ms or more. That is the correct primitive for detecting renderer blocking that users feel as laggy input, scroll, and delayed paint.

Fit to VarLens:

- long-task observation is appropriate in dev/perf mode
- this should be added as a lightweight observer and summarized into existing perf reporting rather than becoming a large telemetry system

### 5.5 Repo-specific fit constraint

`.planning/archive/completed-specs/2026-03-25-performance-optimization-design.md` explicitly recorded that direct use of `v-data-table-virtual` was problematic on very wide tables.

This matters. Official framework guidance says virtualization is often the right answer. Repo evidence says the obvious Vuetify swap is not the right answer for this table shape. Phase 1 must respect that and optimize the current architecture first.

## 6 · Phase-1 Design

This spec produces three connected workstreams:

| Workstream | Purpose | Why first |
|---|---|---|
| A. Startup/perf harness trust | Make Electron startup and perf verification reliable | Without this, every perf claim is suspect |
| B. Perf observability | Capture baseline and post-change responsiveness/blocking data | Optimization without measurement is guesswork |
| C. Renderer table responsiveness | Reduce visible-row work and suppress hidden work | Highest direct user-perceived payoff |

## 7 · Workstream A — Startup and Perf Harness Trust

### 7.1 Objectives

- Create one deterministic Electron startup smoke test
- Isolate startup tests from shared profile/user-data state
- Ensure failures produce actionable artifacts
- Establish a minimal perf-run mode suitable for repeated local comparison

### 7.2 Required changes

1. **Introduce test-run Electron isolation**
   - Launch with isolated user-data/config paths for Playwright E2E runs.
   - Avoid collisions with local interactive Electron sessions.
   - Ensure single-instance lock does not invalidate the test harness.

2. **Create a canonical startup smoke**
   - Launch app
   - acquire first window
   - wait for app shell
   - optionally dismiss disclaimer
   - assert one stable shell selector
   - fail fast with artifacts if window never becomes available

3. **Improve Playwright artifact capture**
   - Use `trace: 'retain-on-failure'` with `retries: 0` for the startup/perf smoke path
   - preserve screenshots and failure context
   - attach main-process console and close/crash observations where possible

4. **Define a small perf smoke subset**
   - startup smoke
   - one case-table interaction smoke
   - one cohort interaction smoke

### 7.3 Acceptance criteria

- startup smoke can be rerun repeatedly in the same environment without profile-lock flake
- failed runs produce usable artifacts
- Phase 1 lands the startup smoke as a real CI gate, but only in one canonical job initially: Linux, one worker, isolated profile, no broad matrix expansion yet

## 8 · Workstream B — Perf Observability

### 8.1 Principles

- use the smallest instrumentation that answers the real questions
- separate user-flow latency from blocking behavior
- keep measurement readable and comparable across runs
- do not add a large permanent telemetry system

### 8.2 Metrics that must exist before optimization

Baseline metrics for:

- startup to app shell
- startup to renderer interactive signal
- case select to first visible variant rows
- filter apply to refreshed rows and annotation-ready state
- page navigation next/prev
- cohort toggle to visible cohort rows
- keyboard navigation burst responsiveness
- renderer long-task count
- worst renderer long-task duration

Reported statistics are fixed for Phase 1:

- p50 latency per workflow
- p95 latency per workflow
- median long-task count per run for the workflow
- max single long-task duration observed across measured runs

### 8.3 Instrumentation design

1. **Enable Vue performance markers in dev/perf mode**
   - use `app.config.performance` in renderer bootstrap for local profiling support

2. **Keep and extend current `PerfTrace`**
   - preserve current flow traces
   - add summary retrieval appropriate for scripted perf runs
   - report enough metadata to compare runs without opening DevTools first

3. **Add renderer long-task observation**
   - dev/perf-only `PerformanceObserver` for `longtask`
   - maintain rolling summary:
     - count
     - max duration
     - total duration
     - recent worst offenders

4. **Add structured perf snapshots**
   - expose a small read-only snapshot API for test/perf runs
   - include current flow traces + long-task summary + startup milestones where available

5. **Keep measurement mode explicit**
   - measurement should not add visible user noise in normal production runs
   - perf mode may log and expose richer data

### 8.4 Baseline protocol

Phase 1 uses one frozen renderer/perf fixture:

- import `tests/fixtures/import/columnar-format.json.gz` three times into an isolated temp database as `perf-case-a`, `perf-case-b`, and `perf-case-c`
- each import contains 50 variants, so the baseline fixture is:
  - 3 cases
  - 150 case-local variant rows total
  - 50 cohort aggregate rows, with cross-case carrier overlap because all three imports use the same source file

This fixture is chosen because it is:

- already in-repo
- small enough for repeatable local runs
- large enough to exercise filtering, pagination, cohort aggregation, keyboard navigation, annotation follow-up work, and hidden-view behavior

For each target workflow:

1. Run stable startup smoke
2. Seed the frozen fixture into an isolated temp database
3. Execute the interaction script 12 times
4. Discard the first 2 runs as warm-up
5. Collect perf snapshots for the remaining 10 measured runs
6. Save artifact summary

The implementation plan must keep this exact repetition protocol for both baseline and post-change runs. No alternate fixture and no “representative single run” are allowed for Phase 1 comparisons.

### 8.5 Acceptance criteria

- baseline can be captured without opening DevTools manually
- post-change captures use the same harness and report shape
- every optimization task references at least one metric it intends to improve

## 9 · Workstream C — Renderer Table Responsiveness

### 9.1 Guiding decision

Phase 1 will optimize **work per visible row** before attempting a table-component replacement.

This is the best fit for VarLens because:

- page sizes are already modest
- table width and slot density are high
- the repo already documented direct `v-data-table-virtual` issues for this table class

### 9.2 Variant table optimization design

#### 9.2.1 Row-scoped render state

Current issue:

- multiple cells repeatedly call `getViewModel(...)` for the same row

Design:

- extend the current row-view-model pattern so visible rows are rendered from a row-scoped object rather than repeated slot-time lookups
- use stable derived objects where possible so unchanged rows do less update work

Expected gain:

- lower slot-time lookup overhead
- clearer boundaries between data shaping and rendering
- easier profiling of actual row render cost

#### 9.2.2 Dynamic link resolution

Current issue:

- dynamic virtual-link columns still resolve URLs inline in the template

Design:

- resolve dynamic link state during row-model construction, not repeatedly inside individual cell slots

Expected gain:

- lower repeated resolver overhead
- fewer branch-heavy template expressions

### 9.3 Cohort table optimization design

Current issue:

- repeated `getLinkForColumn(...)` and `resolveLink(...)` per cell

Design:

- precompute effective link configuration per column
- precompute resolved row link values for currently visible rows
- keep the renderer template focused on display, not URL derivation

Expected gain:

- lower cell render overhead
- easier to reason about per-row costs in profiling

### 9.4 Keyboard navigation responsiveness

Current issue:

- both tables use smooth scrolling even during repeated arrow-key movement

Design:

- detect rapid repeat navigation and use non-animated scroll behavior in that mode
- reserve smooth scrolling for deliberate, low-frequency selection changes

Phase-1 UX rule:

- if consecutive keyboard-driven row-selection moves occur less than `150ms` apart, use `scrollIntoView({ block: 'nearest', behavior: 'auto' })`
- otherwise use `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`

This threshold is a product decision, not an implementation afterthought. It is intentionally biased toward responsiveness under key-repeat.

Expected gain:

- reduced perceived lag under key-repeat
- lower animation/scroll workload during row traversal

### 9.5 Hidden-work suppression

Current issue:

- warm cached views are useful, but hidden views must not continue doing unnecessary expensive work

Design:

- audit all hidden-table work under `keep-alive` / `v-show`
- explicitly gate:
  - annotation-related follow-up work where possible
  - prefetch where it competes with visible interactions
  - other renderer watchers or refresh triggers that are not useful while hidden

The initial suspect list for Track C is:

- `src/renderer/src/components/variant-table/useVariantData.ts`
  - `watch(filterKey, ...) -> invalidateAndReload()`
  - `watch(columnFilterState.columnFilters, ...) -> debouncedColumnFilterReload()`
  - `watch(variants, ...) -> loadAnnotationsBatch()`
- `src/renderer/src/composables/useOffsetPagination.ts`
  - `prefetchNextPage()`
- `src/renderer/src/components/CohortTable.vue`
  - `handleFilterChange() -> invalidateAndReload()`
  - `handleColumnFiltersChange() -> debouncedColumnFilterReload()`
  - `watch(variants, ...) -> debouncedLoadAnnotations()`
  - expanded-row carrier loading via `@load-carriers`

The plan should verify each suspect explicitly and either gate it, justify it, or remove it from the suspect list with evidence.

Important constraint:

- preserve warm-state behavior where it materially reduces reload friction
- do not regress state preservation just to eliminate all background work

### 9.6 Explicitly deferred optimization ideas

- direct `v-data-table-virtual` replacement
- wholesale custom table rewrite
- speculative micro-optimizations without metric linkage

These can become Phase-2 experiments only if Phase 1 measurement shows row-cost reductions are insufficient.

## 10 · Before/After Verification Requirements

No optimization task is complete without:

1. **Baseline capture**
   - collect metrics before code changes

2. **Post-change capture**
   - same workflow, same harness, same environment assumptions

3. **Comparison**
   - record at minimum:
     - p50 latency
     - p95 latency
     - median long-task count per run
     - max single long-task duration
     - qualitative note if UX changed in a deliberate way

4. **Regression check**
   - ensure behavior, shortcuts, loading states, and row actions still function

The implementation plan must include explicit commands and expected artifact locations for this process.

## 11 · Parallelization Strategy

The implementation plan should split work into three parallel tracks with minimal overlap:

### Track A — Harness and Measurement

Owns:

- `playwright.config.ts`
- `tests/e2e/startup-smoke.e2e.ts`
- `tests/e2e/helpers/electron-app.ts`
- `tests/e2e/helpers/perf-fixture.ts`
- `src/renderer/src/services/PerfSnapshot.ts`
- `src/renderer/src/services/RendererLongTaskObserver.ts`
- measurement APIs / summaries in preload/shared types as needed

### Track B — Variant Table

Owns:

- `src/renderer/src/components/VariantTable.vue`
- `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
- `src/renderer/src/components/variant-table/useVariantRenderRows.ts` if introduced
- related table perf helpers

### Track C — Cohort Table and Hidden Work

Owns:

- `src/renderer/src/components/cohort/CohortDataTable.vue`
- `src/renderer/src/components/CohortTable.vue`
- `src/renderer/src/components/variant-table/useVariantData.ts`
- `src/renderer/src/composables/useOffsetPagination.ts`
- hidden-work gating in relevant views/composables
- adaptive keyboard navigation behavior where shared

This split keeps merge contention low and allows measurement work to proceed in parallel with renderer optimization work.

## 12 · Risks and Mitigations

### Risk 1 — Measurement changes alter behavior

Mitigation:

- keep measurement dev/perf-gated where possible
- expose read-only snapshots
- avoid introducing new heavy observers in normal production mode

### Risk 2 — Startup harness “fixes” hide a real startup problem

Mitigation:

- separate environment-isolation fixes from app-behavior assertions
- keep one minimal smoke that still validates a real visible shell

### Risk 3 — Hidden-work suppression regresses warm-state UX

Mitigation:

- gate work, not component existence
- preserve user-visible state unless a measured reason justifies change

### Risk 4 — Table changes become an unbounded rewrite

Mitigation:

- Phase 1 stays focused on precomputation, render-cost reduction, and adaptive interaction behavior
- defer virtualization experiments unless measurements require them

### Risk 5 — Measurement jitter makes the comparison noisy

Mitigation:

- baseline and post-change runs use the exact same frozen fixture and repetition count
- record machine state with each artifact:
  - AC vs battery
  - whether other Electron dev sessions were open
  - whether the run used an isolated temp profile
- prefer local runs on AC power with no other local VarLens/Electron sessions active
- discard the first 2 warm-up runs and compute statistics only from the remaining 10 measured runs

## 13 · Acceptance Criteria

Phase 1 is successful when all of the following are true:

1. There is a deterministic Electron startup smoke suitable for repeated local runs.
2. Failed startup/perf runs produce useful artifacts.
3. Baseline responsiveness and blocking metrics are captured before renderer optimizations.
4. `VariantTable` and `CohortDataTable` each have at least one concrete row-cost reduction tied to measurement.
5. Hidden views stop doing avoidable expensive work while preserving warm-state behavior.
6. At least one primary workflow meets one of these numeric Phase-1 targets on the frozen fixture:
   - `>= 20%` reduction in p95 latency for `filter-apply`, `case-switch`, or `page-next`
   - `>= 30%` reduction in median long-task count during the keyboard-navigation burst workflow
   - `>= 30%` reduction in max single long-task duration during the keyboard-navigation burst workflow
7. The resulting implementation plan can be executed in parallel tracks without major write conflicts.

## 14 · Implementation Follow-up

The next artifact after this spec is a detailed implementation plan in `.planning/plans/` that:

- decomposes the three tracks into concrete tasks
- defines baseline and post-change commands
- names the metrics each task is expected to influence
- orders tasks so measurement work lands before optimization claims

## 15 · References

- `.planning/code-review/CODEBASE-REVIEW-2026-04-15.md`
- `.planning/archive/completed-specs/2026-03-25-performance-optimization-design.md`
- `src/renderer/src/App.vue`
- `src/renderer/src/components/VariantTable.vue`
- `src/renderer/src/components/cohort/CohortDataTable.vue`
- `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
- `src/renderer/src/composables/useOffsetPagination.ts`
- `src/renderer/src/services/PerfTrace.ts`
- `src/main/services/MainPerfTrace.ts`
- `playwright.config.ts`
- Vue performance guide: https://vuejs.org/guide/best-practices/performance.html
- Electron performance guide: https://www.electronjs.org/docs/latest/tutorial/performance
- Playwright Electron API: https://playwright.dev/docs/api/class-electronapplication
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- MDN `PerformanceLongTaskTiming`: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
- web.dev INP guide: https://web.dev/articles/optimize-inp
- Vuetify server-side tables: https://vuetifyjs.com/en/components/data-tables/server-side-tables/
- Vuetify virtual tables: https://vuetifyjs.com/en/components/data-tables/virtual-tables/
