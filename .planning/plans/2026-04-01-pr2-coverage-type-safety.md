# PR 2: Coverage & Type Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the test coverage pipeline, enforce coverage in CI, convert IPC handler tests to DI pattern, extract testable worker logic, and eliminate cross-boundary type violations and `as any` casts.

**Architecture:** 9 tasks across 3 execution waves. Wave A tasks are independent. Wave B depends on Wave A completions (2.1←2.0, 2.7←2.6). Wave C depends on Wave B (2.2←2.0+2.1). Branch `refactor/coverage-type-safety` off `main`, one atomic commit per task, single PR.

**Tech Stack:** TypeScript, Vitest, v8 coverage provider, GitHub Actions, Zod, better-sqlite3-multiple-ciphers, Vue 3

**Spec:** [.planning/specs/2026-04-01-pr2-coverage-type-safety-design.md](../specs/2026-04-01-pr2-coverage-type-safety-design.md)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/main/ipc/utils/safeEmit.ts` | Shared safe window emit utility |
| `src/shared/types/database.ts` | Canonical database entity types (moved from main) |
| `src/shared/types/import.ts` | Import-related types (moved from main) |
| `src/shared/types/gene-reference.ts` | Gene reference types (moved from main) |
| `src/shared/types/panel.ts` | Panel types (moved from main) |

### Modified Files
| File | What Changes |
|------|-------------|
| `vitest.config.ts` | Coverage temp dir fix, per-directory thresholds, json-summary reporter |
| `.github/workflows/build.yml` | Switch test step to coverage, add coverage report action |
| `.github/workflows/release.yml` | Add lint + typecheck steps |
| `tests/main/handlers/variants-handlers.test.ts` | Rewrite to DI pattern |
| `tests/main/handlers/cases-handlers.test.ts` | Rewrite to DI pattern |
| `tests/main/handlers/cohort-handlers.test.ts` | Rewrite to DI pattern |
| `tests/main/handlers/annotations-handlers.test.ts` | Rewrite to DI pattern |
| `tests/main/handlers/export-handlers.test.ts` | Rewrite to DI pattern |
| `src/main/ipc/handlers/cases.ts` | Replace local safeEmit with import |
| `src/main/ipc/handlers/cohort.ts` | Replace local safeEmit with import |
| `src/main/ipc/handlers/import.ts` | Replace local safeEmit with import |
| `src/main/ipc/handlers/batch-import.ts` | Replace local safeEmit with import |
| `src/main/database/types.ts` | Re-export from shared instead of defining locally |
| `src/shared/types/api.ts` | Import from shared types instead of main |
| `src/shared/types/filters.ts` | Add tagIds, annotationScope; merge filter-types.ts types |
| `src/renderer/src/composables/useFilterState.ts` | Import from shared filters |
| `src/renderer/src/composables/useFilterExport.ts` | Import from shared filters |
| `src/renderer/src/composables/useFilterPresets.ts` | Import from shared filters |
| ~8 renderer files | Update imports from main → shared |
| ~19 renderer files | Remove `as any` casts |

### Deleted Files
| File | Reason |
|------|--------|
| `src/renderer/src/composables/filter-types.ts` | Consolidated into `src/shared/types/filters.ts` |

---

## Task 0: Fix Coverage Pipeline (2.0)

**Files:**
- Modify: `vitest.config.ts:42-58`

The ENOENT bug is confirmed: `coverage/.tmp/coverage-31.json` not found. This is a known vitest v8 provider issue where forked workers write coverage files to a temp directory that gets cleaned up before all files are read. Fix by setting an explicit temp directory outside the coverage output.

- [ ] **Step 1: Verify the ENOENT reproduces**

Run: `npm run test:coverage 2>&1 | tail -20`
Expected: `ENOENT: no such file or directory, open '.../coverage/.tmp/coverage-*.json'`

- [ ] **Step 2: Add explicit coverage temp directory**

Modify `vitest.config.ts`. In the `coverage` block, add a `processingConcurrency` limit to serialize coverage file processing:

```typescript
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/renderer/src/main.ts',
        'src/renderer/src/plugins/**'
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      },
      processingConcurrency: 1
    }
```

If `processingConcurrency` does not exist in the vitest version used, try setting `reportsDirectory` to an explicit path outside the default:

```typescript
      reportsDirectory: './coverage',
