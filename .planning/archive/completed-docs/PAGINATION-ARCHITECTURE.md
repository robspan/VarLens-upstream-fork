# Pagination, Sorting & Filtering Architecture

> Full-stack data flow report for VarLens v0.21.0

## Overview

VarLens implements **cursor-based (keyset) pagination** across two views — Case/Variant and Cohort. Data flows through four layers: SQLite database → IPC handlers → preload bridge → Vue/Vuetify frontend.

---

## 1. Database Layer

### 1.1 Cursor-Based Pagination (Keyset)

Instead of `OFFSET n`, cursors encode the last row's position. This gives O(1) page seeks regardless of dataset size.

**Variant cursor** (`src/main/database/types.ts`):
```typescript
interface PaginationCursor {
  id: number                          // Primary key tiebreaker
  sort_value: number | string | null  // Last row's sort column value
  sort_key: string                    // Which column is sorted (validates reuse)
}
```

**Cohort cursor** (`src/shared/types/cohort.ts`):
```typescript
interface CohortPaginationCursor {
  sort_value: number | string | null
  sort_key: string
  variant_key: string  // "chr:pos:ref:alt" tiebreaker (no single id for aggregated rows)
}
```

**SQL generation** (`VariantRepository.ts:buildCursorCondition()`):
```sql
-- Ascending: skip everything up to and including cursor position
WHERE (column > ?) OR (column = ? AND id > ?) OR column IS NULL

-- Descending: mirror logic
WHERE (column < ?) OR (column = ? AND id > ?) OR column IS NULL
```

**Page detection**: Query fetches `LIMIT + 1` rows. If more than `LIMIT` returned, `has_more = true` and the extra row is discarded. The last kept row becomes the next cursor.

### 1.2 Sorting

**File**: `VariantRepository.ts:buildSortClause()` (lines 281–307)

- Validates sort key against `SORTABLE_COLUMNS` allowlist (prevents SQL injection)
- Appends `NULLS LAST` (ascending) or `NULLS FIRST` (descending)
- **Always appends `id ASC` as tiebreaker** for stable ordering
- Only the first sort item is used for cursor pagination (multi-sort not supported with cursors)

```sql
ORDER BY gnomad_af DESC NULLS FIRST, id ASC
```

### 1.3 Filtering

**File**: `VariantRepository.ts:buildFilterConditions()` (lines 158–277)

| Filter | SQL Pattern | Notes |
|--------|-------------|-------|
| `gene_symbol` | `LIKE '%value%'` | Partial match |
| `consequences` | `IN (?, ?, ...)` | Multi-select OR |
| `funcs`, `clinvars` | `IN (?, ?, ...)` | Multi-select OR |
| `gnomad_af_max` | `IS NULL OR <= ?` | NULL-inclusive (ANTI-10) |
| `cadd_min` | `IS NULL OR >= ?` | NULL-inclusive |
| `starred_only` | Subquery on annotations table | Per-case or global |
| `has_comment` | Subquery OR on both comment tables | Per-case + global |
| `acmg_classifications` | Subquery on annotations | `IN (...)` |
| `column_filters` | `CAST(col AS TEXT) LIKE ?` | Per-column text search |
| `search_query` | FTS5 or HGVS pattern | Auto-detected strategy |

**NULL-inclusive policy** (ANTI-10): Numeric filters include NULL values. Novel variants without gnomAD annotation match all frequency filters.

**Search strategy** (`buildSearchCondition()`):
- HGVS patterns (`^[cp]\.`) → `LIKE` on `cdna`/`aa_change` columns
- Everything else → FTS5 full-text search via `variants_fts` virtual table

### 1.4 Cohort: Two-CTE Aggregation

**File**: `src/main/database/cohort.ts` (lines 261–311)

Cohort queries aggregate variants across all cases using a two-stage CTE:

```sql
WITH deduped AS (
  -- Stage 1: Deduplicate per case (same variant in same case = 1 row)
  SELECT chr, pos, ref, alt, case_id, MAX(gene_symbol), ...
  FROM variants WHERE [filters]
  GROUP BY chr, pos, ref, alt, case_id
),
aggregated AS (
  -- Stage 2: Aggregate across cases
  SELECT chr, pos, ref, alt,
    COUNT(*) as carrier_count,
    COUNT(DISTINCT case_id) / total_cases as cohort_frequency,
    COUNT(*) OVER() as _total_count  -- Window function for total
  FROM deduped
  GROUP BY chr, pos, ref, alt
  HAVING [aggregate_filters]  -- carrier_count_min, cohort_frequency_min
)
SELECT * FROM aggregated
WHERE [cursor_condition]  -- Keyset pagination applied after aggregation
ORDER BY [sort] [direction], variant_key ASC
LIMIT [limit + 1]
```

Key differences from variant pagination:
- Tiebreaker is `variant_key` (composite string), not `id`
- `HAVING` clause for post-aggregation filters
- `COUNT(*) OVER()` computes total without separate query

