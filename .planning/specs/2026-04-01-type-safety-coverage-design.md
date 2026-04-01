# VarLens Type Safety, Filter Decomposition & Coverage — Design Spec

**Date:** 2026-04-01
**Branch:** `refactor/type-safety-coverage` (off `main` after v0.51.0)
**Based on:** [UPDATED-CODE-REVIEW-2026-04-01.md](../code-review/UPDATED-CODE-REVIEW-2026-04-01.md)
**Goal:** Raise Architecture from 6.5 to 8.0+, Coverage/CI from 5.5 to 8.0+, and Code Quality from 7.0 to 8.2+ by eliminating type boundary violations, decomposing the largest remaining composable, and making coverage enforcement honest and operational.

---

## Scope

One PR with 4 logical phases:

1. **Type boundary cleanup** — kill every `(api as any)` / `(window as any)` cast, redirect all renderer→main imports, add ESLint guard
2. **useFilterState full decomposition** — extract 4 focused composables, reduce facade to ~150 lines
3. **Coverage infrastructure** — per-directory thresholds, CI enforcement, PR comments, release parity
4. **Tests for everything touched** — new composable tests, contract tests, coverage improvement

No user-visible behavior changes. The `UseFilterStateReturn` public API is unchanged.

---

## Phase 1: Type Boundary Cleanup

### 1.1 Missing WindowAPI Types

**ShellAPI** — add `showItemInFolder`:

```typescript
export interface ShellAPI {
  openExternal: (url: string) => Promise<void>
  showItemInFolder: (filePath: string) => Promise<void>
}
```

**WindowAPI** — verify `regionFiles: RegionFilesAPI` is present. Add if missing.

**Files:** `src/shared/types/api.ts`

### 1.2 Replace All 16 `(api as any)` / `(window as any)` Casts

| File | Casts | Root Cause |
|------|-------|-----------|
| `src/renderer/src/composables/useCohortData.ts` | 4 | Types exist, just cast unnecessarily |
| `src/renderer/src/components/CohortTable.vue` | 3 | Types exist + missing `showItemInFolder` |
| `src/renderer/src/components/cohort/CohortFilterBar.vue` | 2 | Types exist |
| `src/renderer/src/components/case-data-info/RegionFileImportDialog.vue` | 2 | `regionFiles` + `import.selectFile` |
| `src/renderer/src/components/FilterToolbar.vue` | 1 | Missing `showItemInFolder` |
| `src/renderer/src/components/GeneBurdenTable.vue` | 1 | Types exist |
| `src/renderer/src/components/variant-table/useVariantData.ts` | 1 | Types exist |
| `src/renderer/src/composables/useFilterExport.ts` | 1 | Types exist |
| `src/renderer/src/composables/useCarriers.ts` | 1 | Types exist |

For each: replace `(api as any).method()` with `api!.method()` or `api.method()` (depending on null guard context). Remove associated `eslint-disable-next-line` comments.

### 1.3 Redirect 23 Renderer→Main Imports

Three categories:

**Already re-exported (just update import paths):**
- `AcmgClassification` — already in `src/shared/config/domain.config.ts`
- `VepTranscriptConsequence`, `VepColocatedVariant` — already in `src/shared/types/api-enrichment.ts`

**Need new re-exports in `src/shared/types/database-entities.ts`:**
- `Tag`, `Variant`, `Case`, `VariantAnnotation`, `CaseVariantAnnotation`, `AuditLogEntry`, `AuditActionType`
- These are pure type re-exports (`export type { ... } from '../../main/database/types'`)

**Need new re-export in `src/shared/types/vcf.ts`:**
- `VcfPreviewResult` from `src/main/import/vcf/types`

**Files to update (15 renderer files):**
- `useAnnotations.ts`, `useAnnotationDialogs.ts`, `useTags.ts`, `useVepEnrichment.ts`
- `AcmgClassificationPanel.vue`, `AcmgEvidenceDialog.vue`, `AcmgMenu.vue`, `AcmgSummaryBar.vue`
- `ActivityLogPanel.vue`, `TagManagementDialog.vue`, `VariantDetailsPanel.vue`
- `TranscriptSection.vue`, `AnnotationScoresSection.vue`, `VariantIdentitySection.vue`
- `useVariantRowViewModel.ts`, `ImportWizard.vue`, `VcfPreviewStep.vue`
- `mocks/fixtures/cases.ts`, `mocks/fixtures/variants.ts`
- `utils/mergeTranscripts.ts`
- `CohortDataTable.vue`, `CohortTableRow.vue`