```

- [ ] **Step 3: Test the fix**

Run: `npm run test:coverage 2>&1 | tail -20`
Expected: No ENOENT error. Coverage report generated successfully.

- [ ] **Step 4: Run coverage 3 times to verify stability**

Run: `npm run test:coverage && npm run test:coverage && npm run test:coverage`
Expected: All 3 runs exit 0 without ENOENT.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "fix: stabilize v8 coverage pipeline (ENOENT in .tmp/)

Coverage provider race condition caused ENOENT when reading temp
coverage files from forked workers. Fix by serializing coverage
file processing."
```

---

## Task 1: Set Coverage Thresholds (2.1)

**Depends on:** Task 0

**Files:**
- Modify: `vitest.config.ts:42-58`

- [ ] **Step 1: Run coverage and record per-directory actuals**

Run: `npm run test:coverage -- --reporter=json-summary 2>&1 | grep -A 5 "Coverage"`

Also check the generated coverage summary:
Run: `cat coverage/coverage-summary.json | npx -y json -a key pct 2>/dev/null || cat coverage/coverage-summary.json | head -100`

Record the actual line/branch/function/statement percentages for key directories.

- [ ] **Step 2: Replace global thresholds with per-directory floors**

Modify `vitest.config.ts`. Replace the `thresholds` block based on actual coverage numbers. Use a pattern like:

```typescript
      thresholds: {
        autoUpdate: true,
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30
      }
```

Set the global floor conservatively (at or slightly below the lowest directory), and use `autoUpdate: true` to ratchet thresholds upward automatically as coverage improves. The `autoUpdate` flag will rewrite `vitest.config.ts` with higher thresholds after each passing run.

- [ ] **Step 3: Verify coverage passes with new thresholds**

Run: `npm run test:coverage`
Expected: Passes with the new threshold configuration.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "feat: set realistic coverage thresholds with auto-ratcheting

Replace global 70% threshold with conservative floors based on actual
per-directory coverage. Enable autoUpdate to prevent regression and
automatically ratchet thresholds upward."
```

---

## Task 2: Wire Coverage Into CI (2.2)

**Depends on:** Task 0, Task 1

**Files:**
- Modify: `.github/workflows/build.yml:67-68`
- Modify: `.github/workflows/release.yml` (add lint + typecheck)
- Modify: `vitest.config.ts` (add json-summary reporter)

- [ ] **Step 1: Add json-summary reporter to vitest config**

Modify `vitest.config.ts`. Add reporters to the coverage block:

```typescript
      reporter: ['text', 'json-summary', 'json'],
```

- [ ] **Step 2: Switch CI test step to coverage (ubuntu only)**

Modify `.github/workflows/build.yml`. Change the test step (line 67-68):

Old:
```yaml
      - name: Run tests
        run: npm run test
```

New:
```yaml
      - name: Run tests
        run: npm run test
        if: runner.os != 'Linux'

      - name: Run tests with coverage
        run: npm run test:coverage
        if: runner.os == 'Linux'
```

- [ ] **Step 3: Add coverage report action for PRs**

Add after the test steps in `.github/workflows/build.yml`:

```yaml
      - name: Coverage report
        if: runner.os == 'Linux' && github.event_name == 'pull_request'
        uses: davelosert/vitest-coverage-report-action@v2
        with:
          json-summary-path: coverage/coverage-summary.json
          json-final-path: coverage/coverage-final.json
```

Note: This action requires `permissions: pull-requests: write` on the job. Add it to the build job permissions.

- [ ] **Step 4: Add lint + typecheck to release workflow**

Modify `.github/workflows/release.yml`. Add steps to each release job (linux, macos, windows) after `Rebuild native modules for Node.js` and before `Run tests`:

```yaml
      - name: Run linter
        run: npm run lint:check

      - name: Run type check
        run: npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build.yml .github/workflows/release.yml vitest.config.ts
git commit -m "ci: run coverage on ubuntu, add PR coverage comments, add lint to release

