# VarLens Updated Code Review - Current State and Path to >8/10

**Date:** 2026-04-01
**Version:** 0.50.0
**Scope:** Current local codebase (`424` source files, `164` test files)
**Primary goals:** maintainability, correctness, best practices, and speed/snappiness

---

## Executive Summary

VarLens is now meaningfully stronger than the earlier 0.47.0 snapshot in the areas that matter most for user trust:

- core correctness bugs called out in the earlier review are largely fixed
- Electron security posture remains strong and has improved around external URL handling
- the test suite is much larger and currently passes under coverage mode
- import, VCF parsing, database logic, and shared utilities are in materially better shape than the renderer and IPC layers

The codebase is **not** blocked by foundational architecture failure. The current gap is more specific:

1. **Quality gates are not yet trustworthy enough to drive an 8+/10 engineering score**
2. **Renderer/Main and shared-type boundaries are still too porous**
3. **The app has good raw performance primitives, but perceived responsiveness is not yet treated as a first-class system**

Current overall rating: **7.3/10**

The realistic path to **>8/10 across all dimensions** is not a rewrite. It is a targeted hardening program:

- make coverage policy honest and enforce it in CI
- finish the preload/renderer typing cleanup and shared-type consolidation
- make perceived responsiveness measurable and explicit
- reduce architecture drift by centralizing repeated patterns at IPC and filter boundaries

---

## Live Baseline

### Verified current test / coverage state

`npm run test:coverage` currently:

- passes the suite: **2162 passed, 17 skipped**
- fails the gate due to thresholds:
  - **32.58% statements**
  - **27.10% branches**
  - **21.32% functions**
  - **33.12% lines**

### Current scorecard

| Dimension | Current | Why it is not >8 yet |
|-----------|---------|----------------------|
| Security | **8.0** | Good defaults and improved URL policy, but dependency hygiene and IPC discipline still need work |
| Architecture | **6.5** | Good macro-structure, but blurred boundaries and duplicated state models remain |
| Code Quality / Maintainability | **7.0** | Strong intent and many well-factored areas, but duplicated contracts and repeated handler patterns add drag |
| Domain Correctness | **7.5** | Earlier high-risk correctness issues were fixed; remaining risk is mostly test depth and regression protection |
| Test Quality | **8.0** | Many tests are meaningful and integration-heavy; weak areas are concentrated, not uniform |
| Coverage / CI Rigor | **5.5** | The suite runs, but the policy is still aspirational and unevenly enforced |
| Performance / Snappiness | **7.0** | Good use of workers and incremental loading in places, but responsiveness is not yet systematized |
| Overall | **7.3** | Strong foundation, incomplete hardening |

### Target scorecard

| Dimension | 90-day target |
|-----------|---------------|
| Security | **8.5+** |
| Architecture | **8.0+** |
| Code Quality / Maintainability | **8.0+** |
| Domain Correctness | **8.5+** |
| Test Quality | **8.5+** |
| Coverage / CI Rigor | **8.0+** |
| Performance / Snappiness | **8.0+** |
| Overall | **8.2+** |

---

## What Improved Since the Earlier Review

These earlier concerns have been materially improved in the current tree:

### Correctness and security

- **External URL opening is now policy-gated.**
  - `src/main/index.ts`
  - `src/main/utils/url-validation.ts`
- **Genotype dosage handling is now canonicalized and shared.**
  - `src/shared/sql/genotype-dosage.ts`
  - `src/main/database/AssociationDataBuilder.ts`
  - `tests/shared/sql/genotype-dosage.test.ts`
- **Cohort boolean search `NOT` handling is now parser-based instead of string-spliced.**
  - `src/shared/utils/boolean-search.ts`
  - `src/main/database/search/cohort-search-emitter.ts`
  - `src/main/database/cohort.ts`
- **`auth:listUsers` now enforces admin authorization.**
  - `src/main/ipc/handlers/auth.ts`
