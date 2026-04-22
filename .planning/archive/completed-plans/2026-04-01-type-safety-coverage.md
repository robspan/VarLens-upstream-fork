# VarLens Type Safety, Filter Decomposition & Coverage -- Implementation Plan

**Date:** 2026-04-01
**Branch:** `refactor/type-safety-coverage` (off `main` after v0.51.0)
**Spec:** [2026-04-01-type-safety-coverage-design.md](../specs/2026-04-01-type-safety-coverage-design.md)
**Goal:** Eliminate type boundary violations, centralize preload access, decompose `useFilterState`, and make coverage enforcement honest and operational.

---

## Architecture

```
src/shared/types/          <-- canonical DTOs (domain types, no Vue deps)
  api.ts                   <-- WindowAPI, all IPC sub-APIs, re-exports
  database-entities.ts     <-- NEW: Tag, VariantAnnotation, AuditLogEntry, etc.
  vcf.ts                   <-- NEW: VcfPreviewResult
  filters.ts               <-- UPDATED: unified FilterState superset

src/renderer/src/
  composables/
    useApiService.ts       <-- single window.api access point
    filter-types.ts        <-- Vue-specific types (UseFilterStateReturn, etc.)
    useFilterState.ts      <-- facade (~150 lines)
    useGeneAutocomplete.ts <-- NEW: extracted from useFilterState
    useFilterOptionsCache.ts <-- NEW: extracted from useFilterState
    useFilterComputed.ts   <-- NEW: extracted from useFilterState
    useFilterLifecycle.ts  <-- NEW: extracted from useFilterState
  stores/
    databaseStore.ts       <-- UPDATED: use useApiService pattern
  components/
    DatabasePicker.vue     <-- UPDATED: use useApiService
    CohortTable.vue        <-- UPDATED: remove (api as any) casts
    GeneBurdenTable.vue    <-- UPDATED: remove (api as any) casts
    ...

eslint.config.js           <-- UPDATED: ban renderer->main imports, ban raw window.api
vitest.config.ts           <-- UPDATED: per-glob coverage thresholds
.github/workflows/
  build.yml                <-- UPDATED: coverage + PR comments
  release.yml              <-- UPDATED: add lint + typecheck
```

---

## Tech Stack

- **Runtime:** Electron 40, Vue 3, Vuetify 3, TypeScript 5, better-sqlite3-multiple-ciphers
- **Test:** Vitest + happy-dom, v8 coverage provider
- **Lint:** ESLint 10 flat config, Prettier
- **CI:** GitHub Actions (ubuntu/macos/windows)

---

## File Map

| Phase | New/Modified File | Purpose |
|-------|-------------------|---------|
| 1 | `src/shared/types/api.ts` | Add `showItemInFolder` to ShellAPI |
| 1 | `src/shared/types/database-entities.ts` | NEW: canonical DTOs |
| 1 | `src/shared/types/vcf.ts` | NEW: VcfPreviewResult |
| 1 | `src/shared/types/filters.ts` | Add `tagIds`, `annotationScope` |
| 1 | `src/shared/types/index.ts` | Re-export new modules |
| 1 | `src/renderer/src/composables/filter-types.ts` | Remove `FilterState`, `ActiveFilter`, import from shared |
| 1 | 16 renderer files | Redirect `main/database/types` imports to shared |
| 1 | 2 renderer files | Redirect `main/import/vcf/types` imports |
| 1 | 9 renderer files | Remove `(api as any)` casts |
| 1 | 4 renderer files | Replace direct `window.api.` calls |
| 1 | `src/renderer/src/mocks/mockApi.ts` | Add `showItemInFolder` to shell mock |
| 1 | `eslint.config.js` | Add restriction rules |
| 2 | `src/renderer/src/composables/useGeneAutocomplete.ts` | NEW |
| 2 | `src/renderer/src/composables/useFilterOptionsCache.ts` | NEW |
| 2 | `src/renderer/src/composables/useFilterComputed.ts` | NEW |
| 2 | `src/renderer/src/composables/useFilterLifecycle.ts` | NEW |
| 2 | `src/renderer/src/composables/useFilterState.ts` | Rewrite as facade |
| 3 | `tests/renderer/composables/useGeneAutocomplete.test.ts` | NEW |
| 3 | `tests/renderer/composables/useFilterOptionsCache.test.ts` | NEW |
| 3 | `tests/renderer/composables/useFilterComputed.test.ts` | NEW |
| 3 | `tests/renderer/composables/useFilterLifecycle.test.ts` | NEW |
| 3 | `tests/renderer/composables/useFilterState-integration.test.ts` | NEW |
| 3 | `tests/shared/types/preload-contract.test.ts` | NEW |
| 4 | `vitest.config.ts` | Per-glob thresholds with autoUpdate |
| 4 | `.github/workflows/build.yml` | Coverage + PR comments |
| 4 | `.github/workflows/release.yml` | Add lint + typecheck |

---

## Phase 1: Type Boundary Cleanup

### Task 1: Add `showItemInFolder` to ShellAPI + update mockApi

**Why:** Preload exposes `shell.showItemInFolder` (line 119 of `src/preload/index.ts`) but the `ShellAPI` interface is missing it. This causes `(api as any)` casts when calling it.

**Files:**
- `src/shared/types/api.ts`
- `src/renderer/src/mocks/mockApi.ts`

**Steps:**

- [ ] 1.1 Edit `src/shared/types/api.ts` -- add `showItemInFolder` to `ShellAPI`:

```typescript
// src/shared/types/api.ts -- find the ShellAPI interface (line ~218)
// BEFORE:
export interface ShellAPI {
  openExternal: (url: string) => Promise<ShellOpenExternalResult>
  updateDomains: (domains: string[]) => Promise<void>
}

// AFTER:
export interface ShellAPI {
  openExternal: (url: string) => Promise<ShellOpenExternalResult>
  showItemInFolder: (filePath: string) => Promise<void>
  updateDomains: (domains: string[]) => Promise<void>
}
```

- [ ] 1.2 Edit `src/renderer/src/mocks/mockApi.ts` -- add `showItemInFolder` to shell mock:

```typescript
// src/renderer/src/mocks/mockApi.ts -- find shell: { ... } (line ~165)
// BEFORE:
  shell: {
    openExternal: async (url) => {
      window.open(url, '_blank')
      return { success: true }
    },
    updateDomains: async () => {}
  },

// AFTER:
  shell: {
    openExternal: async (url) => {
      window.open(url, '_blank')
      return { success: true }
    },
    showItemInFolder: async () => {},
    updateDomains: async () => {}
  },
```

- [ ] 1.3 Verify: `npm run typecheck`
- [ ] 1.4 Commit: `fix: add showItemInFolder to ShellAPI interface and mockApi`

---

### Task 2: Define shared DTOs (database-entities.ts, vcf.ts)

**Why:** Renderer files import `Tag`, `AcmgClassification`, `VariantAnnotation`, `AuditLogEntry`, etc. from `src/main/database/types`. This violates the process boundary. We define canonical DTOs in `src/shared/types/` and make main the implementor, not the source.

**Files:**
- `src/shared/types/database-entities.ts` (NEW)
- `src/shared/types/vcf.ts` (NEW)
- `src/shared/types/index.ts`

**Steps:**

- [ ] 2.1 Create `src/shared/types/database-entities.ts`:

```typescript
/**
 * Canonical DTOs for database entities used across process boundaries.
 *
 * These are the "shared truth" -- main process implements/extends them,
 * renderer consumes them. Never import from main/database/types in renderer.
 */

export interface Tag {
  id: number
  name: string
  color: string
  created_at?: number
}

export interface VariantAnnotation {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
  global_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export interface CaseVariantAnnotation {
  id: number
  case_id: number
  variant_id: number
  per_case_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export type AuditActionType = 'import' | 'delete' | 'export' | 'update' | 'create'

export interface AuditLogEntry {
  id: number
  action_type: AuditActionType
  entity_type: string
  entity_key: string
  details: string | null
  user_name: string | null
  timestamp: number
}
```

- [ ] 2.2 Create `src/shared/types/vcf.ts`:

```typescript
/**
 * VCF preview result DTO for renderer consumption.
 *
 * Mirrors the actual shape returned by import:vcfPreview IPC channel.
 * Main-side VcfPreviewResult in src/main/import/vcf/types.ts must match this.
 */

/** Annotation type detected from VCF header */
export type VcfAnnotationType = 'csq' | 'ann' | 'none'

export interface VcfPreviewInfoField {
  id: string
  type: string
  number: string
  description: string
  mapsToColumn: string | null
}

export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: VcfAnnotationType
  detectedGenomeBuild: string | null
  infoFields: VcfPreviewInfoField[]
}
```

- [ ] 2.3 Update `src/shared/types/index.ts` to re-export new modules:

```typescript
export * from './api'
export * from './column-filters'
export * from './database-entities'
export * from './errors'
export * from './filters'
export * from './log'
export * from './protein'
export * from './transcript'
export * from './vcf'
```

- [ ] 2.4 Verify: `npm run typecheck`
- [ ] 2.5 Commit: `refactor: add shared DTOs for database entities and VCF preview`

---

### Task 3: Consolidate FilterState into shared superset

**Why:** `src/shared/types/filters.ts` has `FilterState` with `minCarriers` (cohort-only) but lacks `tagIds` and `annotationScope` (case-only). `src/renderer/src/composables/filter-types.ts` has the inverse. We unify into one superset in shared.

**Files:**
- `src/shared/types/filters.ts`
- `src/renderer/src/composables/filter-types.ts`
- `src/renderer/src/composables/useFilterState.ts`
- `src/renderer/src/composables/useFilterExport.ts`
- `src/renderer/src/composables/useFilterPresets.ts`

**Steps:**

- [ ] 3.1 Update `src/shared/types/filters.ts` -- add `tagIds` and `annotationScope` to `FilterState`:

```typescript
// src/shared/types/filters.ts -- add after acmgClassifications in FilterState

  /** Tag IDs for tag-based filtering - case view only */
  tagIds: number[]
  /** Annotation scope ('case' or 'all') - case view only */
  annotationScope: 'case' | 'all'
```

The full updated `FilterState` interface in `src/shared/types/filters.ts` becomes:

```typescript
export interface FilterState {
  /** Gene symbol filter (FTS5 search) */
  geneSymbol: string
  /** Full-text search term */
  searchQuery: string
  /** Selected consequence types (HIGH, MODERATE, etc.) */
  consequences: string[]
  /** Selected functional annotations */
  funcs: string[]
  /** Selected ClinVar classifications */
  clinvars: string[]
  /** Maximum gnomAD allele frequency (0-1) */
  maxGnomadAf: number | null
  /** Minimum CADD score (0-60) */
  minCadd: number | null
  /** Minimum carrier count - cohort view only */
  minCarriers: number | null
  /** Show only starred variants */
  starredOnly: boolean
  /** Show only variants with comments */
  hasCommentOnly: boolean
  /** Filter by ACMG classifications */
  acmgClassifications: string[]
  /** Tag IDs for tag-based filtering - case view only */
  tagIds: number[]
  /** Annotation scope ('case' or 'all') - case view only */
  annotationScope: 'case' | 'all'
  /** Active gene panel IDs for region-based filtering */
  activePanelIds: number[]
  /** Padding in base pairs around panel gene regions */
  panelPaddingBp: number
  /** Maximum internal database allele frequency (0-1) */
  maxInternalAf: number | null
  /** Selected inheritance mode filters (multi-select) */
  inheritanceModes: string[]
  /** Active analysis group ID for trio filtering */
  analysisGroupId: number | null
  /** Consider phasing information for compound het */
  considerPhasing: boolean
}
```