Coverage runs on ubuntu-latest only (other platforms run plain tests).
PR coverage comments via vitest-coverage-report-action. Release workflow
now runs lint + typecheck for parity with build workflow."
```

---

## Task 3: Extract safeEmit Utility (2.5)

**Files:**
- Create: `src/main/ipc/utils/safeEmit.ts`
- Modify: `src/main/ipc/handlers/cases.ts:18-22`
- Modify: `src/main/ipc/handlers/cohort.ts:19-23`
- Modify: `src/main/ipc/handlers/import.ts:12-19`
- Modify: `src/main/ipc/handlers/batch-import.ts:21-28`

- [ ] **Step 1: Create the shared safeEmit utility**

Create `src/main/ipc/utils/safeEmit.ts`:

```typescript
import { BrowserWindow } from 'electron'
import { mainLogger } from '../../services/MainLogger'

/**
 * Safely send a message to the renderer via the first BrowserWindow.
 * No-ops if the window is destroyed (e.g., during shutdown).
 */
export function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) {
    mainLogger.warn(`Window closed, skipping ${channel}`, 'ipc')
    return
  }
  win.webContents.send(channel, data)
}
```

- [ ] **Step 2: Replace local safeEmit in cases.ts**

In `src/main/ipc/handlers/cases.ts`, remove lines 18-22 (the local `function safeEmit`) and add import at top:

```typescript
import { safeEmit } from '../utils/safeEmit'
```

- [ ] **Step 3: Replace local safeEmit in cohort.ts**

In `src/main/ipc/handlers/cohort.ts`, remove lines 19-23 and add import:

```typescript
import { safeEmit } from '../utils/safeEmit'
```

- [ ] **Step 4: Replace local safeEmit in import.ts**

In `src/main/ipc/handlers/import.ts`, remove lines 12-19 and add import:

```typescript
import { safeEmit } from '../utils/safeEmit'
```

- [ ] **Step 5: Replace local safeEmit in batch-import.ts**

In `src/main/ipc/handlers/batch-import.ts`, remove lines 21-28 and add import:

```typescript
import { safeEmit } from '../utils/safeEmit'
```

- [ ] **Step 6: Verify no local safeEmit definitions remain**

Run: `grep -rn "function safeEmit" src/main/ipc/handlers/`
Expected: No output (all local copies removed).

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/utils/safeEmit.ts \
  src/main/ipc/handlers/cases.ts src/main/ipc/handlers/cohort.ts \
  src/main/ipc/handlers/import.ts src/main/ipc/handlers/batch-import.ts
git commit -m "refactor: extract safeEmit to shared IPC utility

Identical safeEmit function was copied in 4 handler files. Extract
to src/main/ipc/utils/safeEmit.ts with consistent logging."
```

---

## Task 4: Move Canonical Type Ownership to Shared (2.6)

**Files:**
- Create: `src/shared/types/database.ts`
- Create: `src/shared/types/import.ts`
- Create: `src/shared/types/gene-reference.ts`
- Create: `src/shared/types/panel.ts`
- Modify: `src/main/database/types.ts`
- Modify: `src/main/import/types.ts`
- Modify: `src/main/database/GeneReferenceDb.ts`
- Modify: `src/main/database/PanelRepository.ts`
- Modify: `src/shared/types/api.ts`
- Modify: ~8 renderer files

This is a large type migration. The approach:
1. Copy pure type definitions from `src/main/` to `src/shared/types/`
2. Update `src/main/` files to re-export from shared (backward compat)
3. Update `src/shared/types/api.ts` to import from shared
4. Update renderer files to import from shared

- [ ] **Step 1: Read all source files to understand type ownership**

Read `src/main/database/types.ts`, `src/main/import/types.ts`, `src/main/database/GeneReferenceDb.ts`, `src/main/database/PanelRepository.ts`, and `src/shared/types/api.ts` to identify all types that need to move.

- [ ] **Step 2: Create `src/shared/types/database.ts`**

Copy all pure type/interface exports from `src/main/database/types.ts` to the new file. These are types with no runtime dependencies — only `import type` references. Include:
- `Case`, `CaseWithCohorts`, `CaseSearchParams`, `AffectedStatus`, `CaseSex`
- `Variant`, `VariantFilter`, `PaginatedResult`, `SortItem`
- `VariantAnnotation`, `CaseVariantAnnotation`
- `CaseMetadata`, `CohortGroup`, `CaseHpoTerm`
- `Tag`, `CaseComment`, `CommentCategory`
- `MetricDefinition`, `CaseMetric`, `CaseMetricWithDefinition`
- `AuditLogEntry`, `CaseDataInfo`, `CaseDataInfoUpdates`
- `CaseExternalId`, `GeneList`, `GeneListWithCount`, `RegionFile`
- `AcmgClassification` (already in `domain.config.ts`, re-export from there)
- `AcmgEvidence`, `FilterOptions`, `AcmgEvidenceState`, etc.