- **`createFirstUser` is now transactional.**
  - `src/main/services/auth/AuthService.ts`
- **ACMG normalization is now much more coherent at the IPC boundary and in migrations.**
  - `src/shared/utils/acmg.ts`
  - `src/shared/types/ipc-schemas.ts`
  - `src/main/database/migrations.ts`
- **Annotation cache bleed risk is reduced by scope-aware invalidation.**
  - `src/renderer/src/composables/useAnnotations.ts`

### Quality and test execution

- the earlier `settings-io` coverage blocker is fixed
- the full suite now runs in coverage mode successfully before thresholds are applied
- build CI is stronger than before because it already runs lint, typecheck, and tests on PR/build

---

## Current Strengths

These are the parts of the codebase that should be preserved and extended, not rewritten:

1. **Electron security defaults are strong.**
   - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
2. **Database layer design is generally solid.**
   - repository pattern, typed query construction, and a clear main-process data model
3. **Worker/off-main-thread intent is correct.**
   - import, delete, export, and rebuild work have already been separated conceptually
4. **VCF and shared domain utilities are in better-than-average shape.**
   - current coverage in import/VCF/shared-utils is much stronger than the app average
5. **TypeScript strictness is a real asset.**
   - the codebase is still getting value from strict typing despite boundary erosion
6. **Several composables are already trending in the right direction.**
   - `useApiService`, `useAssociation`, `useCohortData`, `useFilterCore`

---

## Deep Review by Area

## 1. Architecture

### Rating: 6.5/10

### What is good

- the top-level split between main, preload, renderer, shared, tests, and planning is coherent
- many feature areas already have reasonable internal boundaries
- the codebase is not trapped in a single monolith

### What is holding the rating down

#### A. Renderer/Main boundary is still leaky

Symptoms:

- direct `window.api` usage remains in active code paths
- `as any` casts are still used to bypass incomplete contract typing
- renderer files still import types from `src/main/**`

Representative locations:

- `src/renderer/src/composables/useAnalysisGroups.ts`
- `src/renderer/src/composables/useCohortData.ts`
- `src/renderer/src/components/cohort/CohortFilterBar.vue`
- `src/renderer/src/components/CohortTable.vue`
- multiple renderer imports from `src/main/database/types` and `src/main/services/api/schemas/*`

Why this matters:

- it weakens the preload contract as the true system boundary
- it makes refactors across processes expensive
- it encourages “just cast it” as a local escape hatch

Best-practice direction:

- Electron’s guidance is to expose a **specific, minimal API via preload/contextBridge**, not to let renderer code depend on main-process internals directly
- TypeScript’s `noImplicitAny` guidance exists precisely to prevent silent type erosion

Target architecture:

- renderer imports only from:
  - `src/shared/**`
  - `src/renderer/**`
  - the typed preload surface
- all IPC channels are represented in one typed API contract
- no renderer code should need `as any` for normal application flows

#### B. Shared contracts are duplicated

The clearest example is `FilterState`.

Current state:

- `src/shared/types/filters.ts`
- `src/renderer/src/composables/filter-types.ts`
- `src/renderer/src/composables/useFilters.ts`

Why this matters:

- duplication at a system contract boundary is expensive maintenance debt
- bugs here are subtle because all copies may look “mostly” aligned until they are not

Best-practice direction:

- one canonical domain model
- thin view-specific adapters only where shape differences are truly intentional

#### C. Cross-cutting IPC concerns are not centralized enough

Examples:

- repeated `safeEmit` implementations
- `wrapHandler()` returns serialized errors as normal values
- renderer callers repeat `'code' in result` checks instead of consuming a consistent success/failure abstraction

Why this matters:

- repeated glue logic grows faster than business logic
- every new handler inherits accidental complexity

### Path to >8/10

