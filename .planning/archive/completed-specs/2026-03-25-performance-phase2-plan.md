# Performance Optimization Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate case sidebar bottleneck (10,500 queries → 1 per page) and case-switch lag (6s → instant) via server-side paginated case list with infinite scroll, duplicate query elimination, and remaining worker pool migrations.

**Architecture:** New `cases:query` IPC endpoint with `CaseRepository.queryCases()` (single JOIN query), `v-infinite-scroll` for sidebar, filter options caching, `markRaw` for IPC data, `database:overview` to worker pool, application preferences UI with dynamic worker threads.

**Tech Stack:** Vuetify 3 (`v-infinite-scroll`), better-sqlite3-multiple-ciphers (GROUP_CONCAT + LEFT JOIN), Piscina, Vue 3 (`markRaw`, `shallowRef`), Zod, Vitest

**Spec:** `.planning/specs/2026-03-25-performance-phase2-design.md`

---

## Parallelization Map

```
Phase 1 - Wave 1 (2 parallel tasks):
  Task 1: CaseRepository.queryCases + CaseSearchParams schema     [database layer]
  Task 2: cases:query handler + DbTaskType + db-worker + overview  [IPC + worker layer]

Phase 1 - Wave 2 (2 parallel tasks, after Wave 1 merges):
  Task 3: CaseList.vue rewrite with v-infinite-scroll              [renderer]
  Task 4: Eliminate duplicate getFilterOptions + cache + markRaw   [composables]

Phase 2 - Wave 3 (2 parallel tasks):
  Task 5: settingsStore + ApplicationPreferences.vue               [renderer]
  Task 6: Dynamic maxThreads + system:getCpuCount IPC              [main process]

Phase 2 - Wave 4:
  Task 7: Predictive pre-fetch in useOffsetPagination              [composable]

Phase 2 - Wave 5 (deferred P2):
  Task 8: AssociationDataBuilder to db-worker                      [statistics]
```

---

## Phase 1: Critical Performance Fixes

### Task 1: CaseRepository.queryCases + CaseSearchParams Schema

**Files:**
- Modify: `src/main/database/CaseRepository.ts`
- Modify: `src/shared/types/ipc-schemas.ts`
- Modify: `src/main/database/types.ts` (add CaseWithCohorts type)
- Create: `tests/main/database/case-query.test.ts`

- [ ] **Step 1: Define CaseWithCohorts type and CaseSearchParams**

In `src/main/database/types.ts`, add after the `Case` interface:

```typescript
export interface CaseWithCohorts extends Case {
  cohort_names: string[]
  cohort_ids: number[]
  affected_status?: string | null
  sex?: string | null
}

export interface CaseSearchParams {
  limit: number
  offset?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
  search_term?: string
  cohort_ids?: number[]
  _count_needed?: boolean
}
```

- [ ] **Step 2: Add Zod validation schema**

In `src/shared/types/ipc-schemas.ts`, add `CaseSearchParamsSchema` following the `CohortSearchParamsSchema` pattern:

```typescript
export const CaseSearchParamsSchema = z.object({
  limit: z.number().int().positive().max(1000).default(50),
  offset: z.number().int().nonnegative().optional().default(0),
  sort_by: z.enum(['name', 'created_at', 'variant_count']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
  search_term: nullishString(),
  cohort_ids: z.array(z.number().int().positive()).optional(),
  _count_needed: z.boolean().optional()
})

export type ValidatedCaseSearchParams = z.infer<typeof CaseSearchParamsSchema>
```

- [ ] **Step 3: Write tests for queryCases**