- [ ] 3.2 Update `src/renderer/src/composables/filter-types.ts` -- remove local `FilterState` and `ActiveFilter`, import from shared:

```typescript
// src/renderer/src/composables/filter-types.ts
// BEFORE (lines 1-36):
import type { Ref, ComputedRef } from 'vue'
import type { VariantFilter, Tag, FilterOptions } from '../../../shared/types/api'

/**
 * Core filter state structure for variant filtering
 */
export interface FilterState {
  searchQuery: string
  geneSymbol: string
  consequences: string[]
  // ... (26 lines)
}

/**
 * Active filter chip data for summary bar display
 */
export interface ActiveFilter {
  id: string
  label: string
  value: string
}

// AFTER:
import type { Ref, ComputedRef } from 'vue'
import type { VariantFilter, Tag, FilterOptions } from '../../../shared/types/api'
import type { FilterState, ActiveFilter } from '../../../shared/types/filters'

// Re-export for existing consumers
export type { FilterState, ActiveFilter } from '../../../shared/types/filters'
```

Keep `UseFilterStateOptions`, `ExportResult`, `UseFilterStateReturn`, and `buildFilterFromState` in this file (they depend on Vue types or are renderer-specific).

- [ ] 3.3 Update `buildFilterFromState` in `filter-types.ts` -- it already accesses `filters.tagIds` and `filters.annotationScope`, so the signature stays the same. The only change needed is that `FilterState` now also has `minCarriers`. The function already doesn't use `minCarriers`, so no logic change.

- [ ] 3.4 Verify: `npm run typecheck`
- [ ] 3.5 Verify: `npm run test -- --run`
- [ ] 3.6 Commit: `refactor: consolidate FilterState into shared superset with tagIds and annotationScope`

---

### Task 4: Redirect renderer->main type imports to shared (~22 files)

**Why:** 16 renderer files import from `src/main/database/types` and 2 from `src/main/import/vcf/types`. These cross-process imports must be redirected to shared types.

**Files to update (18 files):**

**AcmgClassification imports (11 files) -- redirect to `src/shared/config/domain.config.ts`:**

These files import `AcmgClassification` from `'../../../main/database/types'` (or `'../../../../main/database/types'`):

1. `src/renderer/src/components/AcmgEvidenceDialog.vue`
2. `src/renderer/src/components/VariantDetailsPanel.vue`
3. `src/renderer/src/composables/useAnnotationDialogs.ts`
4. `src/renderer/src/components/acmg/AcmgSummaryBar.vue`
5. `src/renderer/src/components/AcmgClassificationPanel.vue`
6. `src/renderer/src/components/AcmgMenu.vue`
7. `src/renderer/src/components/table-cells/AnnotationsCell.vue`
8. `src/renderer/src/components/variant-table/useVariantRowViewModel.ts`
9. `src/renderer/src/components/cohort/CohortDataTable.vue`
10. `src/renderer/src/components/cohort/CohortTableRow.vue`

For each, change:
```typescript
// BEFORE:
import type { AcmgClassification } from '../../../main/database/types'
// or
import type { AcmgClassification } from '../../../../main/database/types'

// AFTER:
import type { AcmgClassification } from '../../../shared/config/domain.config'
// or (for deeper nesting):
import type { AcmgClassification } from '../../../../shared/config/domain.config'
```

**Mixed imports -- some types already in shared, some need database-entities:**

11. `src/renderer/src/composables/useAnnotations.ts` -- imports `VariantAnnotation`, `CaseVariantAnnotation`:
```typescript
// BEFORE:
import type { VariantAnnotation, CaseVariantAnnotation } from '../../../main/database/types'
// AFTER:
import type { VariantAnnotation, CaseVariantAnnotation } from '../../../shared/types/database-entities'
```

12. `src/renderer/src/composables/useTags.ts` -- imports `Tag`:
```typescript
// BEFORE:
import type { Tag } from '../../../main/database/types'
// AFTER:
import type { Tag } from '../../../shared/types/database-entities'
```

13. `src/renderer/src/components/TagManagementDialog.vue` -- imports `Tag`:
```typescript
// BEFORE:
import type { Tag } from '../../../main/database/types'
// AFTER:
import type { Tag } from '../../../shared/types/database-entities'
```

14. `src/renderer/src/components/ActivityLogPanel.vue` -- imports `AuditLogEntry`, `AuditActionType`:
```typescript
// BEFORE:
import type { AuditLogEntry, AuditActionType } from '../../../main/database/types'
// AFTER:
import type { AuditLogEntry, AuditActionType } from '../../../shared/types/database-entities'
```

15. `src/renderer/src/mocks/fixtures/cases.ts` -- imports `Case`:
```typescript
// BEFORE:
import type { Case } from '../../../../main/database/types'
// AFTER:
import type { Case } from '../../../../shared/types/api'
```

16. `src/renderer/src/mocks/fixtures/variants.ts` -- imports `Variant`:
```typescript
// BEFORE:
import type { Variant } from '../../../../main/database/types'
// AFTER:
import type { Variant } from '../../../../shared/types/api'
```

17. `src/renderer/src/components/variant-table/useVariantRowViewModel.ts` -- also imports `Variant` alongside `AcmgClassification`:
```typescript
// BEFORE:
import type { AcmgClassification, Variant } from '../../../../main/database/types'
// AFTER:
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import type { Variant } from '../../../../shared/types/api'
```

**VcfPreviewResult imports (2 files):**

18. `src/renderer/src/components/import/VcfPreviewStep.vue`:
```typescript
// BEFORE:
import type { VcfPreviewResult } from '../../../../main/import/vcf/types'
// AFTER:
import type { VcfPreviewResult } from '../../../../shared/types/vcf'
```

19. `src/renderer/src/components/import/ImportWizard.vue`:
```typescript
// BEFORE:
import type { VcfPreviewResult } from '../../../../main/import/vcf/types'
// AFTER:
import type { VcfPreviewResult } from '../../../../shared/types/vcf'
```

**Steps:**

- [ ] 4.1 Update all 19 files as listed above
- [ ] 4.2 Verify no renderer files import from `main/`:

```bash
grep -r "from.*main/database/types\|from.*main/import" src/renderer/ --include="*.ts" --include="*.vue"
```

This should return 0 results.

- [ ] 4.3 Verify: `npm run typecheck`
- [ ] 4.4 Verify: `npm run test -- --run`
- [ ] 4.5 Commit: `refactor: redirect all renderer->main type imports to shared`

---

### Task 5: Centralize preload access -- remove all `(api as any)` casts (9 files, 16 casts)

**Why:** These casts exist because `WindowAPI` was missing methods or the type system couldn't prove `api` was defined. After Task 1 (ShellAPI fix), all methods are typed. We remove every cast and use proper null guards.

**Files and exact changes:**

#### 5.1 `src/renderer/src/composables/useFilterExport.ts` (1 cast)

```typescript
// BEFORE (line 29):
      const result = await (api as any).export.variants(

// AFTER:
      if (!api) {
        return null
      }
      const result = await api.export.variants(
```

Note: there is already an `if (!api)` guard at line 18. The cast at line 29 is inside the `try` block after the guard. Since the guard already returns, we can safely use `api.export.variants` directly. But the function uses `api!` pattern. Replace with a local alias after the guard:

```typescript
// Full function rewrite for clarity:
  const exportToExcel = async (caseId: number, caseName: string): Promise<ExportResult | null> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'export')
      return null
    }

    exporting.value = true
    try {
      const exportFilters = buildFilterFromState(filters.value, selectedImpactPresets.value)

      const result = await api.export.variants(
        caseId,
        exportFilters,
        caseName !== '' ? caseName : `case_${caseId}`
      )
      // ... rest unchanged
```

Also remove the eslint-disable comment above the cast.

#### 5.2 `src/renderer/src/composables/useCarriers.ts` (1 cast)

```typescript
// BEFORE (line ~120):
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const carriers = await (api as any).cohort.getCarriers(

// AFTER:
      const carriers = await api.cohort.getCarriers(
```

Remove the eslint-disable comment. The function already has `if (!api)` guard above (line ~110 area). Verify the guard exists before the cast and just remove the cast.

#### 5.3 `src/renderer/src/composables/useCohortData.ts` (4 casts)

Cast 1 (line ~139) -- `registerSummaryListener`:
```typescript
// BEFORE:
    const cohortApi = (api as any).cohort

// AFTER:
    const cohortApi = api.cohort
```

Cast 2 (line ~160) -- `getSummaryStatus`:
```typescript
// BEFORE:
    const cohortApi = (api as any).cohort

// AFTER:
    const cohortApi = api.cohort
```

Cast 3 (line ~299) -- `fetchVariants`:
```typescript
// BEFORE:
      const result = await (api as any).cohort.getVariants(ipcParams)

// AFTER:
      const result = await api.cohort.getVariants(ipcParams)
```

Cast 4 (line ~332) -- `fetchSummary`:
```typescript
// BEFORE:
      const result = await (api as any).cohort.getSummary()

// AFTER:
      const result = await api.cohort.getSummary()
```

Remove all 4 eslint-disable comments.

#### 5.4 `src/renderer/src/components/variant-table/useVariantData.ts` (1 cast)

```typescript
// BEFORE (line ~84):
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).variants.query(

// AFTER:
      const result = await api.variants.query(
```

Remove the eslint-disable comment.

#### 5.5 `src/renderer/src/components/CohortTable.vue` (3 casts)

Cast 1 (line ~252) -- `getVariants`:
```typescript
// BEFORE:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).cohort.getVariants(plainParams)

// AFTER:
    const result = await api.cohort.getVariants(plainParams)
```

Cast 2 (line ~300) -- `export.cohort`:
```typescript
// BEFORE:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).export.cohort(plainParams)

// AFTER:
    const result = await api.export.cohort(plainParams)
```

Cast 3 (line ~320) -- `shell.showItemInFolder`:
```typescript
// BEFORE:
          ;(api as any).shell.showItemInFolder(result.filePath)

// AFTER:
          api.shell.showItemInFolder(result.filePath)
```

Remove all 3 eslint-disable comments.

#### 5.6 `src/renderer/src/components/GeneBurdenTable.vue` (1 cast)

```typescript
// BEFORE (line ~92):
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).cohort.getGeneBurden()

// AFTER:
    const result = await api.cohort.getGeneBurden()
```

Remove the eslint-disable comment.

#### 5.7 `src/renderer/src/components/case-data-info/RegionFileImportDialog.vue` (2 casts)

Cast 1 (line ~116) -- `import.selectFile`:
```typescript
// BEFORE:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).import.selectFile()

// AFTER:
    const result = await api.import.selectFile()
```

Cast 2 (line ~139) -- `regionFiles`:
```typescript
// BEFORE:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const regionFilesApi = (api as any).regionFiles

// AFTER:
    const regionFilesApi = api.regionFiles
```