1. Make `src/shared/types/api.ts` the single preload contract authority.
2. Remove renderer imports from `src/main/**` by re-exporting required pure types from `src/shared/**`.
3. Consolidate `FilterState` into one canonical shared model plus adapters.
4. Replace repeated `safeEmit` with one shared event helper.
5. Introduce a standard `Result<T, E>`-style renderer-facing IPC wrapper or reject on error consistently.

Expected result:

- Architecture moves from **6.5 -> 8.0+**
- Maintainability improves more than raw LOC reduction would suggest

---

## 2. Maintainability and Code Quality

### Rating: 7.0/10

### What is good

- many files are readable and intentional
- naming quality is generally decent
- several utilities are already extracted
- the codebase has enough tests to support refactoring in important areas

### What is holding the rating down

#### A. Pattern duplication around filters, IPC, and annotations

- duplicate filter state definitions
- repeated handler/event patterns
- multiple places where similar serialization and result checking logic recur

#### B. “Temporary” casts have become semi-permanent architecture

Whenever `as any` survives for long, it stops being a tactical exception and becomes the real contract.

#### C. Testability is unevenly distributed

High-value backend logic is often testable.
The IPC edge and worker entrypoints are not consistently designed for cheap testing.

### Path to >8/10

1. Treat every `as any` in renderer/preload as a bug backlog item.
2. Extract testable units from worker entry files so the worker wrappers stay thin.
3. Create small, shared primitives for:
   - preload result handling
   - IPC event emission
   - filter serialization / normalization
4. Add rule-driven linting for forbidden imports and forbidden raw `window.api` usage outside `useApiService`.

Expected result:

- Code Quality / Maintainability moves from **7.0 -> 8.2+**

---

## 3. Correctness

### Rating: 7.5/10

### What is good

- earlier correctness bugs around genotype dosage, boolean search, and ACMG normalization were real and are now substantially improved
- current domain utility coverage is one of the stronger parts of the repository

### Remaining risks

#### A. Correctness is still under-protected at the integration seams

Even where logic is good, many edge handlers and worker paths are poorly covered. That means regressions can still enter through orchestration rather than pure logic.

#### B. Error semantics are inconsistent

If an IPC layer returns “success-shaped errors”, renderer code can accidentally treat failures as valid values.

### Path to >8/10

1. Add focused regression suites for every earlier consensus bug class:
   - genotype dosage
   - ACMG normalization and summaries
   - cohort search boolean precedence
   - annotation scope invalidation
2. Add contract tests at the preload/API boundary.
3. Make error transport semantics uniform.

Expected result:

- Domain Correctness moves from **7.5 -> 8.5+**

---

## 4. Test Coverage and CI Rigor

### Rating: 5.5/10

This is the most important current gap.

### What is good

- the suite is large and runs under coverage mode
- many tests are not superficial
- current coverage is strong in several backend utility areas

### What is holding the rating down

#### A. Global thresholds are still aspirational instead of operational

Current state:

- `vitest.config.ts` enforces 70% global thresholds
- real coverage is ~33/27/21/33
- the command fails every time for policy reasons, not because the suite is broken

Why this is a problem:

- a gate that always fails does not protect quality; it trains people to ignore it

Vitest best-practice direction:

- use realistic thresholds
- use glob-specific thresholds for strong vs weak areas
- use `autoUpdate` carefully to ratchet upward over time
- write reports to a known directory and generate reports even on failure where useful

#### B. IPC handlers and workers are still coverage deserts

Current live data:

- `main/ipc/handlers`: **5.71% statements**
- `main/workers`: **10.84% statements**

This is where the highest coordination complexity lives.

#### C. Release CI is weaker than build CI

Current state:

- build pipeline runs lint, typecheck, tests
- release pipeline runs tests only before packaging

Why this matters:

- the tagged build path should never be weaker than the PR path

### Path to >8/10

1. Replace the flat 70% threshold with:
   - a realistic global floor
   - per-directory thresholds
   - auto-ratcheting upward only where stable
