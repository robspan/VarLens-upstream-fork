# Performance Measurement and Renderer Tables Phase 1 Implementation Plan

> **Status (updated 2026-04-22):** Phase 1 substantially landed and retained as reference. The harness, startup smoke gate, perf snapshot plumbing, comparison script, and first optimization pass shipped. Any next renderer-performance phase should start from current measurements rather than continuing this checklist verbatim.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Phase 1 only: make renderer responsiveness measurable, capture a frozen-fixture baseline with Playwright, then implement targeted renderer responsiveness improvements with before/after evidence.

**Architecture:** Work starts with a single measurement and harness track that standardizes Electron launch isolation, perf snapshots, long-task observation, and artifact capture. Once that lands, the team captures one canonical frozen-fixture baseline and treats it as a hard barrier before two renderer optimization tracks proceed in parallel. All optimization claims must finish with a rerun of the same baseline workflows and an explicit comparison artifact.

**Tech Stack:** Electron, Playwright `_electron`, Vue 3, Vuetify `v-data-table-server`, preload IPC bridge, Vitest, GitHub Actions Linux CI.

**Spec:** `.planning/specs/2026-04-15-performance-measurement-and-renderer-tables-design.md`

**Status update (2026-04-15):**
- Track A3 is implemented and rerun locally with refreshed comparison output.
- Current formal comparison outcome: `filter-apply`, `page-next-prev`, and `keyboard-nav-burst` improved; `case-select-visible-rows`, `cohort-toggle`, and `startup-shell` regressed on p50.
- Perf artifacts remain local-only under `.planning/artifacts/perf/phase1/` and are now gitignored.

---

## File structure

### New files

| File | Responsibility |
|---|---|
| `tests/e2e/startup-smoke.e2e.ts` | Canonical Linux-gated startup smoke with isolated Electron profile and deterministic shell assertion |
| `tests/e2e/renderer-perf-phase1.e2e.ts` | Frozen-fixture perf workflows run 12 times with first 2 discarded |
| `tests/e2e/helpers/electron-app.ts` | Shared Playwright Electron launch helper with isolated `userData` / config paths and failure logging |
| `tests/e2e/helpers/perf-fixture.ts` | Imports `tests/fixtures/import/columnar-format.json.gz` three times into an isolated temp database |
| `tests/e2e/helpers/perf-artifacts.ts` | Writes raw run manifests and workflow summaries into `.planning/artifacts/perf/phase1/...` |
| `src/renderer/src/services/RendererLongTaskObserver.ts` | Dev/perf-only `PerformanceObserver` wrapper and summary reducer |
| `src/renderer/src/services/PerfSnapshot.ts` | Read-only renderer snapshot builder combining flow traces and long-task summaries |
| `src/shared/types/perf.ts` | Shared perf snapshot types used by preload, renderer, and E2E |
| `scripts/perf/compare-phase1.mjs` | Compares baseline vs post-change artifact trees and emits markdown/json summary |
| `.planning/artifacts/perf/phase1/.gitkeep` | Anchors artifact directory structure in git |

### Modified files

| File | What changes |
|---|---|
| `playwright.config.ts` | `trace: 'retain-on-failure'`, startup/perf project defaults, canonical artifact policy |
| `tests/e2e/auto-update.e2e.ts` | Replace stale footer selector with an accessible locator so current Playwright status no longer reports a false harness failure |
| `.github/workflows/build.yml` | Add one canonical Linux startup-smoke gate with one worker and Electron profile isolation |
| `src/preload/index.ts` | Expose perf snapshot getter / reset helpers to Playwright |
| `src/preload/index.d.ts` | Surface new preload perf methods to renderer typing |
| `src/shared/types/api.ts` | Extend `WindowAPI['perf']` with snapshot methods used in perf runs |
| `src/main/services/MainPerfTrace.ts` | Export startup milestone snapshot in a stable shape |
| `src/renderer/src/App.vue` | Enable perf mode hooks and long-task observer bootstrap in dev/perf runs |
| `src/renderer/src/services/PerfTrace.ts` | Add snapshot/reset helpers for scripted runs |
| `src/renderer/src/components/VariantTable.vue` | Shift slot-time work to row-scoped render state and adaptive keyboard scroll behavior |
| `src/renderer/src/components/variant-table/useVariantRowViewModel.ts` | Extend row-scoped precomputation for link and annotation state |
| `src/renderer/src/components/variant-table/useVariantRenderRows.ts` | Optional new row-scope adapter for visible rows if extraction improves readability |
| `src/renderer/src/components/cohort/CohortDataTable.vue` | Shift link resolution to row/column precomputation and adaptive keyboard scroll behavior |
| `src/renderer/src/components/CohortTable.vue` | Gate hidden work without regressing warm-state behavior |
| `src/renderer/src/components/variant-table/useVariantData.ts` | Gate hidden watchers / annotation work while hidden and surface perf markers around visible refreshes |
| `src/renderer/src/composables/useOffsetPagination.ts` | Gate prefetch while hidden / perf-disabled where appropriate |