Remove both eslint-disable comments.

**Steps:**

- [ ] 5.1 Update `useFilterExport.ts` -- remove cast, remove eslint-disable
- [ ] 5.2 Update `useCarriers.ts` -- remove cast, remove eslint-disable
- [ ] 5.3 Update `useCohortData.ts` -- remove 4 casts, remove 4 eslint-disables
- [ ] 5.4 Update `useVariantData.ts` -- remove cast, remove eslint-disable
- [ ] 5.5 Update `CohortTable.vue` -- remove 3 casts, remove 3 eslint-disables
- [ ] 5.6 Update `GeneBurdenTable.vue` -- remove cast, remove eslint-disable
- [ ] 5.7 Update `RegionFileImportDialog.vue` -- remove 2 casts, remove 2 eslint-disables
- [ ] 5.8 Verify no `(api as any)` casts remain:

```bash
grep -r "(api as any)" src/renderer/ --include="*.ts" --include="*.vue"
```

Should return 0 results.

- [ ] 5.9 Verify: `npm run typecheck`
- [ ] 5.10 Verify: `npm run lint:check`
- [ ] 5.11 Commit: `refactor: remove all (api as any) casts in renderer`

---

### Task 6: Centralize preload access -- replace direct `window.api.` calls (4 files + 1 exception)

**Why:** Direct `window.api.` usage bypasses the `useApiService()` composable, making testing harder and losing null guards.

**Files and exact changes:**

#### 6.1 `src/renderer/src/stores/databaseStore.ts` (7 calls)

This is a Pinia setup store. Pinia stores cannot use Vue composables directly at the top level. The pattern here is to accept `api` as a parameter to each function or to resolve it lazily.

The cleanest approach: since `databaseStore` is always called from Vue components where `window.api` is guaranteed available, we add a lazy accessor at the top of the store:

```typescript
// src/renderer/src/stores/databaseStore.ts
// BEFORE (line 1-9):
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DatabaseOpenResult, RecentDatabase } from '../../../shared/types/api'

export const useDatabaseStore = defineStore('database', () => {

// AFTER:
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DatabaseOpenResult, RecentDatabase, WindowAPI } from '../../../shared/types/api'

/** Lazy accessor for window.api -- avoids import-time evaluation */
function getApi(): WindowAPI {
  if (typeof window === 'undefined' || typeof window.api === 'undefined') {
    throw new Error('Database store requires Electron API (window.api)')
  }
  return window.api
}

export const useDatabaseStore = defineStore('database', () => {
```

Then replace all 7 `window.api.database.*` calls with `getApi().database.*`:

```typescript
  async function fetchInfo(): Promise<void> {
    const info = await getApi().database.info()
    // ...
  }

  async function fetchRecent(): Promise<void> {
    recentDatabases.value = await getApi().database.recentList()
  }

  async function openDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = await getApi().database.open(path, password)
      // ...
    }
  }

  async function createDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = await getApi().database.create(path, password)
      // ...
    }
  }

  async function selectAndOpenFile(): Promise<DatabaseOpenResult | null> {
    const path = await getApi().database.selectFile()
    // ...
  }

  async function selectSaveLocation(defaultName: string): Promise<string | null> {
    return await getApi().database.selectSaveLocation(defaultName)
  }

  async function changePassword(
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    return await getApi().database.rekey(newPassword)
  }
```

Note: We use `getApi()` (which throws) rather than a null guard because this store fundamentally requires the Electron API. It should never be called in browser-only mode. The throw provides a clear error if it ever is.

#### 6.2 `src/renderer/src/components/DatabasePicker.vue` (3 calls)

This is a Vue component, so `useApiService()` works directly:

```typescript
// Add near other composable imports in <script setup>:
import { useApiService } from '../composables/useApiService'
const { api } = useApiService()
```

Then replace:

```typescript
// BEFORE (line ~237):
    await window.api.database.removeRecent(path)
// AFTER:
    if (!api) return
    await api.database.removeRecent(path)

// BEFORE (line ~246):
    await window.api.database.showInFolder(path)
// AFTER:
    if (!api) return
    await api.database.showInFolder(path)

// BEFORE (line ~260):
    await window.api.database.deleteFile(pendingDeleteDb.value.path)
// AFTER:
    if (!api) return
    await api.database.deleteFile(pendingDeleteDb.value.path)
```

#### 6.3 `src/renderer/src/stores/externalLinksStore.ts` (1 call)

```typescript
// BEFORE (line ~289):
  function syncDomains(): void {
    if (typeof window.api === 'undefined') return
    const domains = configuredDomains.value
    window.api.shell.updateDomains(domains)
  }

// AFTER:
  function syncDomains(): void {
    if (typeof window === 'undefined' || typeof window.api === 'undefined') return
    const domains = configuredDomains.value
    window.api.shell.updateDomains(domains)
  }
```

Note: `externalLinksStore` is a Pinia store and runs at import time during `syncDomains()` call. We keep the direct `window.api` access here but add an ESLint disable comment since the store initializes before Vue is mounted. This is an approved exception alongside `LogService.ts`.

Actually, looking at this more carefully: this store uses `defineStore` and has `syncDomains()` called at store creation time. This is another bootstrap case. Add ESLint exception:

```typescript
  function syncDomains(): void {
    // eslint-disable-next-line no-restricted-syntax -- store initializes before Vue mount
    if (typeof window === 'undefined' || typeof window.api === 'undefined') return
    const domains = configuredDomains.value
    // eslint-disable-next-line no-restricted-syntax -- store initializes before Vue mount
    window.api.shell.updateDomains(domains)
  }
```

#### 6.4 `src/renderer/src/composables/useAnalysisGroups.ts` (1 call)

```typescript
// BEFORE (full file):
import { ref, computed } from 'vue'
import { logService } from '../services/LogService'

interface AnalysisGroupOption {
  id: number
  name: string
  group_type: string
}

const groups = ref<AnalysisGroupOption[]>([])
const loading = ref(false)

export function useAnalysisGroups() {
  async function loadGroups(): Promise<void> {
    loading.value = true
    try {
      groups.value = (await window.api.analysisGroups.list()) as AnalysisGroupOption[]
    } catch (error) {
      logService.error(`Failed to load analysis groups: ${error}`, 'useAnalysisGroups')
      groups.value = []
    } finally {
      loading.value = false
    }
  }

  const groupOptions = computed(() => groups.value.map((g) => ({ title: g.name, value: g.id })))

  return { groups, loading, loadGroups, groupOptions }
}

// AFTER:
import { ref, computed } from 'vue'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

interface AnalysisGroupOption {
  id: number
  name: string
  group_type: string
}

const groups = ref<AnalysisGroupOption[]>([])
const loading = ref(false)

export function useAnalysisGroups() {
  const { api } = useApiService()

  async function loadGroups(): Promise<void> {
    if (!api) return
    loading.value = true
    try {
      groups.value = (await api.analysisGroups.list()) as AnalysisGroupOption[]
    } catch (error) {
      logService.error(`Failed to load analysis groups: ${error}`, 'useAnalysisGroups')
      groups.value = []
    } finally {
      loading.value = false
    }
  }

  const groupOptions = computed(() => groups.value.map((g) => ({ title: g.name, value: g.id })))

  return { groups, loading, loadGroups, groupOptions }
}
```

#### 6.5 `src/renderer/src/services/LogService.ts` (1 call -- approved exception)

```typescript
// BEFORE (line ~41):
    this.cleanup = window.api.logs.onMessage((logMessage: LogMessage) => {

// AFTER (add eslint-disable):
    // eslint-disable-next-line no-restricted-syntax -- LogService bootstraps before Vue mount; useApiService() unavailable
    this.cleanup = window.api.logs.onMessage((logMessage: LogMessage) => {
```

#### 6.6 `src/renderer/src/utils/filters/filterSerialization.ts` -- NO CHANGE

This file does NOT use `window.api`. The grep match was a JSDoc comment example, not actual code. No changes needed.

**Steps:**

- [ ] 6.1 Update `databaseStore.ts` -- add `getApi()` helper, replace 7 `window.api` calls
- [ ] 6.2 Update `DatabasePicker.vue` -- add `useApiService()`, replace 3 `window.api` calls
- [ ] 6.3 Update `externalLinksStore.ts` -- add eslint-disable comments for bootstrap exception
- [ ] 6.4 Update `useAnalysisGroups.ts` -- add `useApiService()`, replace 1 `window.api` call
- [ ] 6.5 Update `LogService.ts` -- add eslint-disable comment for bootstrap exception
- [ ] 6.6 Verify no unauthorized `window.api.` calls remain:

```bash
grep -rn "window\.api\." src/renderer/ --include="*.ts" --include="*.vue" | grep -v "typeof window.api" | grep -v "eslint-disable" | grep -v "filterSerialization" | grep -v "// "
```

Should return only the approved exceptions (LogService, externalLinksStore) and the `useApiService.ts` definition itself.

- [ ] 6.7 Verify: `npm run typecheck`
- [ ] 6.8 Verify: `npm run lint:check`
- [ ] 6.9 Commit: `refactor: centralize all window.api access behind useApiService`

---

### Task 7: Add ESLint restrictions

**Why:** Prevent future renderer->main imports and raw `window.api` usage from creeping back in.

**Files:**
- `eslint.config.js`

**Steps:**

- [ ] 7.1 Add two new config blocks to `eslint.config.js`:

```javascript
// eslint.config.js -- add before the final closing bracket
// After the existing config blocks, before the closing ']':

  // Ban renderer -> main process imports
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/main/**'],
          message: 'Renderer must not import from main process. Use src/shared/ re-exports.'
        }]
      }]
    }
  },
  // Ban raw window.api access (enforce useApiService)
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    ignores: [
      'src/renderer/src/composables/useApiService.ts',
      'src/renderer/src/services/LogService.ts',
      'src/renderer/src/stores/externalLinksStore.ts',
      'src/renderer/src/stores/databaseStore.ts'
    ],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "MemberExpression[object.property.name='api'][object.object.name='window']",
        message: 'Use useApiService() for API access. Direct window.api usage is not allowed.'
      }]
    }
  }
```

Note: `databaseStore.ts` and `externalLinksStore.ts` are excluded because they use `getApi()` / bootstrap patterns that still reference `window.api` internally.

- [ ] 7.2 Verify: `npm run lint:check`

If any existing files violate the new rules, fix them (they should all be clean after Tasks 4-6).

- [ ] 7.3 Commit: `chore: add ESLint rules banning renderer->main imports and raw window.api`

---

## Phase 2: useFilterState Decomposition

### Task 8: Extract useGeneAutocomplete

**Why:** Gene autocomplete is self-contained: it owns `geneSymbolSuggestions`, `loadingSuggestions`, `searchGeneSymbols`, and `handleGeneClear`. No coupling to filter state beyond the gene symbol field.

**Files:**
- `src/renderer/src/composables/useGeneAutocomplete.ts` (NEW)
- `src/renderer/src/composables/useFilterState.ts` (update)

**Steps:**

- [ ] 8.1 Create `src/renderer/src/composables/useGeneAutocomplete.ts`:

```typescript
/**
 * Composable for gene symbol autocomplete functionality.
 * Extracted from useFilterState to separate gene search concerns.
 */

import { ref, type Ref, type ComputedRef } from 'vue'
import type { WindowAPI } from '../../../shared/types/api'
import { logService } from '../services/LogService'

export interface UseGeneAutocompleteReturn {
  geneSymbolSuggestions: Ref<string[]>
  loadingSuggestions: Ref<boolean>
  searchGeneSymbols: (query: string) => Promise<void>
  handleGeneClear: () => void
}

/**
 * Gene symbol autocomplete with debounced IPC.
 *
 * @param api - WindowAPI instance (may be undefined in browser dev mode)
 * @param caseIdRef - Reactive ref to the current case ID
 * @param geneSymbolRef - Reactive ref to the gene symbol filter value (for clearing)
 */
export function useGeneAutocomplete(
  api: WindowAPI | undefined,
  caseIdRef: Ref<number> | ComputedRef<number>,
  geneSymbolRef: Ref<string>
): UseGeneAutocompleteReturn {
  const geneSymbolSuggestions = ref<string[]>([])
  const loadingSuggestions = ref(false)

  const handleGeneClear = (): void => {
    geneSymbolRef.value = ''
    geneSymbolSuggestions.value = []
  }

  const searchGeneSymbols = async (query: string): Promise<void> => {
    if (!query || query.length < 2) {
      geneSymbolSuggestions.value = []
      return
    }

    if (!api) return

    loadingSuggestions.value = true
    try {
      const results: string[] = await api.variants.geneSymbols(caseIdRef.value, query, 50)
      geneSymbolSuggestions.value = results
    } catch (e) {
      logService.warn(
        'Gene symbol autocomplete failed: ' + (e instanceof Error ? e.message : String(e)),
        'filters'
      )
      geneSymbolSuggestions.value = []
    } finally {
      loadingSuggestions.value = false
    }
  }

  return {
    geneSymbolSuggestions,
    loadingSuggestions,
    searchGeneSymbols,
    handleGeneClear
  }
}
```

- [ ] 8.2 Update `useFilterState.ts` -- replace inline gene autocomplete with the extracted composable:

```typescript
// Add import:
import { useGeneAutocomplete } from './useGeneAutocomplete'

// Replace the gene autocomplete section (lines ~480-505) with:
  const { geneSymbolSuggestions, loadingSuggestions, searchGeneSymbols, handleGeneClear } =
    useGeneAutocomplete(api, caseIdRef, ref(filters.value.geneSymbol))
```

Wait -- `geneSymbolRef` needs to be reactive and point into `filters.value.geneSymbol`. We need to use a computed setter or pass `filters` directly. Better approach: pass the filters ref and let the composable access `filters.value.geneSymbol`:

Actually, the simplest approach that preserves behavior: pass `filters` and have `handleGeneClear` set `filters.value.geneSymbol = ''`. Let me revise:

```typescript
// Revised useGeneAutocomplete signature:
export function useGeneAutocomplete(
  api: WindowAPI | undefined,
  caseIdRef: Ref<number> | ComputedRef<number>,
  filters: Ref<{ geneSymbol: string }>
): UseGeneAutocompleteReturn {
  // ...
  const handleGeneClear = (): void => {
    filters.value.geneSymbol = ''
    geneSymbolSuggestions.value = []
  }
  // ...
}
```

And in `useFilterState.ts`:
```typescript
  const { geneSymbolSuggestions, loadingSuggestions, searchGeneSymbols, handleGeneClear } =
    useGeneAutocomplete(api, caseIdRef, filters)
```

- [ ] 8.3 Verify: `npm run typecheck`
- [ ] 8.4 Verify: `npm run test -- --run`
- [ ] 8.5 Commit: `refactor: extract useGeneAutocomplete from useFilterState`

---

### Task 9: Extract useFilterOptionsCache

**Why:** Filter options caching with LRU is self-contained: it owns the cache, `filterOptions` ref, `loadFilterOptions`, `loadFilterOptionsAndTags`, and `invalidateFilterOptionsCache`.

**Files:**
- `src/renderer/src/composables/useFilterOptionsCache.ts` (NEW)
- `src/renderer/src/composables/useFilterState.ts` (update)

**Steps:**

- [ ] 9.1 Create `src/renderer/src/composables/useFilterOptionsCache.ts`:

```typescript
/**
 * Composable for filter options loading and LRU caching.
 * Extracted from useFilterState to separate data-fetching concerns.
 */

import { ref, type Ref } from 'vue'
import type { WindowAPI, FilterOptions } from '../../../shared/types/api'
import { LruMap } from '../../../shared/utils/lru-map'
import { logService } from '../services/LogService'

const FILTER_OPTIONS_CACHE_MAX = 20

export interface UseFilterOptionsCacheReturn {
  filterOptions: Ref<FilterOptions>
  loadFilterOptions: (caseId: number) => Promise<void>
  loadFilterOptionsAndTags: (caseId: number, loadTags: () => Promise<void>) => Promise<void>
  invalidateFilterOptionsCache: () => void
}

/**
 * Filter options loading with LRU cache.
 *
 * @param api - WindowAPI instance (may be undefined in browser dev mode)
 */
export function useFilterOptionsCache(
  api: WindowAPI | undefined
): UseFilterOptionsCacheReturn {
  const filterOptions = ref<FilterOptions>({
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    minCadd: null as number | null,
    maxCadd: null as number | null,
    minGnomadAf: null as number | null,
    maxGnomadAf: null as number | null,
    columnMeta: []
  })

  const filterOptionsCache = new LruMap<number, FilterOptions>(FILTER_OPTIONS_CACHE_MAX)

  /**
   * Load filter options for a given case from the database (with LRU cache).
   */
  const loadFilterOptions = async (caseId: number): Promise<void> => {
    if (!api) return

    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      filterOptions.value = cached
      return
    }

    try {
      const options = await api.variants.getFilterOptions(caseId)
      filterOptions.value = options
      filterOptionsCache.set(caseId, options)
    } catch (error) {
      logService.error(
        'Failed to load filter options: ' +
          (error instanceof Error ? error.message : String(error)),
        'filters'
      )
    }
  }

  /**
   * Load filter options and tags in parallel.
   * Called from the component's onMounted.
   */
  const loadFilterOptionsAndTags = async (
    caseId: number,
    loadTags: () => Promise<void>
  ): Promise<void> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'filters')
      return
    }

    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      filterOptions.value = cached
      await loadTags()
      return
    }

    try {
      const [options] = await Promise.all([api.variants.getFilterOptions(caseId), loadTags()])
      filterOptions.value = options
      filterOptionsCache.set(caseId, options)
    } catch (error) {
      logService.error(
        'Failed to load filter options: ' +
          (error instanceof Error ? error.message : String(error)),
        'filters'
      )
    }
  }

  const invalidateFilterOptionsCache = (): void => {
    filterOptionsCache.clear()
  }

  return {
    filterOptions,
    loadFilterOptions,
    loadFilterOptionsAndTags,
    invalidateFilterOptionsCache
  }
}
```

- [ ] 9.2 Update `useFilterState.ts` -- replace inline cache with the extracted composable:

```typescript
// Add import:
import { useFilterOptionsCache } from './useFilterOptionsCache'

// Replace filter options section with:
  const { filterOptions, loadFilterOptions: loadFilterOptionsInternal, loadFilterOptionsAndTags, invalidateFilterOptionsCache } =
    useFilterOptionsCache(api)

// Replace loadFilterOptionsPublic:
  const loadFilterOptionsPublic = async (caseId: number): Promise<void> => {
    await loadFilterOptionsAndTags(caseId, loadTags)
  }
```

Remove the `LruMap` import, the `filterOptionsCache` variable, `cacheFilterOptions`, the inline `loadFilterOptions`, `loadFilterOptionsAndTags`, `invalidateFilterOptionsCache`, and the `filterOptions` ref from the facade.

- [ ] 9.3 Verify: `npm run typecheck`
- [ ] 9.4 Verify: `npm run test -- --run`
- [ ] 9.5 Commit: `refactor: extract useFilterOptionsCache from useFilterState`

---

### Task 10: Extract useFilterComputed

**Why:** The computed properties (`hasActiveFilters`, `activeFilterCount`, `activeFiltersList`, `isFilterGroupActive`, `clearFilter`, `removeTagFilter`, `clearAllFilters`) are pure derivation from filter state. Extracting them simplifies the facade significantly (~180 lines moved out).

**Files:**
- `src/renderer/src/composables/useFilterComputed.ts` (NEW)
- `src/renderer/src/composables/useFilterState.ts` (update)

**Steps:**

- [ ] 10.1 Create `src/renderer/src/composables/useFilterComputed.ts`:

```typescript
/**
 * Composable for computed filter properties and filter manipulation.
 * Extracted from useFilterState to separate derivation from orchestration.
 */

import { computed, type Ref, type ComputedRef } from 'vue'
import type { FilterState, ActiveFilter } from '../../../shared/types/filters'
import type { Tag } from '../../../shared/types/database-entities'
import type { useFilterCore } from './useFilterCore'

export interface UseFilterComputedReturn {
  hasActiveFilters: ComputedRef<boolean>
  activeFilterCount: ComputedRef<number>
  activeFiltersList: ComputedRef<ActiveFilter[]>
  isFilterGroupActive: (groupId: string) => boolean
  clearFilter: (filterId: string) => void
  removeTagFilter: (tagId: number) => void
  clearAllFilters: () => void
}

/**
 * Computed filter properties and manipulation methods.
 *
 * @param filters - Reactive filter state
 * @param selectedImpactPresets - Currently selected impact presets
 * @param availableTags - Computed list of available tags
 * @param core - Filter core composable (for clearing shared fields)
 * @param syncCoreToFilters - Function to sync core state back to filters
 * @param resetPresets - Function to reset preset selections
 * @param onResetSort - Callback to reset sort order
 * @param selectedAfPreset - AF preset ref (for clearing)
 * @param selectedCaddPreset - CADD preset ref (for clearing)
 */
export function useFilterComputed(
  filters: Ref<FilterState>,
  selectedImpactPresets: Ref<string[]>,
  availableTags: ComputedRef<Tag[]>,
  core: ReturnType<typeof useFilterCore>,
  syncCoreToFilters: () => void,
  resetPresets: () => void,
  onResetSort: () => void,
  selectedAfPreset: Ref<number | null>,
  selectedCaddPreset: Ref<number | null>
): UseFilterComputedReturn {
  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  const hasActiveFilters = computed(() => {
    const afActive =
      filters.value.maxGnomadAf !== null &&
      Number.isNaN(filters.value.maxGnomadAf) === false &&
      filters.value.maxGnomadAf > 0
    const caddActive =
      filters.value.minCadd !== null &&
      Number.isNaN(filters.value.minCadd) === false &&
      filters.value.minCadd >= 0
    const internalAfActive =
      filters.value.maxInternalAf !== null &&
      Number.isNaN(filters.value.maxInternalAf) === false &&
      filters.value.maxInternalAf > 0

    return (
      filters.value.searchQuery !== '' ||
      (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') ||
      selectedImpactPresets.value.length > 0 ||
      filters.value.consequences.length > 0 ||
      filters.value.funcs.length > 0 ||
      filters.value.clinvars.length > 0 ||
      afActive ||
      caddActive ||
      internalAfActive ||
      filters.value.tagIds.length > 0 ||
      filters.value.starredOnly ||
      filters.value.hasCommentOnly ||
      filters.value.acmgClassifications.length > 0 ||
      filters.value.activePanelIds.length > 0 ||
      filters.value.inheritanceModes.length > 0
    )
  })

  const activeFilterCount = computed(() => {
    let count = 0
    if (filters.value.searchQuery !== '') count++
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') count++
    if (selectedImpactPresets.value.length > 0) count++
    if (filters.value.consequences.length > 0) count++
    if (filters.value.funcs.length > 0) count++
    if (filters.value.clinvars.length > 0) count++
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    )
      count++
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    )
      count++
    if (
      filters.value.maxInternalAf !== null &&
      !Number.isNaN(filters.value.maxInternalAf) &&
      filters.value.maxInternalAf > 0
    )
      count++
    if (filters.value.tagIds.length > 0) count++
    if (filters.value.starredOnly) count++
    if (filters.value.hasCommentOnly) count++
    if (filters.value.acmgClassifications.length > 0) count++
    if (filters.value.activePanelIds.length > 0) count++
    if (filters.value.inheritanceModes.length > 0) count++
    return count
  })

  const activeFiltersList = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = []

    if (filters.value.searchQuery !== '') {
      list.push({ id: 'search', label: 'Search', value: filters.value.searchQuery })
    }
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') {
      list.push({ id: 'gene', label: 'Gene', value: filters.value.geneSymbol })
    }
    if (selectedImpactPresets.value.length > 0) {
      list.push({ id: 'impact', label: 'Impact', value: selectedImpactPresets.value.join(', ') })
    }
    if (filters.value.consequences.length > 0) {
      list.push({
        id: 'consequences',
        label: 'Consequences',
        value: `${filters.value.consequences.length} selected`
      })
    }
    if (filters.value.funcs.length > 0) {
      list.push({
        id: 'funcs',
        label: 'Consequence',
        value: `${filters.value.funcs.length} selected`
      })
    }
    if (filters.value.clinvars.length > 0) {
      list.push({
        id: 'clinvars',
        label: 'ClinVar',
        value: `${filters.value.clinvars.length} selected`
      })
    }
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    ) {
      const pct = (filters.value.maxGnomadAf * 100).toFixed(2)
      list.push({ id: 'frequency', label: 'AF \u2264', value: `${pct}%` })
    }
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    ) {
      list.push({ id: 'cadd', label: 'CADD \u2265', value: String(filters.value.minCadd) })
    }
    if (
      filters.value.maxInternalAf !== null &&
      !Number.isNaN(filters.value.maxInternalAf) &&
      filters.value.maxInternalAf > 0
    ) {
      const pct = (filters.value.maxInternalAf * 100).toFixed(2)
      list.push({ id: 'internal-frequency', label: 'Internal AF \u2264', value: `${pct}%` })
    }
    if (filters.value.tagIds.length > 0) {
      const tagNames = availableTags.value
        .filter((t) => filters.value.tagIds.includes(t.id))
        .map((t) => t.name)
      list.push({ id: 'tags', label: 'Tags', value: tagNames.join(', ') })
    }
    if (filters.value.starredOnly) {
      list.push({ id: 'starred', label: 'Starred', value: 'only' })
    }
    if (filters.value.hasCommentOnly) {
      list.push({ id: 'commented', label: 'Commented', value: 'only' })
    }
    if (filters.value.acmgClassifications.length > 0) {
      list.push({
        id: 'acmg',
        label: 'ACMG',
        value: filters.value.acmgClassifications.join(', ')
      })
    }
    if (filters.value.annotationScope === 'all') {
      list.push({ id: 'annotationScope', label: 'Scope', value: 'All (global)' })
    }
    if (filters.value.activePanelIds.length > 0) {
      list.push({
        id: 'panels',
        label: 'Panels',
        value: `${filters.value.activePanelIds.length} panel(s)`
      })
    }
    if (filters.value.inheritanceModes.length > 0) {
      list.push({
        id: 'inheritance',
        label: 'Inheritance',
        value: filters.value.inheritanceModes.join(', ')
      })
    }

    return list
  })

  // -------------------------------------------------------------------------
  // Filter group active check
  // -------------------------------------------------------------------------

  const isFilterGroupActive = (groupId: string): boolean => {
    switch (groupId) {
      case 'search':
        return filters.value.searchQuery !== ''
      case 'gene':
        return filters.value.geneSymbol != null && filters.value.geneSymbol !== ''
      case 'impact':
        return selectedImpactPresets.value.length > 0 || filters.value.consequences.length > 0
      case 'function':
        return filters.value.funcs.length > 0
      case 'clinvar':
        return filters.value.clinvars.length > 0
      case 'frequency':
        return (
          filters.value.maxGnomadAf !== null &&
          !Number.isNaN(filters.value.maxGnomadAf) &&
          filters.value.maxGnomadAf > 0
        )
      case 'internal-frequency':
        return (
          filters.value.maxInternalAf !== null &&
          !Number.isNaN(filters.value.maxInternalAf) &&
          filters.value.maxInternalAf > 0
        )
      case 'cadd':
        return (
          filters.value.minCadd !== null &&
          !Number.isNaN(filters.value.minCadd) &&
          filters.value.minCadd >= 0
        )
      case 'tags':
        return filters.value.tagIds.length > 0
      case 'annotations':
        return (
          filters.value.starredOnly ||
          filters.value.hasCommentOnly ||
          filters.value.acmgClassifications.length > 0
        )
      case 'panels':
        return filters.value.activePanelIds.length > 0
      case 'inheritance':
        return filters.value.inheritanceModes.length > 0
      default:
        return false
    }
  }

  // -------------------------------------------------------------------------
  // Filter manipulation
  // -------------------------------------------------------------------------

  const clearFilter = (filterId: string): void => {
    const coreIdMap: Record<string, string> = {
      consequences: 'consequences',
      funcs: 'funcs',
      clinvars: 'clinvars',
      frequency: 'gnomad_af',
      'internal-frequency': 'internal_af',
      cadd: 'cadd',
      acmg: 'acmg'
    }

    const coreId = coreIdMap[filterId]
    if (coreId !== undefined) {
      core.clearFilter(coreId)
      syncCoreToFilters()
    }

    switch (filterId) {
      case 'search':
        filters.value.searchQuery = ''
        break
      case 'gene':
        filters.value.geneSymbol = ''
        break
      case 'impact':
        selectedImpactPresets.value = []
        break
      case 'frequency':
        selectedAfPreset.value = null
        break
      case 'cadd':
        selectedCaddPreset.value = null
        break
      case 'tags':
        filters.value.tagIds = []
        break
      case 'starred':
        filters.value.starredOnly = false
        break
      case 'commented':
        filters.value.hasCommentOnly = false
        break
      case 'annotationScope':
        filters.value.annotationScope = 'case'
        break
      case 'panels':
        filters.value.activePanelIds = []
        filters.value.panelPaddingBp = 5000
        break
      case 'inheritance':
        filters.value.inheritanceModes = []
        filters.value.analysisGroupId = null
        filters.value.considerPhasing = false
        break
    }
  }

  const removeTagFilter = (tagId: number): void => {
    filters.value.tagIds = filters.value.tagIds.filter((id) => id !== tagId)
  }

  const clearAllFilters = (): void => {
    core.reset()
    syncCoreToFilters()

    filters.value.searchQuery = ''
    filters.value.geneSymbol = ''
    filters.value.tagIds = []
    filters.value.starredOnly = false
    filters.value.hasCommentOnly = false
    filters.value.annotationScope = 'case'
    filters.value.activePanelIds = []
    filters.value.panelPaddingBp = 5000
    filters.value.inheritanceModes = []
    filters.value.analysisGroupId = null
    filters.value.considerPhasing = false
    resetPresets()
    onResetSort()
  }

  return {
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters
  }
}
```

- [ ] 10.2 Update `useFilterState.ts` -- replace inline computed/manipulation code with extracted composable:

```typescript
// Add import:
import { useFilterComputed } from './useFilterComputed'

// Replace computed properties + filter manipulation sections with:
  const {
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters
  } = useFilterComputed(
    filters,
    selectedImpactPresets,
    availableTags,
    core,
    syncCoreToFilters,
    resetPresets,
    onResetSort,
    selectedAfPreset,
    selectedCaddPreset
  )
```

- [ ] 10.3 Verify: `npm run typecheck`
- [ ] 10.4 Verify: `npm run test -- --run`
- [ ] 10.5 Commit: `refactor: extract useFilterComputed from useFilterState`

---

### Task 11: Extract useFilterLifecycle + rewrite useFilterState facade

**Why:** The case-switch watcher and initial search logic are lifecycle concerns, not filter state. Extracting them and then cleaning up the facade reduces it to ~150 lines.

**Files:**
- `src/renderer/src/composables/useFilterLifecycle.ts` (NEW)
- `src/renderer/src/composables/useFilterState.ts` (final rewrite)

**Steps:**

- [ ] 11.1 Create `src/renderer/src/composables/useFilterLifecycle.ts`:

```typescript
/**
 * Composable for filter lifecycle management (case switching, initial search).
 * Extracted from useFilterState to separate lifecycle from state.
 */

import { watch, type Ref, type ComputedRef } from 'vue'
import type { VariantFilter } from '../../../shared/types/api'
import type { useFilterCore } from './useFilterCore'

export interface UseFilterLifecycleDeps {
  core: ReturnType<typeof useFilterCore>
  syncCoreToFilters: () => void
  resetPresets: () => void
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  onResetSort?: () => void
  onCaseSwitch?: () => void
  loadFilterOptions: (caseId: number) => Promise<void>
  resetAdapterFields: () => void
}

export interface UseFilterLifecycleReturn {
  resetForCaseSwitch: () => void
  setInitialSearch: (search: string) => void
}

/**
 * Filter lifecycle management: case switching and initial search.
 *
 * @param caseIdRef - Reactive ref to the current case ID
 * @param filters - Reactive filter state (for setting initial search)
 * @param deps - Dependencies from the facade
 */
export function useFilterLifecycle(
  caseIdRef: Ref<number> | ComputedRef<number>,
  filters: Ref<{ searchQuery: string }>,
  deps: UseFilterLifecycleDeps
): UseFilterLifecycleReturn {
  const {
    core,
    syncCoreToFilters,
    resetPresets,
    onFiltersUpdate,
    onCaseSwitch,
    loadFilterOptions,
    resetAdapterFields
  } = deps

  /**
   * Reset all filters for a case switch (without triggering sort reset).
   */
  const resetForCaseSwitch = (): void => {
    core.reset()
    syncCoreToFilters()
    resetAdapterFields()
    resetPresets()
  }

  /**
   * Set initial search query (e.g., from cohort navigation).
   */
  const setInitialSearch = (search: string): void => {
    if (search !== undefined && search !== '') {
      filters.value.searchQuery = search
    }
  }

  // Watch caseId and reset filters when case changes
  watch(caseIdRef, async (newCaseId, oldCaseId) => {
    if (newCaseId !== oldCaseId && oldCaseId !== undefined) {
      resetForCaseSwitch()
      onCaseSwitch?.()
      onFiltersUpdate({})
      await loadFilterOptions(newCaseId)
    }
  })

  return {
    resetForCaseSwitch,
    setInitialSearch
  }
}
```