---

## 2. IPC Layer

### 2.1 Handler Registration

**Variant handler** (`src/main/ipc/handlers/variants.ts`):
```
Channel: 'variants:query'
Params:  (caseId, filters, cursor?, limit?, sortBy[])
Validation: Zod schemas (PaginationCursorSchema, VariantFilterPartialSchema, SortItemSchema)
Returns: { data: Variant[], total_count, has_more, next_cursor }
```

**Cohort handler** (`src/main/ipc/handlers/cohort.ts`):
```
Channel: 'cohort:variants'
Params:  (params: CohortSearchParams)
Validation: CohortSearchParamsSchema (Zod)
Returns: { data: CohortVariant[], total_count, has_more, next_cursor }
```

### 2.2 Serialization Requirements

1. **better-sqlite3 results** → Explicit type coercion before IPC return:
   ```typescript
   { chr: String(v.chr), pos: Number(v.pos), gnomad_af: v.gnomad_af !== null ? Number(v.gnomad_af) : null }
   ```
2. **Vue reactive Proxies** → Deep-clone before sending over IPC:
   ```typescript
   const plainFilters = JSON.parse(JSON.stringify(filters.value))
   ```
   Electron's `contextBridge` uses structured clone which rejects Vue Proxy objects.

### 2.3 Preload Bridge

**File**: `src/preload/index.ts`

Typed API exposed to renderer via `contextBridge.exposeInMainWorld('api', api)`:
```typescript
api.variants.query(caseId, filters, cursor?, limit?, sortBy?)
api.cohort.getVariants(params)
api.cohort.getSummary()
api.cohort.getCarriers(chr, pos, ref, alt)
```

---

## 3. Frontend Layer

### 3.1 Case/Variant View

**Composable**: `src/renderer/src/components/variant-table/useVariantData.ts`
**Component**: `src/renderer/src/components/VariantTable.vue`

#### Vuetify Table Configuration
```vue
<v-data-table-server
  v-model:page="page"              <!-- Two-way: Vuetify controls page state -->
  v-model:items-per-page="itemsPerPage"
  v-model:sort-by="sortBy"
  :items="variants"
  :items-length="totalCount"       <!-- Enables pagination math -->
  :loading="loading"
  @update:options="loadVariants"   <!-- Single handler for all state changes -->
/>
```

#### Cursor Cache Strategy
```
Cache key: "${page}-${sortKey}-${sortOrder}"
```

On page navigation:
1. Check cache for target page cursor
2. **Cache hit** → Use cursor directly
3. **Cache miss** (arbitrary jump, e.g. "Last page") → Sequentially fetch intermediate pages to build cursor chain
4. Store `next_cursor` from each response for the following page

#### Invalidation Triggers
| Trigger | Action |
|---------|--------|
| Filter change | `cursorCache.clear()`, page = 1, reload |
| Sort change (actual, not spurious) | `cursorCache.clear()`, page = 1 |
| Column filter change | Debounced 300ms → `cursorCache.clear()`, page = 1, reload |
| Case change | `cursorCache.clear()`, page = 1, clear annotations |

#### Sort Deduplication Guard
Vuetify re-emits `update:sort-by` with a new array reference (but same content) on every page change. Without a guard, this resets page to 1 on every navigation.

```typescript
let prevSortSerialized = ''
watch(sortBy, () => {
  const serialized = sortBy.value.map(s => `${s.key}:${s.order}`).join(',')
  if (serialized === prevSortSerialized) return  // Skip spurious trigger
  prevSortSerialized = serialized
  cursorCache.value.clear()
  page.value = 1
}, { deep: true })
```

### 3.2 Cohort View

**Composable**: `src/renderer/src/composables/useCohortData.ts`
**Orchestrator**: `src/renderer/src/components/CohortTable.vue`
**Table**: `src/renderer/src/components/cohort/CohortDataTable.vue`

#### Key Difference: Parent-Controlled Pagination
```vue
<!-- CohortDataTable: one-way binding, emits to parent -->
<v-data-table-server
  :page="props.page"               <!-- One-way: parent controls -->
  @update:options="emit('update:options', $event)"
/>
```

`CohortTable.vue` handles all pagination logic in `handleTableOptions()`:

```
@update:options → handleTableOptions()
  ├── Re-entrancy guard (prevents reactive feedback loops)
  ├── Sort/pageSize change detection → invalidate cursors
  ├── Cursor gap filling (queryVariants — non-reactive)
  ├── Target page fetch (fetchVariants — updates reactive state)
  └── Cache next_cursor for following page
```

#### Non-Reactive Query for Cursor Prefetching

`useCohortData` exposes two query methods:
- **`fetchVariants(params)`** — Queries backend AND updates reactive state (`variants`, `totalCount`, `isLoading`). Triggers table re-render.
- **`queryVariants(params)`** — Queries backend, returns raw result. **Does NOT update reactive state.** Used for intermediate cursor-prefetching to avoid Vuetify `@update:options` feedback loops.

