# PR 2: Coverage & Type Safety — Design Spec

> **Parent spec:** [stability-hardening-design.md](2026-04-01-stability-hardening-design.md)
> **Predecessor:** PR 1 (correctness & security) — merged as v0.49.0
> **Branch:** `refactor/coverage-type-safety` off `main`
> **Merge strategy:** Single PR, one atomic commit per task

## Goal

Stabilize the test coverage pipeline, enforce coverage thresholds in CI, convert IPC handler tests to the DI pattern, extract testable logic from workers, and eliminate cross-boundary type imports and `as any` casts.

## Scope

9 tasks (2.0–2.8) from the parent spec. All tasks are independently shippable within the PR. No behavioral changes to the application — this is purely test infrastructure, type safety, and code organization.

## Not in Scope

- Architectural refactors (PR 3)
- New features or UI changes
- Performance optimizations
- `useFilterState` decomposition (PR 3, depends on 2.8)

---

## Task Descriptions

### 2.0 Stabilize Coverage Pipeline

**Problem:** `ENOENT` in `coverage/.tmp/` reported when running coverage in isolated workspaces.

**Approach:**
1. Reproduce: run `npm run test:coverage` in a clean checkout
2. If reproduces: investigate v8 provider temp directory handling (likely parallel test file race condition). Fix by configuring `coverage.reportsDirectory` or temp dir in `vitest.config.ts`
3. If doesn't reproduce locally: add CI verification step asserting coverage JSON output exists
4. Verify `npm run test:coverage` exits 0 consistently (run 3x)

**Files modified:** `vitest.config.ts` (if temp dir fix needed), possibly `package.json` scripts

**Verification:** `npm run test:coverage` exits 0 three consecutive times

---

### 2.1 Set Realistic Coverage Thresholds

**Depends on:** 2.0

**Approach:**
1. Run `npm run test:coverage` and record actual per-directory coverage
2. Replace global 70% threshold with per-directory thresholds based on actuals:
   - Well-covered areas: hold at current level (or slightly above)
   - Low-coverage areas: set floor at current level (no regression)
3. Enable `autoUpdate` ratcheting so thresholds increase automatically as coverage improves

**Files modified:** `vitest.config.ts`

**Verification:** `npm run test:coverage` passes with new thresholds

---

### 2.2 Wire Coverage Into CI

**Depends on:** 2.0, 2.1

**Approach:**
1. In `.github/workflows/build.yml`: change test step to `npm run test:coverage` (at minimum ubuntu runner; optionally all platforms)
2. Add `json-summary` to coverage reporters in `vitest.config.ts`
3. Add `davelosert/vitest-coverage-report-action@v2` step for PR coverage comments
4. Add lint + typecheck steps to `.github/workflows/release.yml` for parity with build workflow

**Files modified:** `.github/workflows/build.yml`, `.github/workflows/release.yml`, `vitest.config.ts`

**Verification:** Push to a test branch, verify CI runs coverage and posts PR comment

---

### 2.3 Convert IPC Handler Tests

**Approach:**
Rewrite 6 handler test files using the `auth-handlers.test.ts` DI pattern:
- Mock `ipcMain.handle` to capture handler registrations
- Create real dependencies via DI (real DB, real services)
- Invoke handlers through the captured registration
- Assert on return values and side effects

**Files to create/rewrite (priority order):**
1. `tests/main/handlers/variant-handlers.test.ts`
2. `tests/main/handlers/database-handlers.test.ts`
3. `tests/main/handlers/case-handlers.test.ts`
4. `tests/main/handlers/cohort-handlers.test.ts`
5. `tests/main/handlers/annotation-handlers.test.ts`
6. `tests/main/handlers/import-handlers.test.ts`

**Reference:** `tests/main/handlers/auth-handlers.test.ts` (existing, working pattern)

**Verification:** All new tests pass, total test count increases

---

### 2.4 Extract Worker Business Logic

**Approach:**
Extract pure business logic from each worker into importable, testable modules:

| Worker entry | Logic module | Responsibility |
|---|---|---|
| `import-worker.ts` | `import-logic.ts` | Parsing + batch insert |
| `delete-worker.ts` | `delete-logic.ts` | Case/DB deletion logic |
| `export-worker.ts` | `export-logic.ts` | Export serialization |

Worker entry files become thin messaging shells (receive message → call logic → post result).