- [ ] 11.2 Rewrite `src/renderer/src/composables/useFilterState.ts` as a lean facade:

```typescript
/**
 * Composable for variant filter state management
 *
 * Facade that wires together focused sub-composables:
 * - useFilterCore: shared filter state (consequences, funcs, clinvars, thresholds)
 * - useFilterPresets: impact/AF/CADD presets with bidirectional sync
 * - useFilterExport: Excel export
 * - useGeneAutocomplete: gene symbol search
 * - useFilterOptionsCache: filter options loading with LRU cache
 * - useFilterComputed: active filter derivation, filter manipulation
 * - useFilterLifecycle: case switching, initial search
 *
 * The UseFilterStateReturn public API is unchanged.
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useDebounce } from './useDebounce'
import { useTags } from './useTags'
import { useApiService } from './useApiService'
import { APP_CONFIG } from '../../../shared/config'
import {
  buildFilterFromState,
  type FilterState,
  type UseFilterStateOptions,
  type UseFilterStateReturn
} from './filter-types'
import { useFilterPresets } from './useFilterPresets'
import { useFilterExport } from './useFilterExport'
import { useFilterCore } from './useFilterCore'
import { useGeneAutocomplete } from './useGeneAutocomplete'
import { useFilterOptionsCache } from './useFilterOptionsCache'
import { useFilterComputed } from './useFilterComputed'
import { useFilterLifecycle } from './useFilterLifecycle'

// Re-export types so existing consumers continue to work
export type { FilterState, ActiveFilter, ExportResult, UseFilterStateReturn } from './filter-types'

export function useFilterState(
  caseIdRef: Ref<number> | ComputedRef<number>,
  options: UseFilterStateOptions
): UseFilterStateReturn {
  const { onFiltersUpdate, onResetSort, onCaseSwitch } = options

  // --- Core state ---
  const core = useFilterCore()
  const { api } = useApiService()
  const { loadTags, getTags } = useTags()

  // --- Filter state ---
  const filters = ref<FilterState>({
    searchQuery: '',
    geneSymbol: '',
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    maxGnomadAf: null as number | null,
    minCadd: null as number | null,
    maxInternalAf: null as number | null,
    minCarriers: null as number | null,
    tagIds: [] as number[],
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [] as string[],
    annotationScope: 'case' as const,
    activePanelIds: [] as number[],
    panelPaddingBp: 5000,
    inheritanceModes: [] as string[],
    analysisGroupId: null as number | null,
    considerPhasing: false
  })

  const exporting = ref(false)

  /** Sync core state back to the filters ref. */
  function syncCoreToFilters(): void {
    filters.value.consequences = core.consequences.value
    filters.value.funcs = core.funcs.value
    filters.value.clinvars = core.clinvars.value
    filters.value.maxGnomadAf = core.gnomadAfMax.value
    filters.value.minCadd = core.caddMin.value
    filters.value.maxInternalAf = core.maxInternalAf.value
    filters.value.acmgClassifications = core.acmgClassifications.value
  }

  /** Reset adapter-specific fields (not owned by core). */
  function resetAdapterFields(): void {
    filters.value.searchQuery = ''
    filters.value.geneSymbol = ''
    filters.value.tagIds = []
    filters.value.starredOnly = false
    filters.value.hasCommentOnly = false
    filters.value.annotationScope = 'case'
    filters.value.activePanelIds = []
    filters.value.panelPaddingBp = 5000
    filters.value.inheritanceModes = []
    filters.value.analysisGroupId = null
    filters.value.considerPhasing = false
  }

  // --- Presets ---
  const {
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    afPresets,
    caddPresets,
    impactPresets,
    resetPresets
  } = useFilterPresets(filters, () => debouncedEmit())

  // --- Filter emission ---
  const emitFilters = () => {
    const variantFilter = buildFilterFromState(filters.value, selectedImpactPresets.value)
    onFiltersUpdate(variantFilter)
  }
  const { debouncedFn: debouncedEmit } = useDebounce(emitFilters, APP_CONFIG.DEBOUNCE_MS)

  // --- Sub-composables ---
  const { exportToExcel } = useFilterExport(filters, selectedImpactPresets, exporting)
  const { geneSymbolSuggestions, loadingSuggestions, searchGeneSymbols, handleGeneClear } =
    useGeneAutocomplete(api, caseIdRef, filters)
  const { filterOptions, loadFilterOptionsAndTags, invalidateFilterOptionsCache } =
    useFilterOptionsCache(api)

  const availableTags = computed(() => getTags())

  const {
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters
  } = useFilterComputed(
    filters,
    selectedImpactPresets,
    availableTags,
    core,
    syncCoreToFilters,
    resetPresets,
    onResetSort,
    selectedAfPreset,
    selectedCaddPreset
  )

  const { resetForCaseSwitch, setInitialSearch } = useFilterLifecycle(caseIdRef, filters, {
    core,
    syncCoreToFilters,
    resetPresets,
    onFiltersUpdate,
    onCaseSwitch,
    loadFilterOptions: async (caseId: number) => {
      await loadFilterOptionsAndTags(caseId, loadTags)
    },
    resetAdapterFields
  })

  // --- Watchers ---
  const filterEmitKey = computed(() => JSON.stringify(filters.value))
  watch(filterEmitKey, () => {
    debouncedEmit()
  })

  // --- Public API ---
  const loadFilterOptionsPublic = async (caseId: number): Promise<void> => {
    await loadFilterOptionsAndTags(caseId, loadTags)
  }

  return {
    filters,
    filterOptions,
    geneSymbolSuggestions,
    loadingSuggestions,
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    exporting,
    afPresets,
    caddPresets,
    impactPresets,
    availableTags,
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters,
    handleGeneClear,
    searchGeneSymbols,
    emitFilters,
    loadFilterOptions: loadFilterOptionsPublic,
    invalidateFilterOptionsCache,
    resetForCaseSwitch,
    setInitialSearch,
    exportToExcel
  }
}
```

- [ ] 11.3 Verify: `npm run typecheck`
- [ ] 11.4 Verify: `npm run test -- --run`
- [ ] 11.5 Verify: `npm run lint:check`
- [ ] 11.6 Commit: `refactor: extract useFilterLifecycle and rewrite useFilterState as lean facade`

---

## Phase 3: Tests

### Task 12: Write tests for all new composables + preload contract test

**Why:** Every new composable needs unit tests. The preload contract test catches drift between the preload bridge and the `WindowAPI` type.

**Files (6 new test files):**

#### 12.1 `tests/renderer/composables/useGeneAutocomplete.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useGeneAutocomplete } from '../../../src/renderer/src/composables/useGeneAutocomplete'
import type { WindowAPI } from '../../../src/shared/types/api'

// Mock logService
vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

function createMockApi(overrides: Partial<WindowAPI['variants']> = {}): WindowAPI {
  return {
    variants: {
      query: vi.fn(),
      getFilterOptions: vi.fn(),
      search: vi.fn(),
      geneSymbols: vi.fn().mockResolvedValue(['BRCA1', 'BRCA2']),
      ...overrides
    }
  } as unknown as WindowAPI
}

describe('useGeneAutocomplete', () => {
  let mockApi: WindowAPI
  const caseIdRef = ref(1)
  let filters: ReturnType<typeof ref<{ geneSymbol: string }>>

  beforeEach(() => {
    mockApi = createMockApi()
    filters = ref({ geneSymbol: 'TEST' })
  })

  it('returns empty suggestions for short queries (< 2 chars)', async () => {
    const { searchGeneSymbols, geneSymbolSuggestions } = useGeneAutocomplete(
      mockApi,
      caseIdRef,
      filters
    )
    await searchGeneSymbols('A')
    expect(geneSymbolSuggestions.value).toEqual([])
    expect(mockApi.variants.geneSymbols).not.toHaveBeenCalled()
  })

  it('returns empty suggestions for empty query', async () => {
    const { searchGeneSymbols, geneSymbolSuggestions } = useGeneAutocomplete(
      mockApi,
      caseIdRef,
      filters
    )
    await searchGeneSymbols('')
    expect(geneSymbolSuggestions.value).toEqual([])
  })

  it('fetches gene symbols for valid query', async () => {
    const { searchGeneSymbols, geneSymbolSuggestions, loadingSuggestions } = useGeneAutocomplete(
      mockApi,
      caseIdRef,
      filters
    )
    await searchGeneSymbols('BRC')
    expect(mockApi.variants.geneSymbols).toHaveBeenCalledWith(1, 'BRC', 50)
    expect(geneSymbolSuggestions.value).toEqual(['BRCA1', 'BRCA2'])
    expect(loadingSuggestions.value).toBe(false)
  })

  it('handles API errors gracefully', async () => {
    const errorApi = createMockApi({
      geneSymbols: vi.fn().mockRejectedValue(new Error('Network error'))
    })
    const { searchGeneSymbols, geneSymbolSuggestions } = useGeneAutocomplete(
      errorApi,
      caseIdRef,
      filters
    )
    await searchGeneSymbols('BRC')
    expect(geneSymbolSuggestions.value).toEqual([])
  })

  it('handles undefined API gracefully', async () => {
    const { searchGeneSymbols, geneSymbolSuggestions } = useGeneAutocomplete(
      undefined,
      caseIdRef,
      filters
    )
    await searchGeneSymbols('BRC')
    expect(geneSymbolSuggestions.value).toEqual([])
  })

  it('clears gene symbol and suggestions on handleGeneClear', () => {
    const { handleGeneClear, geneSymbolSuggestions } = useGeneAutocomplete(
      mockApi,
      caseIdRef,
      filters
    )
    geneSymbolSuggestions.value = ['BRCA1']
    handleGeneClear()
    expect(filters.value.geneSymbol).toBe('')
    expect(geneSymbolSuggestions.value).toEqual([])
  })
})
```

#### 12.2 `tests/renderer/composables/useFilterOptionsCache.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFilterOptionsCache } from '../../../src/renderer/src/composables/useFilterOptionsCache'
import type { WindowAPI, FilterOptions } from '../../../src/shared/types/api'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

const mockOptions: FilterOptions = {
  consequences: ['HIGH', 'MODERATE'],
  funcs: ['missense_variant'],
  clinvars: ['Pathogenic'],
  minCadd: 0,
  maxCadd: 40,
  minGnomadAf: 0,
  maxGnomadAf: 0.5,
  columnMeta: []
}

function createMockApi(): WindowAPI {
  return {
    variants: {
      query: vi.fn(),
      getFilterOptions: vi.fn().mockResolvedValue(mockOptions),
      search: vi.fn(),
      geneSymbols: vi.fn()
    }
  } as unknown as WindowAPI
}