### Artifact paths

| Path | Contents |
|---|---|
| `.planning/artifacts/perf/phase1/baseline/run-manifest.json` | Machine state, command line, git SHA, timestamp, run parameters |
| `.planning/artifacts/perf/phase1/baseline/startup-smoke/` | Playwright trace, screenshots, stdout/stderr sidecar, shell selector evidence |
| `.planning/artifacts/perf/phase1/baseline/workflows/<workflow>/raw-runs.json` | 12 raw runs with the first 2 flagged as warm-up |
| `.planning/artifacts/perf/phase1/baseline/workflows/<workflow>/summary.json` | Measured 10-run summary: p50, p95, median long-task count, max single long-task duration |
| `.planning/artifacts/perf/phase1/post-change/...` | Same structure after renderer improvements |
| `.planning/artifacts/perf/phase1/comparison/summary.md` | Final before/after narrative and metric deltas |
| `test-results/` | Raw Playwright trace bundles and screenshots preserved by `retain-on-failure` |

---

## Execution order and parallel tracks

### Hard ordering

1. `Track A1` measurability and harness trust
2. `Track A2` frozen-fixture baseline capture
3. `Track B` variant-table responsiveness and `Track C` cohort/hidden-work responsiveness in parallel
4. `Track A3` post-change rerun and comparison

No renderer responsiveness work starts before the baseline artifacts exist under `.planning/artifacts/perf/phase1/baseline/`.

### Parallel ownership

| Track | Ownership | Starts when |
|---|---|---|
| `Track A1` Harness + measurement | `playwright.config.ts`, E2E helpers/tests, perf snapshot plumbing, CI gate | immediately |
| `Track A2` Baseline capture | frozen-fixture import helper, perf runner, baseline artifacts | after `Track A1` merges locally |
| `Track B` Variant table | `VariantTable.vue`, variant row view-model / render-row helpers | after `Track A2` baseline artifacts exist |
| `Track C` Cohort + hidden work | `CohortDataTable.vue`, `CohortTable.vue`, `useVariantData.ts`, `useOffsetPagination.ts` | after `Track A2` baseline artifacts exist |
| `Track A3` Comparison | rerun runner + comparison script + final artifact summary | after `Track B` and `Track C` land |

---

## Commands

### Canonical local verification commands

```bash
npm run rebuild:electron
npm run build
npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
VARLENS_PERF_OUTPUT=.planning/artifacts/perf/phase1/baseline \
  npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1
VARLENS_PERF_OUTPUT=.planning/artifacts/perf/phase1/post-change \
  npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1
node scripts/perf/compare-phase1.mjs \
  .planning/artifacts/perf/phase1/baseline \
  .planning/artifacts/perf/phase1/post-change \
  > .planning/artifacts/perf/phase1/comparison/summary.md
```

### CI gate command

```bash
npm run rebuild:electron
npm run build
npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
```

The CI gate lands in one canonical Linux job only. Do not add matrix expansion in Phase 1.

---

## Task 1: Track A1 measurability foundation and startup trust

**Files:**
- Create: `tests/e2e/helpers/electron-app.ts`
- Create: `tests/e2e/helpers/perf-artifacts.ts`
- Create: `src/renderer/src/services/RendererLongTaskObserver.ts`
- Create: `src/renderer/src/services/PerfSnapshot.ts`
- Create: `src/shared/types/perf.ts`
- Modify: `playwright.config.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/shared/types/api.ts`
- Modify: `src/main/services/MainPerfTrace.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/services/PerfTrace.ts`

- [ ] Add shared Electron launch helper in `tests/e2e/helpers/electron-app.ts` that creates isolated temp dirs for Electron `userData` / config state, launches `./out/main/index.js`, captures close/crash events, and returns both the app handle and cleanup paths.
- [ ] Change [`playwright.config.ts`](/home/bernt-popp/development/VarLens/playwright.config.ts) from `trace: 'on-first-retry'` to `trace: 'retain-on-failure'` while keeping `retries: 0`, and keep startup/perf runs on one worker.
- [ ] Add `RendererLongTaskObserver` and `PerfSnapshot` so perf mode reports flow traces, long-task count, total duration, and max duration without requiring DevTools.
- [ ] Extend preload / shared typings so Playwright can call `window.api.perf.getSnapshot()` and `window.api.perf.resetSnapshot()` safely.
- [ ] Export startup milestones from `MainPerfTrace` in a stable object shape and include them in the renderer-visible snapshot.
- [ ] Bootstrap the long-task observer from [`src/renderer/src/App.vue`](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue) only in explicit dev/perf mode so normal production runs do not gain noise.
- [ ] Run unit verification for the touched perf plumbing:

```bash
npm run test -- tests/renderer/services/PerfTrace.test.ts
npm run typecheck
```

- [ ] Confirm the measurability surface by running:

```bash
npm run rebuild:electron
npm run build
npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
```

Expected result: `firstWindow()` succeeds, app shell is visible, and failure artifacts are retained automatically if the smoke fails.

---

## Task 2: Track A1 canonical startup smoke and stale-selector cleanup

**Files:**
- Create: `tests/e2e/startup-smoke.e2e.ts`
- Modify: `tests/e2e/auto-update.e2e.ts`
- Modify: `.github/workflows/build.yml`
- Modify: `src/renderer/src/components/AppFooter.vue` if an explicit test id or aria label is needed for the footer network state

- [ ] Create `tests/e2e/startup-smoke.e2e.ts` that uses the shared Electron helper, waits for `.v-application`, dismisses the disclaimer if present, asserts one stable app-shell selector, and writes smoke artifacts into `.planning/artifacts/perf/phase1/baseline/startup-smoke/` or the active `VARLENS_PERF_OUTPUT` root.
- [ ] Fix the current false-negative in [`tests/e2e/auto-update.e2e.ts`](/home/bernt-popp/development/VarLens/tests/e2e/auto-update.e2e.ts) by replacing `.mdi-wifi, .mdi-wifi-off` with a durable locator, preferably an explicit aria label or test id sourced from [`src/renderer/src/components/AppFooter.vue`](/home/bernt-popp/development/VarLens/src/renderer/src/components/AppFooter.vue).
- [ ] Add one Linux-only startup smoke gate to `.github/workflows/build.yml` that runs `npm run rebuild:electron`, `npm run build`, and `npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1`.
- [ ] Verify the gate locally:

```bash
npm run rebuild:electron
npm run build
npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
npx playwright test tests/e2e/auto-update.e2e.ts --workers=1
```

- [ ] Commit Track A1/A2 harness work before any renderer optimization starts.

---

## Task 3: Track A2 frozen fixture seeding and baseline runner

**Files:**
- Create: `tests/e2e/helpers/perf-fixture.ts`
- Create: `tests/e2e/renderer-perf-phase1.e2e.ts`
- Modify: `tests/fixtures/import/columnar-format.json.gz` only if the compressed file is missing from the working tree and needs to be generated from the checked-in source fixture

- [ ] Implement `tests/e2e/helpers/perf-fixture.ts` to import `tests/fixtures/import/columnar-format.json.gz` exactly three times into an isolated temp database under case names `perf-case-a`, `perf-case-b`, and `perf-case-c`.
- [ ] Implement `tests/e2e/renderer-perf-phase1.e2e.ts` with Phase 1 workflows only:
  `startup-shell`, `case-select-visible-rows`, `filter-apply`, `page-next-prev`, `cohort-toggle`, and `keyboard-nav-burst`.
- [ ] For each workflow, run 12 iterations, mark the first 2 as warm-up, and write the remaining 10 measured runs into `.planning/artifacts/perf/phase1/baseline/workflows/<workflow>/`.
- [ ] Write `run-manifest.json` capturing git SHA, Node/Electron versions, whether AC power / other sessions were checked manually, and the exact commands used.
- [ ] Capture the baseline with the canonical command:

```bash
VARLENS_PERF_OUTPUT=.planning/artifacts/perf/phase1/baseline \
  npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1
```

- [ ] Verify that every workflow summary contains exactly these fields: `p50Ms`, `p95Ms`, `medianLongTaskCount`, `maxSingleLongTaskMs`, `measuredRuns`.

The baseline artifact tree is the barrier for the rest of the plan.

---

## Task 4: Track B variant-table responsiveness

**Files:**
- Modify: `src/renderer/src/components/VariantTable.vue`
- Modify: `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
- Create or Modify: `src/renderer/src/components/variant-table/useVariantRenderRows.ts`

- [ ] Refactor `VariantTable.vue` so each visible row resolves its row-scoped render state once instead of calling `getViewModel(...)` repeatedly from multiple slots.
- [ ] Move dynamic virtual-link resolution out of slot templates and into row-model construction so the template stays display-only.
- [ ] Add perf markers around visible-row refreshes so the baseline workflows keep producing comparable snapshots after the refactor.
- [ ] Replace unconditional smooth keyboard scrolling with the Phase 1 product rule: use `behavior: 'auto'` when consecutive keyboard selection moves occur less than `150ms` apart, otherwise keep `behavior: 'smooth'`.
- [ ] Verify no row actions regress:

```bash
npm run typecheck
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --grep "case-select-visible-rows|filter-apply|keyboard-nav-burst" --workers=1
```

Track B must not change the frozen fixture, run counts, or summary schema.

---

## Task 5: Track C cohort-table responsiveness and hidden-work suppression

**Files:**
- Modify: `src/renderer/src/components/cohort/CohortDataTable.vue`
- Modify: `src/renderer/src/components/CohortTable.vue`
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`
- Modify: `src/renderer/src/composables/useOffsetPagination.ts`