Logic modules accept a database connection and return results — no `parentPort`, no `workerData`.

**Files created:** `src/main/workers/import-logic.ts`, `delete-logic.ts`, `export-logic.ts`
**Files modified:** `src/main/workers/import-worker.ts`, `delete-worker.ts`, `export-worker.ts`
**Tests:** Logic module tests with in-memory SQLite

**Verification:** All existing tests pass, new logic module tests pass

---

### 2.5 Extract `safeEmit` to Shared Utility

**Problem:** Identical `safeEmit` function copied in 4 IPC handler files.

**Approach:**
1. Create `src/main/ipc/utils/safeEmit.ts` with the shared implementation
2. Replace local copies in `cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

**Files created:** `src/main/ipc/utils/safeEmit.ts`
**Files modified:** `src/main/ipc/handlers/cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`

**Verification:** All existing tests pass, grep confirms no remaining local `safeEmit` definitions

---

### 2.6 Re-Export Shared Types (Remove Renderer → Main Imports)

**Problem:** ~8 renderer files import types directly from `src/main/database/types` and other main-process modules, violating the process boundary.

**Approach:**
1. Identify all cross-boundary type imports in `src/renderer/`
2. Re-export needed types through `src/shared/types/` modules (e.g., `src/shared/types/database.ts` or existing modules)
3. Update all renderer imports to use `src/shared/types/`

Known imports to move:
- `VariantAnnotation`, `CaseVariantAnnotation` from `main/database/types`
- `VepTranscriptConsequence`, `VcfPreviewResult` from main modules
- `Tag`, `GeneList` and other domain types

**Files modified:** `src/shared/types/` modules, ~8 renderer files

**Verification:** `npm run typecheck` passes, grep confirms no `from '.*main/` imports in `src/renderer/`

---

### 2.7 Fix WindowAPI `as any` Casts

**Depends on:** 2.6

**Approach:**
1. **Bucket A (zero risk):** Remove `as any` casts where methods already exist in the WindowAPI interface (~15 instances)
2. **Bucket B:** Audit `src/preload/index.ts` against `src/shared/types/api.ts` — add missing methods to WindowAPI sub-interfaces, then remove casts
3. Target: eliminate all ~34 `as any` occurrences in renderer `.ts` and `.vue` files (excluding legitimate uses like JSON parsing or test mocks)

**Files modified:** `src/shared/types/api.ts`, ~19 renderer files

**Verification:** `npm run typecheck` passes, `as any` count in renderer reduced to near zero

---

### 2.8 Consolidate FilterState Types

**Approach:**
1. Define canonical types in `src/shared/types/filters.ts`:
   - `FilterStateBase` — common fields
   - `CaseFilterState extends FilterStateBase` — case-level filtering
   - `CohortFilterState extends FilterStateBase` — cohort-level filtering
2. Preserve existing wire semantics (`annotationScope: 'case' | 'all'`)
3. Delete `src/renderer/src/composables/filter-types.ts`
4. Update `useFilters.ts` to import from shared
5. Resolve existing TODO at `filters.ts:14`

**Files modified:** `src/shared/types/filters.ts`, `src/renderer/src/composables/useFilters.ts`
**Files deleted:** `src/renderer/src/composables/filter-types.ts`

**Verification:** `npm run typecheck` passes, deleted file is gone, no imports reference it

---

## Execution Waves

```
Wave A (independent — can run in parallel):
  2.0  Coverage stability
  2.3  IPC handler tests (6 files)
  2.4  Worker logic extraction
  2.5  safeEmit utility
  2.6  Shared type re-exports
  2.8  FilterState consolidation

Wave B (after Wave A dependencies resolve):
  2.1  Coverage thresholds       ← depends on 2.0
  2.7  Fix as-any casts          ← depends on 2.6

Wave C (after Wave B):
  2.2  Wire coverage into CI     ← depends on 2.0, 2.1
```

## Success Criteria

1. `npm run lint` passes
2. `npm run typecheck` passes
3. `npm run test:coverage` passes with per-directory thresholds
4. CI runs coverage and posts PR coverage comment
5. Zero renderer → main imports (type boundary enforced)
6. `as any` count in renderer reduced to near zero
7. All IPC handlers have DI-pattern tests
8. Worker logic is testable without worker threads
9. No duplicate `safeEmit` implementations
10. FilterState types consolidated in shared module
