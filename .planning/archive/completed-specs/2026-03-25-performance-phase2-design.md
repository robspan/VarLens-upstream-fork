# Performance Optimization Phase 2 — Design Spec

## Context

VarLens v0.32.0 shipped a Piscina worker pool for read queries, query consolidation, and renderer optimizations. Two critical bottlenecks remain:

1. **Case sidebar** loads 10,500 queries (1500 cases × 7 `getFullMetadata` queries each) and renders 1500 DOM elements. Clicking a case freezes the UI for ~6 seconds because the worker pool is saturated with queued metadata tasks.
2. **Case switching** runs duplicate `getFilterOptions` queries (both `useVariantData` and `useFilterState` call it), with no caching — revisiting a case re-queries.

Additionally, remaining items from the performance report need implementation: `AssociationDataBuilder` offloading, `database:overview` migration, predictive pre-fetch, `markRaw`, dynamic `maxThreads`, and a user-facing preferences UI.

### Dataset Scale
- Current: 1500 cases, 19M variants
- Target: 10,000+ cases, must scale with constant-time sidebar rendering

---

## Section 1: Server-Side Paginated Case List with Infinite Scroll

### 1.1 New IPC endpoint: `cases:query`

Follows the established pattern from `cohort:variants`:

```typescript
// CaseSearchParams — mirrors CohortSearchParams pattern
interface CaseSearchParams {
  limit: number           // page size, default 50
  offset?: number         // default 0
  sort_by?: string        // column name: 'name' | 'created_at' | 'variant_count'
  sort_order?: 'asc' | 'desc'
  search_term?: string    // LIKE match on case name
  cohort_ids?: number[]   // filter by cohort assignment (multi-select)
  _count_needed?: boolean    // false = skip COUNT(*) (matches cohort:variants convention)
}

// Returns same shape as cohort:variants
interface CaseQueryResult {
  data: CaseWithCohorts[]
  total_count: number
}

// Case data includes inline cohort names + metadata (no extra queries)
interface CaseWithCohorts extends Case {
  cohort_names: string[]     // from GROUP_CONCAT JOIN
  cohort_ids: number[]
  affected_status?: string   // from case_metadata LEFT JOIN (1:1)
  sex?: string               // from case_metadata LEFT JOIN (1:1)
}
```

### 1.2 Database query: `CaseRepository.queryCases()`

Single SQL query with LEFT JOINs — replaces the N+1 metadata pattern:

```sql
-- NOTE: case_metadata is 1:1 with cases, so no Cartesian product risk with GROUP_CONCAT
SELECT c.*,
       cm.affected_status, cm.sex,
       GROUP_CONCAT(cg.name, '|') AS cohort_names_raw,
       GROUP_CONCAT(cg.id, '|') AS cohort_ids_raw
FROM cases c
LEFT JOIN case_metadata cm ON cm.case_id = c.id
LEFT JOIN case_cohort_links ccl ON ccl.case_id = c.id
LEFT JOIN cohort_groups cg ON cg.id = ccl.cohort_id
WHERE c.name LIKE ?                        -- search_term filter
  AND (ccl.cohort_id IN (?, ?, ...) OR ?)  -- cohort_ids filter (multi-select, skipped when empty)
GROUP BY c.id
ORDER BY c.created_at DESC                 -- sort_by / sort_order
LIMIT ? OFFSET ?
```

Post-processing: split `cohort_names_raw` by `|` into arrays: `raw?.split('|') ?? []`

Count query (when `_count_needed !== true`):
```sql
SELECT COUNT(DISTINCT c.id) AS count
FROM cases c
LEFT JOIN case_cohort_links ccl ON ccl.case_id = c.id
WHERE ...same conditions...
```

Post-processing: split `cohort_names_raw` by `|` into arrays.

### 1.3 IPC handler + validation

- Zod schema `CaseSearchParamsSchema` — reuse `OffsetSchema`, `LimitSchema` patterns from `ipc-schemas.ts`
- Whitelist sortable columns: `name`, `created_at`, `variant_count`
- DbPool support: add `cases:query` to `DbTaskType` union and `db-worker.ts` switch
- Fallback to direct database when pool unavailable (test mode)

### 1.4 CaseList.vue rewrite

Replace `v-list` + `v-for="filteredCases"` with `v-infinite-scroll`:

```vue
<v-infinite-scroll
  :key="searchKey"
  @load="onLoad"
  :empty-text="'All cases loaded'"
  height="100%"
>
  <v-list density="compact">
    <v-list-item
      v-for="caseItem in cases"
      :key="caseItem.id"
      ...existing template...
    />
  </v-list>
</v-infinite-scroll>
```

- `onLoad({ done })` — fetches next 50 cases via `cases:query`, appends to array, calls `done('ok')` or `done('empty')`
- Search bar change: debounce input by 300ms, then clear array + increment `searchKey` (remounts `v-infinite-scroll`), server-side `LIKE` filter. Debouncing the `searchKey` increment prevents rapid remount flicker during typing.
- Cohort filter: same debounced reset pattern
- Cohort chips per case: from inline `cohort_names` array (no extra query)
- Remove `Promise.all(cases.map(c => loadMetadata(c.id)))` entirely
- HPO terms / comments / metrics for sidebar filtering: **removed** from sidebar. These are per-case metadata only needed in the metadata modal (already lazy-loaded there)

### 1.5 Metadata loading strategy

- **On sidebar render:** Only case name, variant_count, created_at, cohort chips (from JOIN)
- **On metadata modal open:** Full `getFullMetadata(caseId)` for the single selected case (existing behavior)
- **Case status/sex icons:** Included via `case_metadata` LEFT JOIN in the `cases:query` SQL (1:1 relationship, no Cartesian product risk).

### 1.6 Mutation refresh behavior

After case mutations (delete, rename, cohort assignment change, import), the case list must refresh:
- **Strategy:** Clear the items array, increment `searchKey` to trigger fresh first-page load from server
- **Delete:** Already emits events — listen and reset
- **Import complete:** Listen for `import:complete` event and reset
- **Cohort assignment:** Listen for metadata invalidation and reset
- This is simple and correct — no need for surgical local array updates

### 1.7 What gets removed