Create `tests/main/database/case-query.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../src/main/database'

describe('CaseRepository.queryCases', () => {
  let db: DatabaseService

  beforeAll(() => {
    db = new DatabaseService(':memory:')
    // Insert test cases with metadata and cohort assignments
    // Case 'Alpha' in cohort 'GroupA', affected_status='affected'
    // Case 'Beta' in cohort 'GroupA' and 'GroupB'
    // Case 'Gamma' with no cohort
    // ... insert 10+ cases for pagination testing
  })

  it('returns paginated results with correct total_count', () => {
    const result = db.cases.queryCases({ limit: 2, offset: 0 })
    expect(result.data.length).toBe(2)
    expect(result.total_count).toBeGreaterThan(2)
  })

  it('search filter matches case names (LIKE)', () => {
    const result = db.cases.queryCases({ limit: 50, search_term: 'Alpha' })
    expect(result.data.every(c => c.name.includes('Alpha'))).toBe(true)
  })

  it('multi-cohort filter returns matching cases', () => {
    // Get cohort IDs, filter by them
    const result = db.cases.queryCases({ limit: 50, cohort_ids: [cohortAId] })
    expect(result.data.every(c => c.cohort_ids.includes(cohortAId))).toBe(true)
  })

  it('sorts by name, created_at, variant_count', () => {
    const byName = db.cases.queryCases({ limit: 50, sort_by: 'name', sort_order: 'asc' })
    expect(byName.data[0].name <= byName.data[1].name).toBe(true)
  })

  it('skips COUNT when _count_needed is false', () => {
    const result = db.cases.queryCases({ limit: 50, _count_needed: false })
    expect(result.total_count).toBe(0)
    expect(result.data.length).toBeGreaterThan(0)
  })

  it('includes cohort_names and cohort_ids arrays', () => {
    const result = db.cases.queryCases({ limit: 50 })
    const beta = result.data.find(c => c.name === 'Beta')
    expect(beta?.cohort_names).toContain('GroupA')
    expect(beta?.cohort_names).toContain('GroupB')
    expect(beta?.cohort_ids.length).toBe(2)
  })

  it('returns empty arrays for cases with no cohorts', () => {
    const result = db.cases.queryCases({ limit: 50 })
    const gamma = result.data.find(c => c.name === 'Gamma')
    expect(gamma?.cohort_names).toEqual([])
    expect(gamma?.cohort_ids).toEqual([])
  })

  it('includes affected_status and sex from case_metadata', () => {
    const result = db.cases.queryCases({ limit: 50 })
    const alpha = result.data.find(c => c.name === 'Alpha')
    expect(alpha?.affected_status).toBe('affected')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run rebuild:node && npx vitest run tests/main/database/case-query.test.ts -v`
Expected: FAIL — `queryCases` not defined

- [ ] **Step 5: Implement `queryCases()` in CaseRepository**

Add to `src/main/database/CaseRepository.ts`:

```typescript
import type { CaseWithCohorts, CaseSearchParams } from './types'

// Whitelist of allowed sort columns (prevents SQL injection)
const CASE_SORTABLE_COLUMNS: Record<string, string> = {
  name: 'c.name',
  created_at: 'c.created_at',
  variant_count: 'c.variant_count'
}

queryCases(params: CaseSearchParams): { data: CaseWithCohorts[]; total_count: number } {
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0
  const sortCol = CASE_SORTABLE_COLUMNS[params.sort_by ?? 'created_at'] ?? 'c.created_at'
  const sortOrder = params.sort_order === 'asc' ? 'ASC' : 'DESC'

  // Build WHERE conditions
  const conditions: string[] = []
  const queryParams: (string | number)[] = []

  if (params.search_term) {
    conditions.push('c.name LIKE ?')
    queryParams.push(`%${params.search_term}%`)
  }

  if (params.cohort_ids && params.cohort_ids.length > 0) {
    const placeholders = params.cohort_ids.map(() => '?').join(', ')
    conditions.push(`ccl.cohort_id IN (${placeholders})`)
    queryParams.push(...params.cohort_ids)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Count query (optional)
  let totalCount = 0
  if (params._count_needed !== false) {
    const countSql = `
      SELECT COUNT(DISTINCT c.id) AS count
      FROM cases c
      LEFT JOIN case_cohort_links ccl ON ccl.case_id = c.id
      ${whereClause}
    `
    const countResult = this.db.prepare(countSql).get(...queryParams) as { count: number }
    totalCount = countResult.count
  }

  // Data query with JOINs
  // NOTE: case_metadata is 1:1 with cases — no Cartesian product risk with GROUP_CONCAT
  const dataSql = `
    SELECT c.*,
           cm.affected_status, cm.sex,
           GROUP_CONCAT(cg.name, '|') AS cohort_names_raw,
           GROUP_CONCAT(cg.id, '|') AS cohort_ids_raw
    FROM cases c
    LEFT JOIN case_metadata cm ON cm.case_id = c.id
    LEFT JOIN case_cohort_links ccl ON ccl.case_id = c.id
    LEFT JOIN cohort_groups cg ON cg.id = ccl.cohort_id
    ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `
  const rows = this.db.prepare(dataSql).all(...queryParams, limit, offset) as Array<
    Record<string, unknown>
  >

  // Post-process: split GROUP_CONCAT into arrays
  const data: CaseWithCohorts[] = rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    file_path: row.file_path as string,
    file_size: row.file_size as number,
    variant_count: row.variant_count as number,
    created_at: row.created_at as number,
    affected_status: (row.affected_status as string) ?? null,
    sex: (row.sex as string) ?? null,
    cohort_names: row.cohort_names_raw ? (row.cohort_names_raw as string).split('|') : [],
    cohort_ids: row.cohort_ids_raw
      ? (row.cohort_ids_raw as string).split('|').map(Number)
      : []
  }))

  return { data, total_count: totalCount }
}
```