Do NOT move types that depend on runtime imports (e.g., `Database` from better-sqlite3).

- [ ] **Step 3: Create `src/shared/types/import.ts`**

Copy from `src/main/import/types.ts`:
- `ProgressUpdate`, `ProgressCallback`, `ImportOptions`, `ImportResult`
- `FieldMapping`, `RawVariantRow`, `DataDictionaries`
- `DuplicateChoice`, `BatchImportOptions`

- [ ] **Step 4: Create `src/shared/types/gene-reference.ts`**

Copy from `src/main/database/GeneReferenceDb.ts`:
- `GeneValidationResult`, `GeneAutocompleteResult`, `GeneRefInfo`, `AssemblyInfo`

- [ ] **Step 5: Create `src/shared/types/panel.ts`**

Copy from `src/main/database/PanelRepository.ts`:
- `PanelRow`, `PanelWithCount`, `PanelGeneRow`, `ActivePanelRow`

And from `src/main/services/api/PanelAppClient.ts`:
- `PanelAppSearchResult`

- [ ] **Step 6: Update main files to re-export from shared**

In `src/main/database/types.ts`, replace type definitions with re-exports:
```typescript
export type { Case, CaseWithCohorts, ... } from '../../shared/types/database'
```

Keep any types that depend on runtime main-process code (e.g., types parameterized by `Database`).

Same pattern for `src/main/import/types.ts`, `GeneReferenceDb.ts`, `PanelRepository.ts`.

- [ ] **Step 7: Update `src/shared/types/api.ts` imports**

Replace all `import type { ... } from '../../main/...'` with imports from the new shared type files:

```typescript
import type { Case, Variant, ... } from './database'
import type { ProgressUpdate, ImportResult } from './import'
import type { GeneValidationResult, ... } from './gene-reference'
import type { PanelRow, ... } from './panel'
```

- [ ] **Step 8: Update renderer files**

Update all ~8 renderer files that import from `src/main/`:
- Change `from '../../../../main/database/types'` to `from '../../../../shared/types/database'`
- Change `from '../../../main/services/api/schemas/vep-response'` to import from an appropriate shared location (or through `api.ts`)

- [ ] **Step 9: Verify no cross-boundary imports remain**

Run: `grep -rn "from '.*main/" src/renderer/ src/shared/ | grep -v node_modules`
Expected: No output — all cross-boundary imports eliminated.

- [ ] **Step 10: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: Both pass.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types/database.ts src/shared/types/import.ts \
  src/shared/types/gene-reference.ts src/shared/types/panel.ts \
  src/main/database/types.ts src/main/import/types.ts \
  src/main/database/GeneReferenceDb.ts src/main/database/PanelRepository.ts \
  src/shared/types/api.ts src/renderer/
git commit -m "refactor: move canonical type ownership to src/shared/types/

Database, import, gene reference, and panel types now live in shared.
Main-process files re-export for backward compatibility. Renderer and
shared layers no longer import from src/main/."
```

---

## Task 5: Consolidate FilterState Types (2.8)

**Files:**
- Modify: `src/shared/types/filters.ts`
- Modify: `src/renderer/src/composables/useFilterState.ts`
- Modify: `src/renderer/src/composables/useFilterExport.ts`
- Modify: `src/renderer/src/composables/useFilterPresets.ts`
- Delete: `src/renderer/src/composables/filter-types.ts`

The shared `FilterState` already has most fields. Only 2 fields are missing: `tagIds` and `annotationScope`. The shared version also has `minCarriers` which the renderer version doesn't — keep it (cohort-only).

- [ ] **Step 1: Add missing fields to shared FilterState**

Modify `src/shared/types/filters.ts`. Add the two missing fields to the `FilterState` interface:

After `minCadd: number | null` (line 46), add:
```typescript
  /** Tag IDs for tag-based filtering (case view only) */
  tagIds: number[]