describe('useFilterOptionsCache', () => {
  let mockApi: WindowAPI

  beforeEach(() => {
    mockApi = createMockApi()
  })

  it('loads filter options from API on cache miss', async () => {
    const { filterOptions, loadFilterOptions } = useFilterOptionsCache(mockApi)
    await loadFilterOptions(1)
    expect(mockApi.variants.getFilterOptions).toHaveBeenCalledWith(1)
    expect(filterOptions.value).toEqual(mockOptions)
  })

  it('returns cached options on cache hit (no API call)', async () => {
    const { filterOptions, loadFilterOptions } = useFilterOptionsCache(mockApi)
    await loadFilterOptions(1)
    vi.mocked(mockApi.variants.getFilterOptions).mockClear()

    await loadFilterOptions(1)
    expect(mockApi.variants.getFilterOptions).not.toHaveBeenCalled()
    expect(filterOptions.value).toEqual(mockOptions)
  })

  it('invalidates cache', async () => {
    const { loadFilterOptions, invalidateFilterOptionsCache } = useFilterOptionsCache(mockApi)
    await loadFilterOptions(1)
    vi.mocked(mockApi.variants.getFilterOptions).mockClear()

    invalidateFilterOptionsCache()
    await loadFilterOptions(1)
    expect(mockApi.variants.getFilterOptions).toHaveBeenCalledWith(1)
  })

  it('loads options and tags in parallel', async () => {
    const loadTags = vi.fn().mockResolvedValue(undefined)
    const { loadFilterOptionsAndTags, filterOptions } = useFilterOptionsCache(mockApi)
    await loadFilterOptionsAndTags(1, loadTags)
    expect(mockApi.variants.getFilterOptions).toHaveBeenCalledWith(1)
    expect(loadTags).toHaveBeenCalled()
    expect(filterOptions.value).toEqual(mockOptions)
  })

  it('only loads tags when options are cached', async () => {
    const loadTags = vi.fn().mockResolvedValue(undefined)
    const { loadFilterOptions, loadFilterOptionsAndTags } = useFilterOptionsCache(mockApi)

    await loadFilterOptions(1)
    vi.mocked(mockApi.variants.getFilterOptions).mockClear()

    await loadFilterOptionsAndTags(1, loadTags)
    expect(mockApi.variants.getFilterOptions).not.toHaveBeenCalled()
    expect(loadTags).toHaveBeenCalled()
  })

  it('handles API errors gracefully', async () => {
    const errorApi = {
      variants: {
        getFilterOptions: vi.fn().mockRejectedValue(new Error('DB error'))
      }
    } as unknown as WindowAPI
    const { loadFilterOptions, filterOptions } = useFilterOptionsCache(errorApi)
    await loadFilterOptions(1)
    // Should not throw; filterOptions stays at default
    expect(filterOptions.value.consequences).toEqual([])
  })

  it('handles undefined API gracefully', async () => {
    const { loadFilterOptions, filterOptions } = useFilterOptionsCache(undefined)
    await loadFilterOptions(1)
    expect(filterOptions.value.consequences).toEqual([])
  })

  it('caches different cases separately', async () => {
    const options2: FilterOptions = { ...mockOptions, consequences: ['LOW'] }
    vi.mocked(mockApi.variants.getFilterOptions)
      .mockResolvedValueOnce(mockOptions)
      .mockResolvedValueOnce(options2)

    const { loadFilterOptions, filterOptions } = useFilterOptionsCache(mockApi)
    await loadFilterOptions(1)
    expect(filterOptions.value.consequences).toEqual(['HIGH', 'MODERATE'])

    await loadFilterOptions(2)
    expect(filterOptions.value.consequences).toEqual(['LOW'])

    // Case 1 still cached
    await loadFilterOptions(1)
    expect(filterOptions.value.consequences).toEqual(['HIGH', 'MODERATE'])
  })
})
```

#### 12.3 `tests/renderer/composables/useFilterComputed.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { useFilterComputed } from '../../../src/renderer/src/composables/useFilterComputed'
import type { FilterState } from '../../../src/shared/types/filters'
import { useFilterCore } from '../../../src/renderer/src/composables/useFilterCore'

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    searchQuery: '',
    geneSymbol: '',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    maxInternalAf: null,
    minCarriers: null,
    tagIds: [],
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    annotationScope: 'case',
    activePanelIds: [],
    panelPaddingBp: 5000,
    inheritanceModes: [],
    analysisGroupId: null,
    considerPhasing: false,
    ...overrides
  }
}

describe('useFilterComputed', () => {
  function setup(overrides: Partial<FilterState> = {}) {
    const filters = ref(makeFilters(overrides))
    const selectedImpactPresets = ref<string[]>([])
    const availableTags = computed(() => [
      { id: 1, name: 'Candidate', color: '#4CAF50' },
      { id: 2, name: 'Review', color: '#FF9800' }
    ])
    const core = useFilterCore()
    const syncCoreToFilters = vi.fn()
    const resetPresets = vi.fn()
    const onResetSort = vi.fn()
    const selectedAfPreset = ref<number | null>(null)
    const selectedCaddPreset = ref<number | null>(null)

    const result = useFilterComputed(
      filters,
      selectedImpactPresets,
      availableTags,
      core,
      syncCoreToFilters,
      resetPresets,
      onResetSort,
      selectedAfPreset,
      selectedCaddPreset
    )

    return { ...result, filters, selectedImpactPresets, syncCoreToFilters, resetPresets, onResetSort }
  }

  it('hasActiveFilters is false when all filters are default', () => {
    const { hasActiveFilters } = setup()
    expect(hasActiveFilters.value).toBe(false)
  })

  it('hasActiveFilters is true when searchQuery is set', () => {
    const { hasActiveFilters } = setup({ searchQuery: 'BRCA1' })
    expect(hasActiveFilters.value).toBe(true)
  })

  it('activeFilterCount counts multiple active filters', () => {
    const { activeFilterCount } = setup({
      searchQuery: 'test',
      geneSymbol: 'BRCA1',
      starredOnly: true
    })
    expect(activeFilterCount.value).toBe(3)
  })

  it('activeFiltersList includes search filter', () => {
    const { activeFiltersList } = setup({ searchQuery: 'BRCA1' })
    expect(activeFiltersList.value).toContainEqual({
      id: 'search',
      label: 'Search',
      value: 'BRCA1'
    })
  })

  it('activeFiltersList includes tag filter with names', () => {
    const { activeFiltersList } = setup({ tagIds: [1, 2] })
    const tagFilter = activeFiltersList.value.find((f) => f.id === 'tags')
    expect(tagFilter).toBeDefined()
    expect(tagFilter!.value).toBe('Candidate, Review')
  })

  it('isFilterGroupActive returns correct values', () => {
    const { isFilterGroupActive, filters } = setup()
    expect(isFilterGroupActive('search')).toBe(false)
    filters.value.searchQuery = 'test'
    expect(isFilterGroupActive('search')).toBe(true)
  })

  it('clearFilter clears search', () => {
    const { clearFilter, filters } = setup({ searchQuery: 'test' })
    clearFilter('search')
    expect(filters.value.searchQuery).toBe('')
  })

  it('clearFilter clears tags', () => {
    const { clearFilter, filters } = setup({ tagIds: [1, 2] })
    clearFilter('tags')
    expect(filters.value.tagIds).toEqual([])
  })

  it('removeTagFilter removes specific tag', () => {
    const { removeTagFilter, filters } = setup({ tagIds: [1, 2, 3] })
    removeTagFilter(2)
    expect(filters.value.tagIds).toEqual([1, 3])
  })

  it('clearAllFilters resets everything', () => {
    const { clearAllFilters, filters, resetPresets, onResetSort } = setup({
      searchQuery: 'test',
      geneSymbol: 'BRCA1',
      tagIds: [1],
      starredOnly: true
    })
    clearAllFilters()
    expect(filters.value.searchQuery).toBe('')
    expect(filters.value.geneSymbol).toBe('')
    expect(filters.value.tagIds).toEqual([])
    expect(filters.value.starredOnly).toBe(false)
    expect(resetPresets).toHaveBeenCalled()
    expect(onResetSort).toHaveBeenCalled()
  })
})
```

#### 12.4 `tests/renderer/composables/useFilterLifecycle.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useFilterLifecycle } from '../../../src/renderer/src/composables/useFilterLifecycle'
import { useFilterCore } from '../../../src/renderer/src/composables/useFilterCore'

describe('useFilterLifecycle', () => {
  const core = useFilterCore()
  let deps: Parameters<typeof useFilterLifecycle>[2]
  let caseIdRef: ReturnType<typeof ref<number>>
  let filters: ReturnType<typeof ref<{ searchQuery: string }>>

  beforeEach(() => {
    caseIdRef = ref(1)
    filters = ref({ searchQuery: '' })
    deps = {
      core,
      syncCoreToFilters: vi.fn(),
      resetPresets: vi.fn(),
      onFiltersUpdate: vi.fn(),
      onCaseSwitch: vi.fn(),
      loadFilterOptions: vi.fn().mockResolvedValue(undefined),
      resetAdapterFields: vi.fn()
    }
  })

  it('resets filters on case switch', () => {
    const { resetForCaseSwitch } = useFilterLifecycle(caseIdRef, filters, deps)
    resetForCaseSwitch()
    expect(deps.syncCoreToFilters).toHaveBeenCalled()
    expect(deps.resetAdapterFields).toHaveBeenCalled()
    expect(deps.resetPresets).toHaveBeenCalled()
  })

  it('sets initial search query', () => {
    const { setInitialSearch } = useFilterLifecycle(caseIdRef, filters, deps)
    setInitialSearch('BRCA1')
    expect(filters.value.searchQuery).toBe('BRCA1')
  })

  it('ignores empty initial search', () => {
    const { setInitialSearch } = useFilterLifecycle(caseIdRef, filters, deps)
    setInitialSearch('')
    expect(filters.value.searchQuery).toBe('')
  })

  it('calls deps on case ID change', async () => {
    useFilterLifecycle(caseIdRef, filters, deps)

    caseIdRef.value = 2
    await nextTick()
    // Allow async watcher to settle
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(deps.onCaseSwitch).toHaveBeenCalled()
    expect(deps.onFiltersUpdate).toHaveBeenCalledWith({})
    expect(deps.loadFilterOptions).toHaveBeenCalledWith(2)
  })

  it('does not trigger on initial mount (same ID)', async () => {
    useFilterLifecycle(caseIdRef, filters, deps)
    await nextTick()
    expect(deps.onCaseSwitch).not.toHaveBeenCalled()
  })
})
```

#### 12.5 `tests/renderer/composables/useFilterState-integration.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useFilterState } from '../../../src/renderer/src/composables/useFilterState'

// Mock all dependencies
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      variants: {
        query: vi.fn(),
        getFilterOptions: vi.fn().mockResolvedValue({
          consequences: [],
          funcs: [],
          clinvars: [],
          minCadd: null,
          maxCadd: null,
          minGnomadAf: null,
          maxGnomadAf: null,
          columnMeta: []
        }),
        search: vi.fn(),
        geneSymbols: vi.fn().mockResolvedValue([])
      },
      export: {
        variants: vi.fn().mockResolvedValue({ success: true }),
        cohort: vi.fn()
      },
      tags: {
        list: vi.fn().mockResolvedValue([])
      }
    },
    isAvailable: { value: true }
  })
}))

vi.mock('../../../src/renderer/src/composables/useTags', () => ({
  useTags: () => ({
    loadTags: vi.fn().mockResolvedValue(undefined),
    getTags: () => []
  })
}))

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