- [ ] **Step 6: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/database/case-query.test.ts -v`
Expected: All tests pass.

- [ ] **Step 7: Run full test suite**

Run: `npm run rebuild:node && npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/database/CaseRepository.ts src/main/database/types.ts src/shared/types/ipc-schemas.ts tests/main/database/case-query.test.ts
git commit -m "feat: add CaseRepository.queryCases with server-side pagination

Single JOIN query replaces N+1 metadata pattern. Supports search,
multi-cohort filter, sort, offset pagination, and count skip.
Includes affected_status/sex from case_metadata (1:1 JOIN)."
```

---

### Task 2: cases:query IPC Handler + DbTaskType + db-worker + database:overview

**Files:**
- Modify: `src/shared/types/db-task.ts` (add `cases:query`, `database:overview`)
- Modify: `src/shared/types/api.ts` (update `CasesAPI`)
- Modify: `src/preload/index.ts` (add `cases.query()`)
- Modify: `src/main/ipc/handlers/cases.ts` (add `cases:query` handler)
- Modify: `src/main/ipc/handlers/database.ts` (migrate `database:overview` to pool)
- Modify: `src/main/workers/db-worker.ts` (add task types)
- Modify: `src/renderer/src/mocks/mockApi.ts` (add mock for `cases.query`)
- Create or modify: `tests/main/handlers/cases-handlers.test.ts`

- [ ] **Step 1: Add task types to DbTaskType**

In `src/shared/types/db-task.ts`, add to the union:

```typescript
  // Cases
  | 'cases:list'
  | 'cases:query'       // NEW
  // Database
  | 'database:overview'  // NEW
```

- [ ] **Step 2: Update CasesAPI type**

In `src/shared/types/api.ts`, add `query` method to `CasesAPI`:

```typescript
export interface CasesAPI {
  list: () => Promise<Case[]>
  query: (params: CaseSearchParams) => Promise<{ data: CaseWithCohorts[]; total_count: number }>
  delete: (id: number) => Promise<void>
  deleteAll: () => Promise<number>
  deleteBatch: (ids: number[]) => Promise<number>
}
```

Import `CaseWithCohorts` and `CaseSearchParams` from the database types.

- [ ] **Step 3: Add preload bridge**

In `src/preload/index.ts`, add to the `cases` section:

```typescript
query: (params: CaseSearchParams) =>
  ipcRenderer.invoke('cases:query', params),
```

- [ ] **Step 4: Add mock API**

In `src/renderer/src/mocks/mockApi.ts`, add to the `cases` section:

```typescript
query: async (params) => {
  const filtered = cases.filter(c =>
    !params.search_term || c.name.toLowerCase().includes(params.search_term.toLowerCase())
  )
  const start = params.offset ?? 0
  const end = start + (params.limit ?? 50)
  return {
    data: filtered.slice(start, end).map(c => ({
      ...c,
      cohort_names: [],
      cohort_ids: [],
      affected_status: null,
      sex: null
    })),
    total_count: filtered.length
  }
},
```

- [ ] **Step 5: Add cases:query IPC handler**

In `src/main/ipc/handlers/cases.ts`, add after the existing `cases:list` handler:

```typescript
ipcMain.handle('cases:query', async (_event, params: unknown) => {
  return wrapHandler(async () => {
    const validated = CaseSearchParamsSchema.safeParse(params)
    if (!validated.success) {
      mainLogger.error(`Invalid cases:query params: ${validated.error.message}`, 'cases')
      throw new Error('Invalid parameters')
    }

    const pool = getDbPool?.()
    if (pool) {
      return await pool.run({ type: 'cases:query', params: [validated.data] })
    }

    const db = getDb()
    return db.cases.queryCases(validated.data)
  })
})
```

- [ ] **Step 6: Migrate database:overview to pool**

In `src/main/ipc/handlers/database.ts`, modify the `database:overview` handler:

```typescript
ipcMain.handle('database:overview', async () => {
  return wrapHandler(async () => {
    const pool = getDbPool?.()
    if (pool) {
      return await pool.run({ type: 'database:overview', params: [] })
    }

    const db = getDb()
    const overview = db.overview.getDatabaseOverview()
    return JSON.parse(
      JSON.stringify(overview, (_key, value) =>
        typeof value === 'bigint' ? Number(value) : value
      )
    )
  })
})
```

- [ ] **Step 7: Add task types to db-worker.ts**

In `src/main/workers/db-worker.ts`, add to the switch statement:

```typescript
case 'cases:query':
  return repos.cases.queryCases(
    params[0] as Parameters<typeof repos.cases.queryCases>[0]
  )