- [ ] Precompute effective link configuration per cohort column and resolved row link values for visible rows so `CohortDataTable.vue` no longer calls `getLinkForColumn(...)` and `resolveLink(...)` repeatedly inside slots.
- [ ] Apply the same `150ms` adaptive keyboard-scroll rule in `CohortDataTable.vue`.
- [ ] Audit the spec’s hidden-work suspect list in `useVariantData.ts`, `CohortTable.vue`, and `useOffsetPagination.ts`; for each suspect, either gate it while hidden, keep it with an inline justification comment, or remove it from the suspect set with evidence.
- [ ] Preserve warm cached views under `keep-alive` / `v-show`; gate work, not component lifetime.
- [ ] Verify the hidden-work changes with:

```bash
npm run typecheck
npx playwright test tests/e2e/perf-audit-monkey.e2e.ts --workers=1
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --grep "cohort-toggle|page-next-prev|keyboard-nav-burst" --workers=1
```

---

## Task 6: Track A3 post-change rerun and comparison

**Files:**
- Create: `scripts/perf/compare-phase1.mjs`
- Modify: `tests/e2e/helpers/perf-artifacts.ts` if the comparison script needs stricter summary shape

- [x] Rerun the exact frozen-fixture workflows into `.planning/artifacts/perf/phase1/post-change/`:

```bash
VARLENS_PERF_OUTPUT=.planning/artifacts/perf/phase1/post-change \
  npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1
```

- [x] Implement `scripts/perf/compare-phase1.mjs` to compare baseline vs post-change workflow summaries and emit both a machine-readable JSON diff and a markdown report.
- [x] Generate the final comparison artifacts:

```bash
mkdir -p .planning/artifacts/perf/phase1/comparison
node scripts/perf/compare-phase1.mjs \
  .planning/artifacts/perf/phase1/baseline \
  .planning/artifacts/perf/phase1/post-change \
  > .planning/artifacts/perf/phase1/comparison/summary.md
```

- [x] Confirm each workflow comparison reports, at minimum: `baseline.p50`, `postChange.p50`, `baseline.p95`, `postChange.p95`, `baseline.medianLongTaskCount`, `postChange.medianLongTaskCount`, `baseline.maxSingleLongTaskMs`, `postChange.maxSingleLongTaskMs`.

---

## Task 7: Final verification and handoff

**Files:**
- Modify: `.planning/specs/2026-04-15-performance-measurement-and-renderer-tables-design.md` only if implementation realities require a small wording correction after the work lands

- [x] Run the final Phase 1 verification sequence:

```bash
npm run rebuild:electron
npm run build
npm run lint:check
npm run typecheck
npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
npx playwright test tests/e2e/auto-update.e2e.ts --workers=1
VARLENS_PERF_OUTPUT=.planning/artifacts/perf/phase1/post-change \
  npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1
```

- [x] Confirm the Linux CI gate stays startup-smoke-only for Phase 1.
- [x] Confirm the final artifact tree contains both `baseline/` and `post-change/` summaries plus `comparison/summary.md`.
- [x] Write a short implementation note in the PR description or session summary that calls out which workflow improved and which metrics did not materially move.

---

## Spec coverage checklist

| Spec requirement | Plan coverage |
|---|---|
| measurability first | Tasks 1-3 |
| frozen fixture imported three times | Task 3 |
| 12 runs, discard first 2, keep 10 | Task 3 |
| report p50, p95, median long-task count, max single long-task duration | Tasks 3 and 6 |
| `retain-on-failure` with `retries: 0` | Task 1 |
| startup smoke as one canonical Linux CI gate | Task 2 |
| renderer responsiveness improvements only after baseline | hard ordering + Tasks 4-5 |

## Notes

- The previously reported `firstWindow()` failures were shell-state-dependent and are no longer the current blocker after `npm run rebuild:electron`.
- The currently verified Playwright failure is the stale footer network-icon selector in `tests/e2e/auto-update.e2e.ts`; fix that during Track A1 so Phase 1 starts from a clean startup/harness baseline.