describe('useFilterState integration', () => {
  it('returns all expected keys in UseFilterStateReturn', () => {
    const caseIdRef = ref(1)
    const onFiltersUpdate = vi.fn()
    const onResetSort = vi.fn()

    const result = useFilterState(caseIdRef, { onFiltersUpdate, onResetSort })

    // Verify all public API keys exist
    const expectedKeys = [
      'filters',
      'filterOptions',
      'geneSymbolSuggestions',
      'loadingSuggestions',
      'selectedImpactPresets',
      'selectedAfPreset',
      'selectedCaddPreset',
      'exporting',
      'afPresets',
      'caddPresets',
      'impactPresets',
      'availableTags',
      'hasActiveFilters',
      'activeFilterCount',
      'activeFiltersList',
      'isFilterGroupActive',
      'clearFilter',
      'removeTagFilter',
      'clearAllFilters',
      'handleGeneClear',
      'searchGeneSymbols',
      'emitFilters',
      'loadFilterOptions',
      'invalidateFilterOptionsCache',
      'resetForCaseSwitch',
      'setInitialSearch',
      'exportToExcel'
    ]

    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key)
    }
  })

  it('starts with no active filters', () => {
    const caseIdRef = ref(1)
    const result = useFilterState(caseIdRef, {
      onFiltersUpdate: vi.fn(),
      onResetSort: vi.fn()
    })

    expect(result.hasActiveFilters.value).toBe(false)
    expect(result.activeFilterCount.value).toBe(0)
    expect(result.activeFiltersList.value).toEqual([])
  })

  it('emitFilters calls onFiltersUpdate callback', () => {
    const onFiltersUpdate = vi.fn()
    const caseIdRef = ref(1)
    const result = useFilterState(caseIdRef, {
      onFiltersUpdate,
      onResetSort: vi.fn()
    })

    result.filters.value.searchQuery = 'BRCA1'
    result.emitFilters()
    expect(onFiltersUpdate).toHaveBeenCalled()
    const emittedFilters = onFiltersUpdate.mock.calls[0][0]
    expect(emittedFilters.search_query).toBe('BRCA1')
  })

  it('clearAllFilters resets filter state', () => {
    const caseIdRef = ref(1)
    const result = useFilterState(caseIdRef, {
      onFiltersUpdate: vi.fn(),
      onResetSort: vi.fn()
    })

    result.filters.value.searchQuery = 'test'
    result.filters.value.starredOnly = true
    result.clearAllFilters()

    expect(result.filters.value.searchQuery).toBe('')
    expect(result.filters.value.starredOnly).toBe(false)
  })
})
```

#### 12.6 `tests/shared/types/preload-contract.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Preload contract test - verifies the preload bridge exposes
 * exactly the top-level API keys defined in WindowAPI.
 *
 * This is a runtime manifest test: it parses source files to extract
 * keys and compares them. If preload adds/removes a key without updating
 * WindowAPI (or vice versa), this test fails.
 */

// Expected top-level keys on window.api (from WindowAPI interface)
const EXPECTED_API_KEYS = [
  'analysisGroups',
  'annotations',
  'audit',
  'auth',
  'batchImport',
  'caseComments',
  'caseMetadata',
  'caseMetrics',
  'cases',
  'cohort',
  'database',
  'export',
  'geneLists',
  'geneRef',
  'gnomad',
  'hpo',
  'import',
  'logs',
  'myvariant',
  'panels',
  'presets',
  'protein',
  'regionFiles',
  'shell',
  'spliceai',
  'system',
  'tags',
  'transcripts',
  'updater',
  'variants',
  'vep'
].sort()

describe('preload contract', () => {
  it('WindowAPI interface defines the expected top-level keys', () => {
    const apiSource = readFileSync(
      resolve(__dirname, '../../../src/shared/types/api.ts'),
      'utf-8'
    )

    // Extract keys from WindowAPI interface definition
    const windowApiMatch = apiSource.match(
      /export interface WindowAPI\s*\{([^}]+)\}/s
    )
    expect(windowApiMatch).not.toBeNull()

    const body = windowApiMatch![1]
    const keyMatches = body.match(/^\s*(\w+)\s*:/gm)
    expect(keyMatches).not.toBeNull()

    const apiKeys = keyMatches!
      .map((m) => m.replace(/\s*:\s*$/, '').trim())
      .sort()

    expect(apiKeys).toEqual(EXPECTED_API_KEYS)
  })

  it('preload exposes the same top-level keys as WindowAPI', () => {
    const preloadSource = readFileSync(
      resolve(__dirname, '../../../src/preload/index.ts'),
      'utf-8'
    )

    // Extract top-level keys from `const api = { ... }` object
    // These are the keys at the first level of indentation (2 spaces)
    const apiBlockMatch = preloadSource.match(/const api\s*=\s*\{([\s\S]+?)^}/m)
    expect(apiBlockMatch).not.toBeNull()

    const apiBlock = apiBlockMatch![1]
    // Match lines like "  cases: {" or "  system: {" (top-level keys)
    const keyLines = apiBlock.match(/^\s{2}(\w+)\s*:\s*\{/gm)
    expect(keyLines).not.toBeNull()

    const preloadKeys = keyLines!
      .map((line) => line.trim().replace(/\s*:\s*\{.*/, ''))
      .sort()

    expect(preloadKeys).toEqual(EXPECTED_API_KEYS)
  })

  it('mockApi exposes the same top-level keys as WindowAPI', () => {
    const mockSource = readFileSync(
      resolve(__dirname, '../../../src/renderer/src/mocks/mockApi.ts'),
      'utf-8'
    )

    // Extract keys from mockApi object
    const mockBlockMatch = mockSource.match(/export const mockApi[\s\S]*?=\s*\{([\s\S]+)/)
    expect(mockBlockMatch).not.toBeNull()

    const mockBlock = mockBlockMatch![1]
    // Match top-level keys: "  keyName: {" or "  keyName: async"
    const keyLines = mockBlock.match(/^\s{2}(\w+)\s*:\s*\{/gm)
    expect(keyLines).not.toBeNull()

    const mockKeys = keyLines!
      .map((line) => line.trim().replace(/\s*:\s*\{.*/, ''))
      .sort()

    expect(mockKeys).toEqual(EXPECTED_API_KEYS)
  })
})
```

**Steps:**

- [ ] 12.1 Create `tests/renderer/composables/useGeneAutocomplete.test.ts`
- [ ] 12.2 Create `tests/renderer/composables/useFilterOptionsCache.test.ts`
- [ ] 12.3 Create `tests/renderer/composables/useFilterComputed.test.ts`
- [ ] 12.4 Create `tests/renderer/composables/useFilterLifecycle.test.ts`
- [ ] 12.5 Create `tests/renderer/composables/useFilterState-integration.test.ts`
- [ ] 12.6 Create `tests/shared/types/preload-contract.test.ts`
- [ ] 12.7 Verify all new tests pass:

```bash
npm run test -- --run tests/renderer/composables/useGeneAutocomplete.test.ts
npm run test -- --run tests/renderer/composables/useFilterOptionsCache.test.ts
npm run test -- --run tests/renderer/composables/useFilterComputed.test.ts
npm run test -- --run tests/renderer/composables/useFilterLifecycle.test.ts
npm run test -- --run tests/renderer/composables/useFilterState-integration.test.ts
npm run test -- --run tests/shared/types/preload-contract.test.ts
```

- [ ] 12.8 Verify full test suite still passes: `npm run test -- --run`
- [ ] 12.9 Commit: `test: add tests for extracted composables and preload contract`

---

## Phase 4: Coverage Infrastructure

### Task 13: Measure actuals, set per-glob thresholds with autoUpdate, wire CI

**Why:** The current flat 70% global threshold is a lie -- it doesn't reflect actual per-directory coverage and doesn't ratchet. We need honest, calibrated thresholds.

**Files:**
- `vitest.config.ts`
- `.github/workflows/build.yml`
- `.github/workflows/release.yml`

**Steps:**

- [ ] 13.1 Run coverage and record actual numbers:

```bash
npm run rebuild:node && npx vitest run --coverage
```

Read the coverage summary output. Record per-directory actuals for:
- Global (all `src/`)
- `src/shared/**/*.ts`
- `src/main/database/**/*.ts`
- `src/main/import/**/*.ts`
- `src/main/workers/**/*.ts`
- `src/main/ipc/**/*.ts`
- `src/renderer/src/composables/**/*.ts`

- [ ] 13.2 Update `vitest.config.ts` -- set per-glob thresholds ~2% below measured actuals:

```typescript
// vitest.config.ts -- replace the coverage section (lines 42-58)
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
        autoUpdate: true,
        // Global floor -- set from measured actuals (~2% below)
        // PLACEHOLDER: replace with actual measured values
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
        // Per-glob -- set from measured actuals (~2% below)
        'src/shared/**/*.ts': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        'src/main/database/**/*.ts': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        'src/main/import/**/*.ts': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        'src/main/workers/**/*.ts': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        'src/main/ipc/**/*.ts': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        }
      },
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage'
    }
```

Replace all `0` values with measured actuals minus 2%. For example, if `src/shared/` has 85% lines coverage, set `lines: 83`.

- [ ] 13.3 Run coverage again to verify thresholds pass:

```bash
npx vitest run --coverage
```

The `autoUpdate: true` flag will automatically ratchet thresholds upward if coverage exceeds them, so the exact numbers will be rewritten by Vitest.

- [ ] 13.4 Update `.github/workflows/build.yml` -- change test step to run coverage on ubuntu:

```yaml
      # Replace the test step (line ~68):
      # BEFORE:
      - name: Run tests
        run: npm run test

      # AFTER:
      - name: Run tests
        run: npm run test
        if: runner.os != 'Linux'

      - name: Run tests with coverage
        if: runner.os == 'Linux'
        run: npx vitest run --coverage

      - name: Upload coverage
        if: runner.os == 'Linux'
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/coverage-summary.json
```

- [ ] 13.5 Update `.github/workflows/release.yml` -- add lint and typecheck before tests for all OS jobs.

For the linux release job (and similarly for macos and windows), add before the test step:

```yaml
      - name: Run linter
        run: npm run lint:check

      - name: Run type check
        run: npm run typecheck
```

- [ ] 13.6 Verify `.gitignore` already has `coverage/` -- it does (line 54). No change needed.

- [ ] 13.7 Verify: `npm run test -- --run` (without coverage, to check nothing broke)
- [ ] 13.8 Verify: `npm run lint:check`
- [ ] 13.9 Verify: `npm run typecheck`
- [ ] 13.10 Commit: `chore: add per-glob coverage thresholds with autoUpdate and wire CI`

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run lint:check` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test -- --run` passes (all tests including new ones)
- [ ] No `(api as any)` casts in renderer: `grep -r "(api as any)" src/renderer/`
- [ ] No renderer->main imports: `grep -r "from.*main/database/types\|from.*main/import" src/renderer/ --include="*.ts" --include="*.vue"`
- [ ] No unauthorized `window.api.` calls (only approved exceptions)
- [ ] `UseFilterStateReturn` interface unchanged -- consumers see no difference
- [ ] `useFilterState.ts` reduced to ~150 lines
- [ ] Coverage thresholds calibrated and passing
- [ ] CI workflows updated (build with coverage, release with lint+typecheck)