```

After `acmgClassifications: string[]` (line 54), add:
```typescript
  /** Annotation scope: 'case' for current case, 'all' for database-wide */
  annotationScope: 'case' | 'all'
```

Also add corresponding IPC fields to `FilterIpcParams`:
```typescript
  tag_ids?: number[]
  annotation_scope?: 'case' | 'all'
```

- [ ] **Step 2: Move helper types from filter-types.ts to shared**

Add to `src/shared/types/filters.ts` (after the existing interfaces):

```typescript
import type { Ref, ComputedRef } from 'vue'
import type { VariantFilter, Tag, FilterOptions } from './api'

/**
 * Options for configuring the useFilterState composable
 */
export interface UseFilterStateOptions {
  /** Callback when filters update (replaces emit('update:filters')) */
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  /** Callback to reset sort order (replaces emit('reset-sort')) */
  onResetSort: () => void
  /** Callback when case switches — used to clear UI state like DSL column filters */
  onCaseSwitch?: () => void
}

/**
 * Export result returned by exportToExcel
 */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
  cancelled?: boolean
}

/**
 * Return type for the useFilterState composable
 */
export interface UseFilterStateReturn {
  // State
  filters: Ref<FilterState>
  filterOptions: Ref<FilterOptions>
  geneSymbolSuggestions: Ref<string[]>
  loadingSuggestions: Ref<boolean>
  selectedImpactPresets: Ref<string[]>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>
  exporting: Ref<boolean>

  // Presets (readonly arrays)
  afPresets: readonly { label: string; value: number }[]
  caddPresets: readonly { label: string; value: number }[]
  impactPresets: readonly { label: string; value: string; color: string }[]

  // Tags
  availableTags: ComputedRef<Tag[]>

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFilterCount: ComputedRef<number>
  activeFiltersList: ComputedRef<ActiveFilter[]>

  // Methods
  isFilterGroupActive: (groupId: string) => boolean
  clearFilter: (filterId: string) => void
  removeTagFilter: (tagId: number) => void
  clearAllFilters: () => void
  handleGeneClear: () => void
  searchGeneSymbols: (query: string) => Promise<void>
  emitFilters: () => void
  loadFilterOptions: (caseId: number) => Promise<void>
  invalidateFilterOptionsCache: () => void
  resetForCaseSwitch: () => void
  setInitialSearch: (search: string) => void
  exportToExcel: (caseId: number, caseName: string) => Promise<ExportResult | null>
}
```

- [ ] **Step 3: Move buildFilterFromState to shared**

Add `buildFilterFromState` function from `filter-types.ts` to `src/shared/types/filters.ts` (or create `src/shared/utils/filters.ts` if it has runtime logic — since it's a pure function with no renderer dependencies, it can go in shared).

```typescript
/**
 * Build a VariantFilter object (without case_id) from filter state and impact presets.
 */
export function buildFilterFromState(
  filters: FilterState,
  selectedImpactPresets: string[]
): Omit<VariantFilter, 'case_id'> {
  // ... exact copy from filter-types.ts lines 105-177
}
```

- [ ] **Step 4: Update consumers to import from shared**

In `src/renderer/src/composables/useFilterState.ts`:
- Change: `from './filter-types'` → `from '../../../../shared/types/filters'`
- Update re-exports on line 42 to reference shared

In `src/renderer/src/composables/useFilterExport.ts`:
- Change: `from './filter-types'` → `from '../../../../shared/types/filters'`

In `src/renderer/src/composables/useFilterPresets.ts`:
- Change: `from './filter-types'` → `from '../../../../shared/types/filters'`

- [ ] **Step 5: Delete the old file**

Delete `src/renderer/src/composables/filter-types.ts`.

- [ ] **Step 6: Remove the TODO comment**

In `src/shared/types/filters.ts`, remove lines 13-14 (the TODO about consolidation — now done).

- [ ] **Step 7: Verify no imports reference the deleted file**

Run: `grep -rn "filter-types" src/`
Expected: No output.

- [ ] **Step 8: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: Both pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types/filters.ts \
  src/renderer/src/composables/useFilterState.ts \
  src/renderer/src/composables/useFilterExport.ts \
  src/renderer/src/composables/useFilterPresets.ts
git rm src/renderer/src/composables/filter-types.ts
git commit -m "refactor: consolidate FilterState types into src/shared/types/filters.ts

Merge tagIds, annotationScope from renderer filter-types.ts into shared
FilterState. Move UseFilterStateOptions, UseFilterStateReturn, ExportResult,
and buildFilterFromState to shared. Delete the renderer-local duplicate."
```