- `CaseList.vue:226` — `Promise.all(cases.map(c => loadMetadata(c.id)))` — the 10,500-query line
- `CaseList.vue:232-253` — `availableHpoTerms` and `availablePlatforms` computed (used for filter autocomplete, but loading all metadata for 10k cases isn't viable)
- Client-side filtering of cases — replaced by server-side `WHERE` clauses

---

## Section 2: Case Switch Performance

### 2.1 Eliminate duplicate `getFilterOptions` call

Currently both fire on case switch:
- `useVariantData.ts:123` — `api.variants.getFilterOptions(newCaseId)`
- `useFilterState.ts:480` — `loadFilterOptions(newCaseId)`

**Fix:** Remove the call from `useVariantData.ts`. The `columnMeta` ref in `useVariantData` should be populated from `useFilterState`'s `filterOptions.columnMeta` via an injected ref or callback, instead of making its own IPC call. `useFilterState` is the single owner of filter options. This requires `useVariantData` to accept `filterOptions` as a parameter rather than fetching its own copy.

### 2.2 Cache filter options per case

Add to `useFilterState`:
```typescript
const filterOptionsCache = new Map<number, FilterOptions>()
```

On case switch:
1. Check cache: `filterOptionsCache.get(caseId)`
2. If hit: use immediately, skip IPC call
3. If miss: fetch via IPC, store in cache
4. Invalidate on import/delete events (clear entire cache)
5. Cap at 20 entries (LRU) to bound memory

### 2.3 Apply `markRaw()` to IPC result arrays

In `useVariantData.ts`, `useCohortData.ts`, and the new case list fetcher:
```typescript
items.value = markRaw(result.data)
```

Prevents Vue from accidentally wrapping IPC data in reactive proxies when accessed through computed properties.

---

## Section 3: Worker Pool Completions

### 3.1 AssociationDataBuilder to db-worker (P2)

**Note:** Downgraded from P0. The `build()` call is a single synchronous SQLite query burst that typically completes in under 1 second. The sidebar fix (Section 1) and duplicate elimination (Section 2) deliver far more user-visible impact. The main bottleneck in association analysis is the statistical computation, which is already parallelized via `WorkerPool`.

Add `association:build` task type to `db-worker.ts`:

```typescript
case 'association:build':
  return new AssociationDataBuilder(db).build(
    params[0],  // groupA_ids
    params[1],  // groupB_ids
    params[2],  // filters
    params[3]   // covariates
  )
```

Modify `AssociationEngine.run()` to accept a `DbPool` reference:
- If pool available: `genes = await dbPool.run({ type: 'association:build', params: [...] })`
- Fallback: direct `new AssociationDataBuilder(this.db).build(...)` (for tests)

**Note:** `PRAGMA query_only=ON` in the worker is safe — `build()` only runs SELECTs.

### 3.2 database:overview to DbPool (P1)

Add `database:overview` task type to `db-worker.ts`. Move BigInt → Number conversion into the worker before returning results.

Update `database.ts` handler to use `pool.run()` with fallback.

### 3.3 Dynamic maxThreads (P3)

Replace `maxThreads: 4` in `DbPool.init()` with value from settings:
```typescript
const maxThreads = settingsValue ?? Math.max(1, os.cpus().length - 1)
```

Settings value passed from renderer via `system:setPreferences` IPC, stored in main process config.

---

## Section 4: Application Preferences UI

### 4.1 Settings store additions

Add to `settingsStore.ts`:
```typescript
interface PersistedSettings {
  itemsPerPage: number
  userName: string
  workerThreads: number    // NEW: 0 = auto (cpus - 1)
  prefetchEnabled: boolean // NEW: pre-fetch next page
}
```

### 4.2 ApplicationPreferences dialog

New component `ApplicationPreferences.vue` — a `v-dialog` triggered from the settings menu:

| Setting | Control | Default |
|---|---|---|
| Display name | `v-text-field` | '' (existing) |
| Items per page | `v-select` (10, 25, 50, 100) | 25 (existing) |
| Worker threads | `v-slider` (1 to CPU count) with "Auto" option | Auto |
| Pre-fetch pages | `v-switch` | ON |

- "Worker threads" change shows info text: "Takes effect on next database open"
- CPU count obtained via new `system:cpuCount` IPC handler (returns `os.cpus().length`)
- Follows existing dialog patterns (`ExternalLinksSettings.vue`)

### 4.3 IPC for preferences

- `system:getCpuCount` — returns `os.cpus().length` (for slider max)
- `system:getPreferences` / `system:setPreferences` — read/write preferences that the main process needs (workerThreads)
- Renderer-only settings (itemsPerPage, prefetchEnabled) stay in localStorage via settingsStore

### 4.4 Predictive page pre-fetch

Add to `useOffsetPagination`:
```typescript
if (settingsStore.prefetchEnabled) {
  const nextOffset = offset + limit
  if (nextOffset < totalCount.value) {
    prefetchCache.set(cacheKey(nextOffset), fetchPage({ offset: nextOffset, limit, sortBy, skipCount: true }))
  }
}
```

On page navigation, check `prefetchCache` first. Invalidate on filter/sort change.

**Cache key design:** Use `JSON.stringify({ caseId, filterKey, sortKey, offset })` as the cache key. Clear the entire `prefetchCache` Map whenever `filterKey` or `sortKey` changes. Limit to 3 cached pages.

---

## Section 5: Parallelization Map

Tasks within the same wave touch **different files** and can run in parallel worktrees.

```
Phase 1 - Wave 1 (2 parallel tasks):
  Task 1: CaseRepository.queryCases + CaseSearchParams schema     [database layer]
  Task 2: cases:query handler + DbTaskType + db-worker + overview  [IPC + worker layer]

  Tasks 1 and 2 can run in parallel (different files).
  db-worker.ts changes (cases:query + database:overview) in single task to avoid conflict.

Phase 1 - Wave 2 (2 parallel tasks, after Wave 1 merges):
  Task 3: CaseList.vue rewrite with v-infinite-scroll              [renderer — depends on Tasks 1+2 for API]
  Task 4: Eliminate duplicate getFilterOptions + cache + markRaw   [useVariantData + useFilterState + useCohortData]

  Tasks 3 and 4 can run in parallel (different files).

Phase 2 - Wave 3 (2 parallel tasks):
  Task 5: settingsStore additions + ApplicationPreferences.vue     [renderer]
  Task 6: Dynamic maxThreads + system:getCpuCount IPC             [main process]

Phase 2 - Wave 4:
  Task 7: Predictive pre-fetch in useOffsetPagination              [composable]

Phase 2 - Wave 5 (deferred, P2):
  Task 8: AssociationDataBuilder to db-worker                      [statistics — lower priority]
```

---

## Files Affected

### Phase 1 Wave 1 (parallel)
- **Task 1:** `src/main/database/CaseRepository.ts`, `src/shared/types/ipc-schemas.ts`, `tests/main/database/CaseRepository.test.ts`
- **Task 2:** `src/main/ipc/handlers/cases.ts`, `src/main/ipc/handlers/database.ts`, `src/shared/types/db-task.ts`, `src/shared/types/api.ts`, `src/preload/index.ts`, `src/main/workers/db-worker.ts`, `tests/main/handlers/cases-handlers.test.ts`

### Phase 1 Wave 2 (parallel, after Wave 1)
- **Task 3:** `src/renderer/src/components/CaseList.vue`, `src/renderer/src/mocks/mockApi.ts`, `tests/renderer/components/CaseList.test.ts`
- **Task 4:** `src/renderer/src/components/variant-table/useVariantData.ts`, `src/renderer/src/composables/useFilterState.ts`, `src/renderer/src/composables/useCohortData.ts`, `tests/renderer/composables/useFilterState.test.ts`

### Phase 2 Wave 3
- `src/renderer/src/stores/settingsStore.ts` — new settings fields
- `src/renderer/src/components/ApplicationPreferences.vue` — new dialog
- `src/renderer/src/components/AppToolbar.vue` — menu item for preferences
- `src/main/ipc/handlers/system.ts` — getCpuCount handler

### Phase 2 Wave 4
- `src/renderer/src/composables/useOffsetPagination.ts` — pre-fetch logic

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `v-infinite-scroll` height constraint | Set `height="100%"` within `v-navigation-drawer` which already constrains height |
| Sidebar filter autocomplete (HPO, platforms) removed | These are per-case metadata only needed in modal — acceptable trade-off for 10k scale |
| `GROUP_CONCAT` returns NULL for cases with no cohorts | Handle in post-processing: `raw?.split('\|') ?? []` |
| Filter options cache stale after import | Invalidate on `import:complete` event |
| `markRaw` preventing legitimate reactivity | Variant/cohort data is immutable (replaced wholesale) — safe |
| Worker threads slider confusing users | Show "Auto (recommended)" as default, explain in helper text |

---

## Test Requirements

Every task must include tests following existing patterns (Vitest, real SQLite `:memory:` for database tests, happy-dom for renderer tests).

### Database layer tests
- `tests/main/database/CaseRepository.test.ts` (new or extend existing):
  - `queryCases` returns paginated results with correct `total_count`
  - Search filter (`LIKE`) matches case names correctly
  - Multi-cohort filter returns only matching cases
  - Sort by name/created_at/variant_count works in both directions
  - `_count_needed` skips COUNT query (verify `total_count` is 0 when skipped)
  - GROUP_CONCAT returns correct cohort arrays, handles NULL (no cohorts)
  - case_metadata fields (affected_status, sex) included in results

### IPC handler tests
- `tests/main/handlers/cases-handlers.test.ts` (new or extend):
  - `cases:query` validates params via Zod schema (reject invalid)
  - `cases:query` returns paginated results matching direct repository call
  - DbPool fallback works when pool unavailable

### Renderer tests
- `tests/renderer/components/CaseList.test.ts` (new or extend):
  - Infinite scroll triggers `onLoad` and appends items
  - Search input debounces and resets scroll
  - Cohort filter resets scroll
  - Mutation events (delete, import) trigger refresh

### Composable tests
- `tests/renderer/composables/useFilterState.test.ts` (extend):
  - Filter options cache hit avoids IPC call
  - Cache miss triggers IPC call and stores result
  - Cache invalidated on import/delete events
  - Cache capped at 20 entries (LRU eviction)

- `tests/renderer/composables/useOffsetPagination.test.ts` (extend):
  - Pre-fetch fires for page N+1 after loading page N
  - Pre-fetched data served from cache on navigation
  - Cache invalidated on filter/sort change

### Settings tests
- `tests/renderer/stores/settingsStore.test.ts` (new):
  - New settings (workerThreads, prefetchEnabled) persist to localStorage
  - Defaults applied when no saved settings exist