### 1.4 Consolidate filter-types.ts

Move from `src/renderer/src/composables/filter-types.ts` to `src/shared/types/filters.ts`:
- `FilterState` interface
- `ActiveFilter` interface
- `UseFilterStateOptions` interface
- `ExportResult` interface
- `UseFilterStateReturn` interface
- `buildFilterFromState()` function

Delete `src/renderer/src/composables/filter-types.ts`. Update importers:
- `useFilterState.ts`
- `useFilterExport.ts`
- `useFilterPresets.ts`

### 1.5 ESLint Restriction

Add `no-restricted-imports` rule to ESLint config to ban `src/main/` imports from `src/renderer/` files:

```javascript
{
  files: ['src/renderer/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/main/**'],
        message: 'Renderer must not import from main process. Use src/shared/ re-exports.'
      }]
    }]
  }
}
```

---

## Phase 2: useFilterState Full Decomposition

### Current State

`src/renderer/src/composables/useFilterState.ts` — 707 lines. Already delegates to:
- `useFilterCore()` — consequences, funcs, clinvars, numeric thresholds, ACMG
- `useFilterPresets()` — impact/AF/CADD preset management
- `useFilterExport()` — Excel export

### New Composables

**`src/renderer/src/composables/useGeneAutocomplete.ts`** (~50 lines)
- Constructor: `(api: WindowAPI | undefined, caseIdRef: Ref<number> | ComputedRef<number>)`
- Owns: `geneSymbolSuggestions: Ref<string[]>`, `loadingSuggestions: Ref<boolean>`
- Methods: `searchGeneSymbols(query: string)`, `handleGeneClear()`
- Calls `api!.variants.geneSymbols(caseId, query, 50)`

**`src/renderer/src/composables/useFilterOptionsCache.ts`** (~80 lines)
- Constructor: `(api: WindowAPI | undefined)`
- Owns: `filterOptions: Ref<FilterOptions>`, internal `LruMap<number, FilterOptions>(20)`
- Methods: `loadFilterOptions(caseId)`, `loadFilterOptionsAndTags(caseId, loadTags: () => Promise<void>)`, `invalidateFilterOptionsCache()`
- Encapsulates LRU cache hit/miss, parallel loading of options + tags

**`src/renderer/src/composables/useFilterLifecycle.ts`** (~60 lines)
- Constructor: `(caseIdRef, deps: { core, resetPresets, onFiltersUpdate, onResetSort, onCaseSwitch, loadFilterOptions, emitFilters, syncCoreToFilters })`
- Owns: the `watch(caseIdRef, ...)` watcher
- Methods: `resetForCaseSwitch()`, `setInitialSearch(search: string)`
- Calls deps on case switch: `core.reset()` → `syncCoreToFilters()` → field resets → `onCaseSwitch()` → `onFiltersUpdate({})` → `loadFilterOptions(newCaseId)`

**`src/renderer/src/composables/useFilterComputed.ts`** (~180 lines)
- Constructor: `(filters: Ref<FilterState>, selectedImpactPresets: Ref<string[]>, core: ReturnType<typeof useFilterCore>)`
- Owns: `hasActiveFilters`, `activeFilterCount`, `activeFiltersList` computeds
- Methods: `isFilterGroupActive(group)`, `clearFilter(filter: ActiveFilter)`, `removeTagFilter(tagId)`, `clearAllFilters(onResetSort)`
- Pure derivation — no side effects, no API calls

### Resulting Facade

`useFilterState.ts` reduced to ~150 lines:
1. Creates all sub-composables
2. Owns: `filters` ref, `exporting` ref, `syncCoreToFilters()`, `emitFilters()`, debounce wiring
3. Wires `filterEmitKey` computed watcher → `debouncedEmit()`
4. Returns `UseFilterStateReturn` (unchanged public API)

### Constraint