---

## Task 6: Convert IPC Handler Tests (2.3)

**Files:**
- Rewrite: `tests/main/handlers/variants-handlers.test.ts`
- Rewrite: `tests/main/handlers/cases-handlers.test.ts`
- Rewrite: `tests/main/handlers/cohort-handlers.test.ts`
- Rewrite: `tests/main/handlers/annotations-handlers.test.ts`
- Rewrite: `tests/main/handlers/export-handlers.test.ts`
- Reference: `tests/main/handlers/auth-handlers.test.ts`

All 5 test files currently test DB methods directly. They need to be rewritten to use the DI pattern from `auth-handlers.test.ts`:

1. Mock `ipcMain.handle` with `vi.fn()` to capture registrations
2. Import and call `registerXHandlers({ ipcMain: mockIpcMain, getDb, getDbManager })`
3. Use `invokeHandler(channel, ...args)` helper to test through IPC channels
4. Use real `DatabaseService(':memory:')` for integration testing

Each file follows the same conversion pattern. The implementer should:
1. Read `auth-handlers.test.ts` as the reference pattern
2. Read each stub to understand what it currently tests
3. Read the corresponding handler file to identify all channels
4. Rewrite to test channels through the DI pattern

- [ ] **Step 1: Rewrite variants-handlers.test.ts**

Read `src/main/ipc/handlers/variants.ts` to identify channels: `variants:query`, `variants:filterOptions`, `variants:search`, `variants:geneSymbols`.

Rewrite the test file using the DI pattern. Test at minimum:
- `variants:query` with valid filters returns paginated results
- `variants:query` with invalid caseId returns error
- `variants:filterOptions` returns filter options structure
- `variants:search` returns search results

- [ ] **Step 2: Run variants handler tests**

Run: `npx vitest run tests/main/handlers/variants-handlers.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Rewrite cases-handlers.test.ts**

Read `src/main/ipc/handlers/cases.ts` and `src/main/ipc/handlers/database.ts`. Test:
- `cases:list` returns all cases
- `cases:query` with valid search params
- `database:overview` returns overview data

- [ ] **Step 4: Run cases handler tests**

Run: `npx vitest run tests/main/handlers/cases-handlers.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Rewrite annotations-handlers.test.ts**

Read `src/main/ipc/handlers/annotations.ts`. Test:
- `annotations:getForVariant` returns annotations for a variant
- `annotations:upsertGlobal` creates/updates global annotation
- `annotations:upsertPerCase` creates/updates per-case annotation
- `annotations:deleteGlobal` removes global annotation
- `annotations:batchGet` returns batch results

- [ ] **Step 6: Run annotations handler tests**

Run: `npx vitest run tests/main/handlers/annotations-handlers.test.ts`
Expected: All tests pass.

- [ ] **Step 7: Rewrite cohort-handlers.test.ts**

Read `src/main/ipc/handlers/cohort.ts`. Test:
- `cohort:variants` returns cohort variant data
- `cohort:summary` returns cohort summary
- `cohort:carriers` returns carrier information

- [ ] **Step 8: Run cohort handler tests**

Run: `npx vitest run tests/main/handlers/cohort-handlers.test.ts`
Expected: All tests pass.

- [ ] **Step 9: Rewrite export-handlers.test.ts**

Read `src/main/ipc/handlers/export.ts`. Test:
- Export handler returns variant data in expected format
- Filters are applied correctly to export data

- [ ] **Step 10: Run export handler tests**

Run: `npx vitest run tests/main/handlers/export-handlers.test.ts`
Expected: All tests pass.

- [ ] **Step 11: Run all handler tests together**

Run: `npx vitest run tests/main/handlers/`
Expected: All handler tests pass (including existing auth-handlers).

- [ ] **Step 12: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass, total test count has increased.

- [ ] **Step 13: Commit**

```bash
git add tests/main/handlers/
git commit -m "test: convert IPC handler tests to DI pattern

Rewrite 5 handler test files (variants, cases, annotations, cohort,
export) to use the auth-handlers.test.ts DI pattern: mock ipcMain,
register handlers with real DB, invoke through channel names."
```