case 'database:overview': {
  const overview = repos.overview.getDatabaseOverview()
  // BigInt → Number conversion in worker (before structured clone transfer)
  return JSON.parse(
    JSON.stringify(overview, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value
    )
  )
}
```

- [ ] **Step 8: Write handler tests**

In `tests/main/handlers/cases-handlers.test.ts` (create if not exists), add:

```typescript
describe('cases:query handler', () => {
  it('returns paginated cases with valid params', async () => {
    // Insert test data, call handler with { limit: 2, offset: 0 }
    // Assert: data.length <= 2, total_count > 0
  })

  it('rejects invalid params', async () => {
    // Call with { limit: -1 }
    // Assert: throws error
  })

  it('search filter works', async () => {
    // Call with { limit: 50, search_term: 'TestCase' }
    // Assert: all returned cases match search
  })
})
```

- [ ] **Step 9: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/handlers/ -v`
Expected: All tests pass.

- [ ] **Step 10: Run full test suite + lint + typecheck**

Run: `npm run rebuild:node && npx vitest run && npx eslint src/ && npx vue-tsc --noEmit -p tsconfig.renderer.json && tsc --noEmit -p tsconfig.node.json`
Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types/db-task.ts src/shared/types/api.ts src/preload/index.ts \
  src/main/ipc/handlers/cases.ts src/main/ipc/handlers/database.ts \
  src/main/workers/db-worker.ts src/renderer/src/mocks/mockApi.ts \
  tests/main/handlers/cases-handlers.test.ts
git commit -m "feat: add cases:query IPC handler + migrate database:overview to pool

Server-side paginated case query endpoint with Zod validation,
DbPool support, and fallback. database:overview runs off main
thread with BigInt conversion in worker."
```

---

### Task 3: CaseList.vue Rewrite with Infinite Scroll (after Wave 1)

**Files:**
- Modify: `src/renderer/src/components/CaseList.vue`

- [ ] **Step 1: Read the current CaseList.vue fully**

Understand the template, the `loadCases()` method, `filteredCases` computed, `handleCaseClick`, multi-select logic, context menu, and how metadata is used. Note what must be preserved (selection, context menu, multi-select, cohort chips, status icons).

- [ ] **Step 2: Replace data loading with infinite scroll**

Replace `loadCases()` (lines 211-230) and `filteredCases` computed with:

1. Reactive state: `cases = shallowRef<CaseWithCohorts[]>([])`, `currentOffset = ref(0)`, `searchKey = ref(0)`, `hasMore = ref(true)`, `searchTerm = ref('')`, `selectedCohortIds = ref<number[]>([])`

2. `onLoad({ done })` handler:
   ```typescript
   const onLoad = async ({ done }: { done: (status: 'ok' | 'empty' | 'error') => void }) => {
     try {
       const result = await api.cases.query({
         limit: 50,
         offset: currentOffset.value,
         search_term: searchTerm.value || undefined,
         cohort_ids: selectedCohortIds.value.length > 0 ? [...selectedCohortIds.value] : undefined,
         _count_needed: currentOffset.value === 0  // only count on first page
       })
       cases.value = markRaw([...cases.value, ...result.data])
       currentOffset.value += result.data.length
       if (currentOffset.value === 0 && result.total_count > 0) {
         totalCaseCount.value = result.total_count
       }
       done(result.data.length < 50 ? 'empty' : 'ok')
     } catch {
       done('error')
     }
   }
   ```

3. Search/filter reset:
   ```typescript
   const { debouncedFn: resetSearch } = useDebounce(() => {
     cases.value = markRaw([])
     currentOffset.value = 0
     searchKey.value++
   }, 300)
   watch(searchTerm, resetSearch)
   watch(selectedCohortIds, resetSearch, { deep: true })
   ```

- [ ] **Step 3: Replace template**

Replace `v-list v-for="filteredCases"` with `v-infinite-scroll`:

```vue
<v-infinite-scroll
  :key="searchKey"
  @load="onLoad"
  :empty-text="cases.length === 0 ? 'No cases found' : 'All cases loaded'"