2. Switch CI coverage policy to:
   - PR/build: `npm run test:coverage`
   - release: lint + typecheck + coverage + package
3. Make `main/ipc/handlers` and `main/workers` first-class coverage programs.
4. Add HTML + json-summary reporting in CI artifacts and PR comments.

Recommended threshold model:

- global threshold: slightly below current actuals, then ratchet upward
- strong areas such as shared utilities, VCF parsing, and database utilities: **85-95%**
- handler and worker layers: start lower but require quarter-over-quarter increases

Expected result:

- Coverage / CI Rigor moves from **5.5 -> 8.0+**

---

## 5. Performance and Snappiness

### Rating: 7.0/10

### What is good

- heavy work is already conceptually moved off the main thread in several places
- import and cohort areas show evidence of batching and deferred loading
- Vue code already has some selective lazy behavior

### What is holding the rating down

#### A. Snappiness is not measured as a product constraint

Right now the codebase has performance ideas, but not a clear responsiveness budget.

Missing:

- explicit startup budget
- interaction-to-update budget for large tables and filters
- visible tracking of renderer stutter and main-process blocking

Electron best-practice direction:

- **measure first**
- do not block the main process
- do not block the renderer
- defer loading/running code that is not needed immediately

Vue best-practice direction:

- code-split feature trees not needed at startup
- keep props stable
- use `v-memo` / `v-once` appropriately
- virtualize large lists
- reduce reactivity overhead for large immutable structures

Node worker guidance direction:

- worker threads are best for CPU-heavy work
- keep pools intentional and avoid spawning patterns that add overhead without control

#### B. Large table and data-heavy flows are still the place where perceived lag will show

High-risk UX surfaces:

- cohort table
- variant table
- annotation-heavy row rendering
- filter application and chip recomputation
- startup-time service initialization

### Path to >8/10

1. Define performance budgets.
   - cold start to interactive
   - case switch
   - filter apply
   - pagination / sort
   - annotation hydration
2. Instrument the main process and renderer for these budgets.
3. Virtualize every large, scroll-heavy table path consistently.
4. Split non-critical UI trees and service initialization off startup.
5. Audit reactivity pressure in:
   - table rows
   - annotations
   - filters
   - metadata-heavy panels
6. Prefer immutable snapshots for large data payloads passed into render-heavy views.
7. Ensure worker entrypoints are thin and reuse pools where appropriate.

Expected result:

- Performance / Snappiness moves from **7.0 -> 8.2+**

---

## 6. Security

### Rating: 8.0/10

### What is good

- Electron security defaults are strong
- URL opening policy is more defensive now
- the preload boundary exists and is meaningful
- auth and recovery flows are more robust than before

### Remaining gaps

#### A. Dependency hygiene is still not clean enough

Current concerns:

- `xlsx` is still pulled from a CDN tarball rather than the normal registry path
- `@xmldom/xmldom` override intent exists, but local resolution currently still shows a mismatch via transitive dependency resolution

#### B. IPC hardening can still improve

Electron’s security checklist explicitly emphasizes:

- limiting new windows
- not using `shell.openExternal` with untrusted content
- validating IPC senders
- not exposing unnecessary Electron APIs

VarLens is better here than before, but the renderer/main surface is still broader than ideal.

### Path to >8/10

1. Resolve transitive dependency mismatch cleanly and verify lockfile state.
2. Audit IPC channels for sender validation where relevant.
3. Keep preload surface narrow and typed.
4. Add a lightweight security checklist to release preparation.

Expected result:

- Security moves from **8.0 -> 8.5+**

---

## Recommended 90-Day Plan

## Phase 1: Make the gates honest (Week 1-2)

Goal: stop pretending the current 70% gate is useful.

Deliverables:

- replace global 70% coverage thresholds with realistic global + per-glob thresholds
- enable coverage reporting in CI
- make release workflow at least as strict as build workflow
- add json-summary and HTML coverage artifacts