---

## Task 7: Fix WindowAPI as-any Casts (2.7)

**Depends on:** Task 4 (type ownership moved to shared)

**Files:**
- Modify: `src/shared/types/api.ts` (add missing methods)
- Modify: ~19 renderer files (remove `as any` casts)

- [ ] **Step 1: Audit missing methods**

Compare `src/preload/index.ts` against `src/shared/types/api.ts`. For each `as any` cast in the renderer, check if the method exists in the WindowAPI interface. Categorize:
- **Bucket A:** Method exists in interface → just remove the cast
- **Bucket B:** Method missing → add to interface, then remove cast

- [ ] **Step 2: Add missing methods to WindowAPI sub-interfaces**

In `src/shared/types/api.ts`, add any missing methods to the appropriate sub-interfaces. Common missing methods (from the `as any` analysis):
- `cohort.getCarriers`, `cohort.getVariants`, `cohort.getSummary`
- `cohort.runAssociation`, `cohort.cancelAssociation`, `cohort.onAssociationProgress`
- `cohort.getGeneBurden`
- `variants.geneSymbols`, `variants.getFilterOptions`, `variants.query`
- `export.variants`, `export.cohort`
- `geneLists.getGenes`, `geneLists.delete`, `geneLists.list`
- `regionFiles` sub-interface
- `import.selectFile`
- `shell.showItemInFolder`

Match signatures to what `src/preload/index.ts` actually exposes.

- [ ] **Step 3: Remove as-any casts from renderer files**

For each file with `as any` casts:
- Replace `(api as any).method()` with `api.method()`
- Replace `(window as any).api` with proper typed access via `useApiService()`
- For `GeneBurdenView.vue` which uses `(window as any).api` directly, refactor to use `useApiService()`

Skip legitimate `as any` uses (JSON parsing, test mocks, backward compat migration).

- [ ] **Step 4: Verify as-any count**

Run: `grep -rn "as any" src/renderer/ --include='*.ts' --include='*.vue' | wc -l`
Expected: Near zero (only legitimate uses remain).

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: Both pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/api.ts src/renderer/
git commit -m "refactor: eliminate as-any casts in renderer by typing WindowAPI

Add missing methods to WindowAPI sub-interfaces to match preload
exposures. Remove ~34 as-any casts from renderer components and
composables."
```

---

## Task 8: Extract Worker Business Logic (2.4)

**Files:**
- Create: `src/main/workers/export-renderer.ts`
- Create: `tests/main/workers/export-renderer.test.ts`
- Create: `src/main/workers/delete-operations.ts`
- Create: `tests/main/workers/delete-operations.test.ts`
- Modify: `src/main/workers/export-worker.ts`
- Modify: `src/main/workers/delete-worker.ts`

**Note:** `import-worker.ts` is 840 lines with deep coupling to streaming, cancellation, format detection, and progress throttling. Extracting its logic is a significantly larger effort than export/delete. This task extracts export and delete logic only. Import worker extraction is deferred to a follow-up task to keep the PR manageable.

- [ ] **Step 1: Extract export formatting logic**

Create `src/main/workers/export-renderer.ts` with the pure formatting functions from `export-worker.ts`:

```typescript
/**
 * Export data formatting utilities.
 * Pure functions extracted from export-worker for testability.
 */

/** Format a cell value for export (gnomAD AF as exponential, CADD as fixed decimal) */
export function formatCellValue(value: unknown, column: string): string {
  // Copy from export-worker.ts formatCellValue (lines 32-44)
}

/** Escape a value for RFC 4180 CSV */
export function csvEscape(value: string): string {
  // Copy from export-worker.ts csvEscape (lines 47-58)
}

/** Build XLSX metadata sheet rows */
export function buildMetadataRows(
  caseName: string,
  variantCount: number,
  filters: Record<string, unknown>
): Array<Record<string, string>> {
  // Extract metadata construction from runXlsx (lines 164-191)
}
```

- [ ] **Step 2: Write tests for export renderer**

Create `tests/main/workers/export-renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatCellValue, csvEscape, buildMetadataRows } from '../../../src/main/workers/export-renderer'