>
  <v-list v-model:selected="selected" density="compact" select-strategy="single-leaf">
    <v-list-item
      v-for="caseItem in cases"
      :key="caseItem.id"
      :value="caseItem.id"
      ...existing template preserving cohort chips, status icons, context menu...
    >
      <!-- Cohort chips from inline data (no extra query) -->
      <template #append>
        <div class="d-flex ga-1">
          <v-chip
            v-for="cohort in caseItem.cohort_names.slice(0, 3)"
            :key="cohort"
            size="x-small" label
          >{{ cohort }}</v-chip>
          <v-chip v-if="caseItem.cohort_names.length > 3" size="x-small" color="grey" label>
            +{{ caseItem.cohort_names.length - 3 }}
          </v-chip>
        </div>
      </template>
    </v-list-item>
  </v-list>
</v-infinite-scroll>
```

- [ ] **Step 4: Remove bulk metadata loading**

Delete:
- `await Promise.all(cases.value.map((c) => loadMetadata(c.id)))` (line 226)
- `availableHpoTerms` computed (lines 232-253)
- `availablePlatforms` computed
- Any filter logic that depends on per-case metadata
- `getCaseCohorts(caseItem.id)` calls (use `caseItem.cohort_names` directly)
- `getCaseStatusValue(caseItem.id)` / `getCaseSexValue(caseItem.id)` (use `caseItem.affected_status` / `caseItem.sex` directly)

- [ ] **Step 5: Add mutation refresh**

Listen for events that should refresh the list:

```typescript
// After import, delete, cohort change — reset the infinite scroll
const refreshCaseList = () => {
  cases.value = markRaw([])
  currentOffset.value = 0
  searchKey.value++
}

// Expose for parent to call after import/delete
defineExpose({ refreshCaseList })
```

- [ ] **Step 6: Write CaseList tests**

Create or update `tests/renderer/components/CaseList.test.ts` with:

```typescript
describe('CaseList infinite scroll', () => {
  it('calls cases.query on load', () => {
    // Mock api.cases.query, mount component
    // Verify query called with { limit: 50, offset: 0, _count_needed: true }
  })

  it('appends items on subsequent loads', () => {
    // Trigger second load, verify items array grows
  })

  it('debounces search and resets scroll', async () => {
    // Set searchTerm, wait 300ms, verify cases cleared and searchKey incremented
  })

  it('resets on mutation events (delete, import)', () => {
    // Call refreshCaseList(), verify cases cleared
  })
})
```

- [ ] **Step 7: Run lint + typecheck + tests**

Run: `npx eslint src/renderer/ && npx vue-tsc --noEmit -p tsconfig.renderer.json && npx vitest run`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/CaseList.vue tests/renderer/components/CaseList.test.ts
git commit -m "perf: rewrite CaseList with v-infinite-scroll + server-side pagination

Replace bulk loading (10,500 queries for 1500 cases) with
paginated cases:query endpoint. Infinite scroll loads 50 cases
at a time. Search and cohort filter are server-side.
Cohort chips, status/sex icons from inline JOIN data."
```

---