Success criteria:

- `npm run test:coverage` passes locally and in CI
- thresholds fail only on real regression

## Phase 2: Finish the boundary cleanup (Week 2-5)

Goal: remove architecture drift at the preload/shared boundary.

Deliverables:

- canonicalize `WindowAPI`
- remove renderer imports from `src/main/**`
- collapse `FilterState` to one shared source of truth
- ban raw `window.api` except in approved wrappers

Success criteria:

- renderer compiles without boundary-breaking imports
- `as any` usage in renderer/preload drops sharply

## Phase 3: Turn workers and IPC into testable units (Week 4-8)

Goal: make the high-complexity orchestration layers cheap to verify.

Deliverables:

- thin worker entrypoints
- extracted pure worker logic modules
- handler tests for critical IPC paths
- standard success/failure transport helper

Success criteria:

- `main/ipc/handlers` coverage >25%
- `main/workers` coverage >35%

## Phase 4: Make responsiveness measurable (Week 6-12)

Goal: improve perceived speed, not just backend throughput.

Deliverables:

- startup and interaction budgets
- instrumentation for cold start and key interactions
- virtualization audit for large list/table paths
- deferred initialization for non-critical work
- reactivity audit for annotation/filter/table flows

Success criteria:

- measurable drop in case-switch and filter-apply latency
- no obvious renderer jank on large tables

---

## Concrete Engineering Policies To Adopt

These policies would do more for maintainability than another round of broad refactoring.

1. **No new renderer import from `src/main/**`**
2. **No new raw `window.api` usage outside approved API wrappers**
3. **Every new IPC handler gets one handler-level test**
4. **Every worker file must keep its entry wrapper thin**
5. **Every performance-sensitive list must document whether it is virtualized**
6. **Every release path must run at least the same checks as build/PR**
7. **Coverage thresholds must reflect reality and then ratchet upward**

---

## Path to >8/10 Everywhere

If the team executes only four things well, the codebase crosses the threshold:

1. **Fix coverage governance**
   - honest thresholds
   - enforced in CI
   - parity in release workflow
2. **Finish process-boundary cleanup**
   - shared contracts only
   - no renderer dependence on main internals
3. **Raise test depth where orchestration risk is highest**
   - handlers
   - workers
   - preload/IPC contract tests
4. **Make responsiveness measurable**
   - startup
   - table interactions
   - filtering
   - annotations

That is the shortest credible route to:

- better maintainability
- better engineering discipline
- faster UI feel
- fewer regressions
- an honest **8+/10** codebase

---

## Sources and Best-Practice References

Primary sources used to shape the recommendations:

- Electron Security Checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron Performance Guide: https://www.electronjs.org/docs/latest/tutorial/performance
- Electron Context Isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Vitest Coverage Guide: https://vitest.dev/guide/coverage.html
- Vitest Coverage Config Reference: https://vitest.dev/config/coverage
- Vue Performance Guide: https://vuejs.org/guide/best-practices/performance
- Vue Style Guide: https://vuejs.org/style-guide/
- TypeScript `noImplicitAny`: https://www.typescriptlang.org/tsconfig/noImplicitAny.html
- TypeScript TSConfig Reference: https://www.typescriptlang.org/tsconfig/
- Node.js Worker Threads: https://nodejs.org/docs/latest-v22.x/api/worker_threads.html

### Notes on interpretation

- Electron’s official guidance strongly supports the current direction of keeping the preload surface narrow, validating navigation/window creation, and avoiding broad API exposure.
- Vitest’s official coverage documentation supports realistic thresholds, per-glob thresholds, and `autoUpdate`-style ratcheting instead of permanent aspirational failure.
- Vue’s performance guidance supports virtualization, code splitting, stable props, and reducing reactivity overhead in exactly the table-heavy flows that matter most in VarLens.
- TypeScript’s strictness guidance reinforces that `any` escape hatches should be treated as debt, not architecture.