describe('formatCellValue', () => {
  it('formats gnomAD AF in exponential notation', () => {
    expect(formatCellValue(0.001, 'gnomad_af')).toBe('1.00e-3')
  })
  it('formats CADD as fixed decimal', () => {
    expect(formatCellValue(25.123, 'cadd')).toBe('25.12')
  })
  it('returns string for other columns', () => {
    expect(formatCellValue('BRCA1', 'gene_symbol')).toBe('BRCA1')
  })
  it('handles null values', () => {
    expect(formatCellValue(null, 'gene_symbol')).toBe('')
  })
})

describe('csvEscape', () => {
  it('wraps values containing commas in quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
  it('escapes double quotes', () => {
    expect(csvEscape('a"b')).toBe('"a""b"')
  })
  it('passes through simple values', () => {
    expect(csvEscape('BRCA1')).toBe('BRCA1')
  })
})
```

- [ ] **Step 3: Run export renderer tests**

Run: `npx vitest run tests/main/workers/export-renderer.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Update export-worker to import from shared**

Modify `src/main/workers/export-worker.ts` to import `formatCellValue` and `csvEscape` from `./export-renderer` instead of defining them locally.

- [ ] **Step 5: Extract delete operations logic**

Create `src/main/workers/delete-operations.ts` with the pure DB operations:

```typescript
import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * Delete operations extracted from delete-worker for testability.
 */

/** Delete all cases and their variants from the database */
export function deleteAllCases(db: Database.Database): void {
  // Extract from delete-worker.ts deleteAll logic
}

/** Delete specific cases by ID */
export function deleteCaseBatch(db: Database.Database, caseIds: number[]): void {
  // Extract from delete-worker.ts deleteBatch logic
}
```

- [ ] **Step 6: Write tests for delete operations**

Create `tests/main/workers/delete-operations.test.ts` testing with in-memory SQLite.

- [ ] **Step 7: Run delete operations tests**

Run: `npx vitest run tests/main/workers/delete-operations.test.ts`
Expected: All tests pass.

- [ ] **Step 8: Update delete-worker to import from shared**

Modify `src/main/workers/delete-worker.ts` to use functions from `./delete-operations`.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/main/workers/export-renderer.ts src/main/workers/delete-operations.ts \
  src/main/workers/export-worker.ts src/main/workers/delete-worker.ts \
  tests/main/workers/
git commit -m "refactor: extract testable logic from export and delete workers

Extract pure formatting functions (formatCellValue, csvEscape) and delete
operations into importable modules. Worker entry files remain as messaging
shells. Import worker deferred due to complexity (840 lines, streaming,
cancellation)."
```

---

## Final Verification

After all 9 tasks are committed:

- [ ] **Run full CI check locally**

```bash
npm run lint:check && npm run typecheck && npm run test:coverage
```

Expected: All pass with zero errors.

- [ ] **Verify boundary enforcement**

```bash
grep -rn "from '.*main/" src/renderer/ src/shared/ | grep -v node_modules
```

Expected: No cross-boundary imports.

- [ ] **Verify as-any reduction**

```bash
grep -rn "as any" src/renderer/ --include='*.ts' --include='*.vue' | wc -l
```

Expected: Near zero.

- [ ] **Verify all commits are atomic**

```bash
git log --oneline refactor/coverage-type-safety --not main
```

Expected: 9 commits, one per task.

- [ ] **Create PR**

```bash
gh pr create --title "refactor: coverage & type safety hardening (PR 2/3)" --body "$(cat <<'EOF'
## Summary

Second of three stability hardening PRs based on cross-AI code review.

- **Coverage pipeline**: Fixed ENOENT bug, set per-directory thresholds with auto-ratcheting, wired coverage into CI with PR comments
- **IPC handler tests**: Converted 5 test files to DI pattern (real DB, channel invocation)
- **Worker extraction**: Extracted testable logic from export and delete workers
- **safeEmit**: Deduplicated 4 identical copies into shared utility
- **Type boundary**: Moved canonical type ownership to src/shared/, eliminated renderer→main imports
- **as-any casts**: Added missing WindowAPI methods, removed ~34 casts
- **FilterState**: Consolidated dual definitions into single shared module

## Test plan
- [ ] `npm run lint:check` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test:coverage` passes with per-directory thresholds
- [ ] CI posts coverage comment on PR
- [ ] No renderer→main or shared→main imports remain
- [ ] `as any` count near zero in renderer

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