The `UseFilterStateReturn` interface is unchanged. Consumers (`FilterToolbar.vue`, `CohortFilterBar.vue`, etc.) see no difference. This is a pure internal refactor.

---

## Phase 3: Coverage Infrastructure

### 3.1 Per-Directory Thresholds

Replace flat 70% global threshold with realistic floors based on current actuals. Set each threshold ~2% below current measured value so CI passes today. Exact numbers calibrated from a fresh `npm run test:coverage` run.

```typescript
// vitest.config.ts
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
    // Global floor
    lines: 30,
    functions: 19,
    branches: 25,
    statements: 30,
    // Per-directory (calibrated from actuals)
    'src/shared/': { statements: 80, branches: 75, functions: 75, lines: 80 },
    'src/main/database/': { statements: 55, branches: 45, functions: 45, lines: 55 },
    'src/main/import/': { statements: 65, branches: 55, functions: 55, lines: 65 },
    'src/main/workers/': { statements: 8, branches: 6, functions: 6, lines: 8 },
    'src/main/ipc/': { statements: 4, branches: 3, functions: 3, lines: 4 },
  },
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: 'coverage'
}
```

Note: numbers above are estimates. Actual thresholds will be set from measured coverage after all test additions in Phase 4.

### 3.2 CI Build Workflow

In `.github/workflows/build.yml`:
- Change test step from `npm run test` to `npm run test:coverage` on the ubuntu runner
- Upload `coverage/coverage-summary.json` as artifact
- Add `davelosert/vitest-coverage-report-action@v2` step for PR comments (ubuntu only)

### 3.3 Release Workflow Parity

In `.github/workflows/release.yml`:
- Add `npm run lint:check` step before build
- Add `npm run typecheck` step before build
- Ensures tagged release builds are never weaker than PR builds

### 3.4 Coverage Report in .gitignore

Add `coverage/` to `.gitignore` if not already present.

---

## Phase 4: Tests

### New Test Files

| File | Tests | What it validates |
|------|-------|-------------------|
| `tests/renderer/composables/useGeneAutocomplete.test.ts` | ~6 | Search, clear, short query guard, API error |
| `tests/renderer/composables/useFilterOptionsCache.test.ts` | ~8 | LRU hit/miss, invalidation, parallel load, case switch |
| `tests/renderer/composables/useFilterLifecycle.test.ts` | ~6 | Case switch reset, initial search, watcher fires |
| `tests/renderer/composables/useFilterComputed.test.ts` | ~10 | Active filter count, group detection, clear, remove tag |
| `tests/renderer/composables/useFilterState-integration.test.ts` | ~4 | Facade wires correctly, return shape unchanged |
| `tests/shared/types/windowapi-contract.test.ts` | ~3 | Preload keys match WindowAPI interface — catches drift |

### Existing Test Updates

- Any test importing from `main/database/types` gets redirected to `shared/types/database-entities`
- `useFilterState.test.ts` may need import path updates

### Coverage Target

After this PR, coverage should improve from:
- ~33% statements → ~38%+ (from testing 4 new composables + contract tests)
- Per-directory thresholds pass in CI
- Foundation for ratcheting upward in future PRs

---

## Parallelism

```
Phase 1 (type cleanup — sequential, many shared files):
  1.1 Add missing WindowAPI types
  1.2 Replace all as-any casts
  1.3 Redirect renderer→main imports
  1.4 Consolidate filter-types.ts
  1.5 Add ESLint restriction

Phase 2 (decomposition — after 1.4):
  Extract useGeneAutocomplete
  Extract useFilterOptionsCache
  Extract useFilterLifecycle
  Extract useFilterComputed
  Rewrite useFilterState facade

Phase 3 (coverage — independent of 1 and 2):
  3.1 Set per-directory thresholds
  3.2 Wire CI build
  3.3 Wire release parity
  3.4 gitignore coverage/

Phase 4 (tests — after phases 1, 2, 3):
  New composable tests
  Contract tests
  Import path updates in existing tests
```

---

## Scope Boundaries

- No new features
- No UI/UX changes
- No changes to Electron main window creation or app lifecycle
- No new runtime dependencies
- `UseFilterStateReturn` public API unchanged — consumers see no difference
- Coverage thresholds are floors, not ceilings — they pass today and ratchet upward