### Task 4: Eliminate Duplicate getFilterOptions + Cache + markRaw (parallel with Task 3)

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`
- Modify: `src/renderer/src/composables/useFilterState.ts`
- Modify: `src/renderer/src/composables/useCohortData.ts`
- Modify: `tests/renderer/composables/useOffsetPagination.test.ts` (if needed)

- [ ] **Step 1: Read the duplicate call sites**

Read `useVariantData.ts` lines 106-131 and `useFilterState.ts` lines 455-482 to understand both `getFilterOptions` call sites.

- [ ] **Step 2: Remove duplicate from useVariantData**

In `useVariantData.ts`, remove lines 121-127 (the `getFilterOptions` call and `columnMeta` assignment). Instead, accept `columnMeta` as a parameter or read it from the filter state that's passed in.

Check how `useVariantData` receives its dependencies — if it takes `filters` as a ref, it can also take `columnMeta` as a ref from the caller.

- [ ] **Step 3: Add filter options cache to useFilterState**

In `useFilterState.ts`, add caching:

```typescript
const FILTER_OPTIONS_CACHE_MAX = 20
const filterOptionsCache = new Map<number, FilterOptions>()

const loadFilterOptions = async (caseId: number): Promise<void> => {
  if (!api) return

  // Check cache first
  const cached = filterOptionsCache.get(caseId)
  if (cached) {
    filterOptions.value = cached
    return
  }

  try {
    const options = await (api as any).variants.getFilterOptions(caseId)
    filterOptions.value = options
    // Store in cache (LRU eviction)
    filterOptionsCache.set(caseId, options)
    while (filterOptionsCache.size > FILTER_OPTIONS_CACHE_MAX) {
      const oldestKey = filterOptionsCache.keys().next().value
      if (oldestKey === undefined) break
      filterOptionsCache.delete(oldestKey)
    }
  } catch (error) {
    console.error('Failed to load filter options:', error)
  }
}

// Expose cache invalidation
const invalidateFilterOptionsCache = (): void => {
  filterOptionsCache.clear()
}
```

- [ ] **Step 4: Apply markRaw to IPC results**

In `useVariantData.ts`, where items are assigned from IPC results:
```typescript
import { markRaw } from 'vue'
// After fetching variants:
items.value = markRaw(result.data ?? result.items)
```

In `useCohortData.ts`, where cohort variants are assigned:
```typescript
variants.value = markRaw(result.data)
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/renderer/ -v`
Expected: All tests pass.

- [ ] **Step 6: Run full test suite + typecheck**

Run: `npx vitest run && npx vue-tsc --noEmit -p tsconfig.renderer.json`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/variant-table/useVariantData.ts \
  src/renderer/src/composables/useFilterState.ts \
  src/renderer/src/composables/useCohortData.ts
git commit -m "perf: eliminate duplicate getFilterOptions, add cache, apply markRaw

Single owner (useFilterState) for filter options. LRU cache (max 20)
avoids re-query on case revisit. markRaw prevents deep Vue proxies
on IPC result arrays."
```

---

## Phase 2: UX Polish & Settings

### Task 5: Settings Store + ApplicationPreferences Dialog (parallel with Task 6)

**Files:**
- Modify: `src/renderer/src/stores/settingsStore.ts`
- Create: `src/renderer/src/components/ApplicationPreferences.vue`
- Modify: `src/renderer/src/components/AppToolbar.vue`
- Modify: `src/renderer/src/components/AppDialogHost.vue` (add dialog)
- Create: `tests/renderer/stores/settingsStore.test.ts`

- [ ] **Step 1: Extend settingsStore**

In `src/renderer/src/stores/settingsStore.ts`, add new settings:

```typescript
interface PersistedSettings {
  itemsPerPage: number
  userName: string
  workerThreads: number    // 0 = auto
  prefetchEnabled: boolean
}

const DEFAULTS: PersistedSettings = {
  itemsPerPage: 25,
  userName: '',
  workerThreads: 0,
  prefetchEnabled: true
}
```

Add refs for new settings and include them in the watch/save logic.

- [ ] **Step 2: Write settings tests**

Create `tests/renderer/stores/settingsStore.test.ts`:

```typescript
describe('settingsStore', () => {
  it('persists workerThreads to localStorage', () => {
    const store = useSettingsStore()
    store.workerThreads = 2
    // Verify localStorage contains workerThreads: 2
  })

  it('defaults to workerThreads=0 (auto)', () => {
    localStorage.clear()
    const store = useSettingsStore()
    expect(store.workerThreads).toBe(0)
  })

  it('persists prefetchEnabled', () => {
    const store = useSettingsStore()
    store.prefetchEnabled = false
    // Verify localStorage contains prefetchEnabled: false
  })
})
```

- [ ] **Step 3: Create ApplicationPreferences.vue**