This separation prevents the "endless scrolling" bug where intermediate fetches triggered table re-renders → `@update:options` → more fetches → infinite loop.

### 3.3 Filter Composables

**Global filters** (`src/renderer/src/composables/useFilters.ts`):
- Provide/inject pattern for shared state across components
- Contains: `geneSymbol`, `consequences`, `funcs`, `clinvars`, `maxGnomadAf`, `minCadd`, `starredOnly`, `hasCommentOnly`, `acmgClassifications`
- Preset ↔ custom input sync (mutually exclusive)

**Column filters** (`src/renderer/src/composables/useColumnFilters.ts`):
- Per-column text search inputs in table header menus
- Produces `Record<string, string>` sent as `column_filters` param
- Debounced at 300ms to avoid per-keystroke IPC calls

---

## 4. Data Flow Diagrams

### Page Navigation (Next/Prev/Jump)
```
User action (click page N)
    ↓
Vuetify emits @update:options { page: N, sortBy, itemsPerPage }
    ↓
[Variant] loadVariants()  /  [Cohort] handleTableOptions()
    ↓
Check cursor cache for page N
    ├── HIT  → use cached cursor
    └── MISS → sequentially fetch pages from nearest cached page
               [Cohort: uses queryVariants() to avoid reactive updates]
    ↓
IPC call: api.variants.query() / api.cohort.getVariants()
    ↓
Main process: Zod validation → SQL query with cursor WHERE → result
    ↓
Response: { data[], total_count, has_more, next_cursor }
    ↓
Update reactive state → Vuetify re-renders table
```

### Filter Change
```
User modifies filter (dropdown, text input, preset)
    ↓
useFilters updates filters ref
    ↓
Deep watcher fires → invalidateAndReload()
    ↓
Clear cursor cache, reset page to 1, fetch with new filters
    ↓
Database applies WHERE conditions → new result set
```

### Sort Change
```
User clicks column header
    ↓
Vuetify updates v-model:sort-by
    ↓
Sort watcher: serialize → compare with previous → skip if unchanged
    ↓
If changed: clear cursor cache, reset page to 1
    ↓
@update:options fires → loadVariants() with new sort
    ↓
Database: ORDER BY [column] [direction] NULLS LAST/FIRST, id ASC
```

---

## 5. Known Constraints & Design Decisions

| Constraint | Reason |
|------------|--------|
| Single-column sort only | Cursor pagination requires deterministic position; multi-sort cursors are ambiguous |
| Sequential fetch for page jumps | Cursor-based pagination has no random access; must traverse pages in order |
| Deep-clone before IPC | Vue reactive Proxies fail Electron's structured clone algorithm |
| Sort deduplication guard | Vuetify re-emits sort-by on every page change with new array reference |
| Non-reactive queryVariants() | Intermediate cursor fetches must not trigger table re-renders |
| NULL-inclusive numeric filters | Novel variants without annotations should not be filtered out |
| 300ms column filter debounce | Prevents per-keystroke database queries |
| `LIMIT + 1` fetch strategy | Detects `has_more` without separate COUNT query (variant view) |
| Window function `COUNT(*) OVER()` | Computes total in same query as data (cohort view) |

---

## 6. File Reference

| Layer | File | Purpose |
|-------|------|---------|
| **DB** | `src/main/database/VariantRepository.ts` | Variant queries, cursor logic, filter/sort SQL |
| **DB** | `src/main/database/cohort.ts` | Cohort aggregation, two-CTE queries |
| **DB** | `src/main/database/types.ts` | `PaginationCursor` type |
| **IPC** | `src/main/ipc/handlers/variants.ts` | `variants:query` handler + Zod validation |
| **IPC** | `src/main/ipc/handlers/cohort.ts` | `cohort:variants` handler + serialization |
| **Validation** | `src/shared/types/ipc-schemas.ts` | Zod schemas for all IPC params |
| **Types** | `src/shared/types/api.ts` | `PaginatedResult`, `VariantFilter`, `SortItem` |
| **Types** | `src/shared/types/cohort.ts` | `CohortPaginationCursor`, `CohortSearchParams` |
| **Preload** | `src/preload/index.ts` | Typed API bridge (`contextBridge`) |
| **Frontend** | `src/renderer/src/components/variant-table/useVariantData.ts` | Case view pagination/sort/filter orchestration |
| **Frontend** | `src/renderer/src/composables/useCohortData.ts` | Cohort data fetching (`fetchVariants` + `queryVariants`) |
| **Frontend** | `src/renderer/src/components/CohortTable.vue` | Cohort pagination orchestrator |
| **Frontend** | `src/renderer/src/components/VariantTable.vue` | Case view Vuetify table config |
| **Frontend** | `src/renderer/src/composables/useFilters.ts` | Global filter state (provide/inject) |
| **Frontend** | `src/renderer/src/composables/useColumnFilters.ts` | Per-column text filter state |