Follow the `ExternalLinksSettings.vue` dialog pattern. Include:
- `v-text-field` for display name
- `v-select` for items per page
- `v-slider` for worker threads (1 to cpuCount, 0=Auto)
- `v-switch` for pre-fetch
- Info text for worker threads: "Takes effect on next database open"

- [ ] **Step 4: Add menu item to AppToolbar**

In `src/renderer/src/components/AppToolbar.vue`, add before the Reset Preferences section:

```vue
<v-list-item
  prepend-icon="mdi-tune"
  title="Application Preferences"
  @click="$emit('show-preferences')"
/>
```

- [ ] **Step 5: Wire dialog in AppDialogHost.vue**

Add the dialog component and the event handler in `src/renderer/src/components/AppDialogHost.vue`, following the existing pattern for `ExternalLinksSettings`.

- [ ] **Step 6: Run lint + typecheck + tests**

Run: `npx eslint src/ && npx vue-tsc --noEmit -p tsconfig.renderer.json && npx vitest run`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/settingsStore.ts \
  src/renderer/src/components/ApplicationPreferences.vue \
  src/renderer/src/components/AppToolbar.vue \
  src/renderer/src/components/AppDialogHost.vue \
  tests/renderer/stores/settingsStore.test.ts
git commit -m "feat: add Application Preferences dialog

Worker threads slider, pre-fetch toggle, items per page,
display name. Persisted to localStorage via settingsStore."
```

---

### Task 6: Dynamic maxThreads + system:getCpuCount IPC (parallel with Task 5)

**Files:**
- Modify: `src/main/ipc/handlers/system.ts`
- Modify: `src/main/database/DbPool.ts`
- Modify: `src/main/ipc/dbPoolManager.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types/api.ts`

- [ ] **Step 1: Add system:getCpuCount handler**

In `src/main/ipc/handlers/system.ts`, add:

```typescript
ipcMain.handle('system:getCpuCount', () => {
  return os.cpus().length
})
```

- [ ] **Step 2: Add preload bridge**

In `src/preload/index.ts` system section:

```typescript
getCpuCount: () => ipcRenderer.invoke('system:getCpuCount'),
```

- [ ] **Step 3: Update DbPool to accept dynamic maxThreads**

In `src/main/database/DbPool.ts`, modify `init()`:

```typescript
init(
  dbPath: string,
  encryptionKey?: string,
  options?: { workerPath?: string; execArgv?: string[]; maxThreads?: number }
): void {
  // ...
  const maxThreads = options?.maxThreads ?? Math.max(1, os.cpus().length - 1)
  this.pool = new Piscina({
    // ...
    maxThreads,
    // ...
  })
}
```

- [ ] **Step 4: Wire settings to pool initialization**

In `src/main/ipc/dbPoolManager.ts`, read worker threads preference when initializing pool. Accept it as a parameter or read from a shared config.

- [ ] **Step 5: Run tests**

Run: `npm run rebuild:node && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/handlers/system.ts src/main/database/DbPool.ts \
  src/main/ipc/dbPoolManager.ts src/preload/index.ts src/shared/types/api.ts
git commit -m "feat: dynamic worker pool maxThreads + system:getCpuCount IPC

Pool size adapts to hardware. Default: cpus - 1. Configurable
via Application Preferences (takes effect on next database open)."
```

---

### Task 7: Predictive Pre-fetch in useOffsetPagination

**Files:**
- Modify: `src/renderer/src/composables/useOffsetPagination.ts`
- Modify: `tests/renderer/composables/useOffsetPagination.test.ts`

- [ ] **Step 1: Write pre-fetch tests**

Add to `tests/renderer/composables/useOffsetPagination.test.ts`:

```typescript
describe('predictive pre-fetch', () => {
  it('pre-fetches page N+1 after loading page N', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [{ id: 1 }], total_count: 100 })
    const { loadPage } = useOffsetPagination({ fetchPage })
    await loadPage()
    // fetchPage should be called twice: current page + pre-fetch
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('serves pre-fetched data from cache', async () => {
    // Navigate to next page, verify fetchPage NOT called again
  })

  it('invalidates cache on filter change', async () => {
    // Change filters, verify pre-fetch cache cleared
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/composables/useOffsetPagination.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Implement pre-fetch**

In `useOffsetPagination.ts`, add:

```typescript
import { useSettingsStore } from '../stores/settingsStore'

const settingsStore = useSettingsStore()
const prefetchCache = new Map<string, Promise<OffsetPageResult<T>>>()

function buildCacheKey(offset: number): string {
  const sortKey = JSON.stringify(sortBy.value)
  return `${offset}:${sortKey}`
}

// After successful page load, pre-fetch next page
const prefetchNextPage = (): void => {
  if (!settingsStore.prefetchEnabled) return
  const nextOffset = (page.value) * itemsPerPage.value
  if (nextOffset >= totalCount.value) return

  const key = buildCacheKey(nextOffset)
  if (prefetchCache.has(key)) return

  prefetchCache.set(
    key,
    options.fetchPage({
      offset: nextOffset,
      limit: itemsPerPage.value,
      sortBy: normalizeSortBy(sortBy.value),
      skipCount: true
    })
  )
}

// Clear cache on filter/sort change
watch([filterKey, sortBy], () => {
  prefetchCache.clear()
})
```

Modify `loadPage` to check cache before fetching.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/composables/useOffsetPagination.test.ts -v`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useOffsetPagination.ts \
  tests/renderer/composables/useOffsetPagination.test.ts
git commit -m "perf: predictive page N+1 pre-fetch in useOffsetPagination

Background fetch of next page after each load. Cache keyed by
offset+sort. Invalidated on filter/sort change. Controlled by
prefetchEnabled setting."
```

---

### Task 8: AssociationDataBuilder to db-worker (Deferred P2)

**Files:**
- Modify: `src/main/workers/db-worker.ts`
- Modify: `src/shared/types/db-task.ts`
- Modify: `src/main/statistics/AssociationEngine.ts`
- Modify: `src/main/ipc/handlers/cohort.ts`
- Modify: `tests/main/statistics/integration.test.ts`

- [ ] **Step 1: Add task type**

In `src/shared/types/db-task.ts`, add `'association:build'` to `DbTaskType`.

- [ ] **Step 2: Add to db-worker switch**

In `src/main/workers/db-worker.ts`:

```typescript
case 'association:build': {
  const builder = new AssociationDataBuilder(db)
  return builder.build(
    params[0] as number[],   // groupA_ids
    params[1] as number[],   // groupB_ids
    params[2] as VariantFilters,
    params[3] as string[]    // covariates
  )
}
```

Import `AssociationDataBuilder` and required types.

- [ ] **Step 3: Modify AssociationEngine to accept DbPool**

```typescript
constructor(
  db: Database.Database,
  onProgress?: (completed: number, total: number) => void,
  private dbPool?: DbPool
)

async run(config: AssociationConfig): Promise<AssociationResults> {
  let genes: GeneContingencyData[]
  if (this.dbPool) {
    genes = await this.dbPool.run({
      type: 'association:build',
      params: [config.groupA_ids, config.groupB_ids, config.filters, config.covariates]
    })
  } else {
    const builder = new AssociationDataBuilder(this.db)
    genes = builder.build(config.groupA_ids, config.groupB_ids, config.filters, config.covariates)
  }
  // ... rest unchanged
}
```

- [ ] **Step 4: Pass DbPool from cohort handler**

In `src/main/ipc/handlers/cohort.ts`, pass pool to AssociationEngine constructor.

- [ ] **Step 5: Run tests**

Run: `npm run rebuild:node && npx vitest run tests/main/statistics/ -v`
Expected: All pass.

- [ ] **Step 6: Run full test suite**

Run: `npm run rebuild:node && npx vitest run`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/workers/db-worker.ts src/shared/types/db-task.ts \
  src/main/statistics/AssociationEngine.ts src/main/ipc/handlers/cohort.ts \
  tests/main/statistics/integration.test.ts
git commit -m "perf: offload AssociationDataBuilder.build() to db-worker

Data preparation (SQL query + JS grouping) now runs off main
thread via Piscina. Fallback to direct call when pool unavailable."
```

---

## Final Validation

- [ ] **Run full CI pipeline**

Run: `make ci`
Expected: lint + typecheck + all tests pass.

- [ ] **Build and verify**

Run: `npx electron-vite build`
Expected: Electron app builds successfully. `out/main/db-worker.js` updated.

- [ ] **E2E smoke test**

Run: `npx playwright test tests/e2e/full-workflow.e2e.ts`
Expected: 10+ tests pass. Case selection, variant table, cohort view functional.
