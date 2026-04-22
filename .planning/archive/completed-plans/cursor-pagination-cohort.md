# Cursor-Based Cohort Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace OFFSET-based pagination in cohort queries with cursor-based (keyset) pagination for O(1) page access regardless of depth.

**Architecture:** The cohort query uses a CTE with GROUP BY to aggregate variants across cases. Since aggregated rows don't have a single `id` column, the cursor will use `variant_key` (chr:pos:ref:alt) as a tiebreaker alongside the primary sort column value. The approach mirrors the existing `VariantRepository.buildCursorCondition()` pattern but adapts it for aggregate queries. Vuetify's `v-data-table-server` continues to work — it still receives `items-length` for page indicators, but the backend resolves pages via cursor instead of offset.

**Tech Stack:** TypeScript, better-sqlite3, Zod, Vue 3 + Vuetify 3, Vitest

**Issue:** #31

---

## Task 1: Add CohortPaginationCursor type

**Files:**
- Modify: `src/shared/types/cohort.ts:112-149`

**Step 1: Add cursor and result types after GeneBurden (line 107)**

Add before `CohortSearchParams`:

```typescript
/**
 * Cursor for cohort keyset pagination
 * Uses variant_key as tiebreaker since aggregated rows have no single id
 */
export interface CohortPaginationCursor {
  /** Value of primary sort column for keyset comparison */
  sort_value: number | string | null
  /** Column key being sorted (prevents cursor reuse after sort change) */
  sort_key: string
  /** variant_key of last row (tiebreaker: "chr:pos:ref:alt") */
  variant_key: string
}

/**
 * Paginated result for cohort queries
 */
export interface CohortPaginatedResult {
  /** Array of cohort variants */
  data: CohortVariant[]
  /** Cursor for fetching next page, null if no more results */
  next_cursor: CohortPaginationCursor | null
  /** Whether more results exist beyond this page */
  has_more: boolean
  /** Total count of matching variants (via window function) */
  total_count: number
}
```

**Step 2: Update CohortSearchParams — replace offset with cursor**

Replace the `offset` field and add `cursor`:

```typescript
export interface CohortSearchParams {
  /** Search term (gene symbol, chr:pos) */
  search_term?: string
  /** Column to sort by */
  sort_by?: string
  /** Sort direction */
  sort_order?: 'asc' | 'desc'
  /** Page size */
  limit?: number
  /** Cursor for keyset pagination (replaces offset) */
  cursor?: CohortPaginationCursor

  // ... rest of filter fields unchanged ...
}
```

**Step 3: Commit**

```bash
git add src/shared/types/cohort.ts
git commit -m "feat: add CohortPaginationCursor and CohortPaginatedResult types

Replaces offset with cursor in CohortSearchParams for keyset pagination.
Cursor uses variant_key as tiebreaker for aggregate rows.

Refs #31"
```

---

## Task 2: Update Zod schema for cursor validation

**Files:**
- Modify: `src/shared/types/ipc-schemas.ts:53-110`

**Step 1: Add cursor schema and update CohortSearchParamsSchema**

Replace the `offset` field with `cursor` in `CohortSearchParamsSchema`:

```typescript
export const CohortSearchParamsSchema = z.object({
  // Pagination
  limit: z.number().int().positive().max(10000).optional(),
  // Cursor-based pagination (replaces offset)
  cursor: z
    .object({
      sort_value: z.union([z.number(), z.string(), z.null()]),
      sort_key: z.string().min(1),
      variant_key: z.string().min(1)
    })
    .nullish()
    .transform((val) => val ?? undefined),

  // ... rest unchanged (sort_by, sort_order, filters) ...
})
```

Remove the `offset` line:
```
- offset: z.number().int().nonnegative().optional(),
```

**Step 2: Commit**

```bash
git add src/shared/types/ipc-schemas.ts
git commit -m "feat: update CohortSearchParamsSchema with cursor validation

Replaces offset field with cursor object (sort_value, sort_key, variant_key).
Zod validates cursor structure at IPC boundary.

Refs #31"
```

---

## Task 3: Write failing tests for cursor-based pagination in CohortService

**Files:**
- Modify: `tests/main/database/cohort.test.ts`

**Step 1: Add cursor pagination tests in the `pagination` describe block**

Replace the existing `pagination` describe block (lines 353-373) with:

```typescript
describe('pagination', () => {
  it('should return first page without cursor', () => {
    const caseId = insertCase('Test Case')
    for (let i = 0; i < 10; i++) {
      insertVariant(caseId, '1', 100 + i, 'A', 'G')
    }

    const result = cohortService.getCohortVariants({ limit: 3 })

    expect(result.data.length).toBe(3)
    expect(result.total_count).toBe(10)
    expect(result.has_more).toBe(true)
    expect(result.next_cursor).not.toBeNull()
  })

  it('should return subsequent pages using cursor', () => {
    const caseId = insertCase('Test Case')
    // Insert 10 variants at different positions
    for (let i = 0; i < 10; i++) {
      insertVariant(caseId, '1', 100 + i, 'A', 'G')
    }

    // Get first page
    const page1 = cohortService.getCohortVariants({ limit: 3 })
    expect(page1.data.length).toBe(3)
    expect(page1.next_cursor).not.toBeNull()

    // Get second page using cursor
    const page2 = cohortService.getCohortVariants({
      limit: 3,
      cursor: page1.next_cursor!
    })
    expect(page2.data.length).toBe(3)
    expect(page2.total_count).toBe(10)

    // Pages should have different variants
    const page1Keys = page1.data.map((v) => v.variant_key)
    const page2Keys = page2.data.map((v) => v.variant_key)
    expect(page1Keys).not.toEqual(page2Keys)
    // No overlap between pages
    for (const key of page2Keys) {
      expect(page1Keys).not.toContain(key)
    }
  })

  it('should return has_more=false on last page', () => {
    const caseId = insertCase('Test Case')
    for (let i = 0; i < 5; i++) {
      insertVariant(caseId, '1', 100 + i, 'A', 'G')
    }

    const page1 = cohortService.getCohortVariants({ limit: 3 })
    expect(page1.has_more).toBe(true)

    const page2 = cohortService.getCohortVariants({
      limit: 3,
      cursor: page1.next_cursor!
    })
    expect(page2.data.length).toBe(2)
    expect(page2.has_more).toBe(false)
    expect(page2.next_cursor).toBeNull()
  })

  it('should invalidate cursor when sort changes', () => {
    const caseId = insertCase('Test Case')
    for (let i = 0; i < 10; i++) {
      insertVariant(caseId, '1', 100 + i, 'A', 'G', { gene_symbol: `GENE${i}` })
    }

    // Get cursor sorted by carrier_count (default)
    const page1 = cohortService.getCohortVariants({ limit: 3 })

    // Use cursor with different sort — should return empty (cursor invalid)
    const result = cohortService.getCohortVariants({
      limit: 3,
      sort_by: 'pos',
      sort_order: 'asc',
      cursor: page1.next_cursor!
    })
    expect(result.data).toEqual([])
  })

  it('should paginate correctly with sort by pos ascending', () => {
    const caseId = insertCase('Test Case')
    for (let i = 0; i < 6; i++) {
      insertVariant(caseId, '1', 100 + i, 'A', 'G')
    }

    const page1 = cohortService.getCohortVariants({
      limit: 3,
      sort_by: 'pos',
      sort_order: 'asc'
    })
    expect(page1.data.map((v) => v.pos)).toEqual([100, 101, 102])

    const page2 = cohortService.getCohortVariants({
      limit: 3,
      sort_by: 'pos',
      sort_order: 'asc',
      cursor: page1.next_cursor!
    })
    expect(page2.data.map((v) => v.pos)).toEqual([103, 104, 105])
    expect(page2.has_more).toBe(false)
  })

  it('should handle cursor with NULL sort values', () => {
    const case1 = insertCase('Case 1')
    const case2 = insertCase('Case 2')

    // Some variants with gnomad_af, some without
    insertVariant(case1, '1', 100, 'A', 'G', { gnomad_af: 0.01 })
    insertVariant(case1, '2', 200, 'C', 'T', {}) // NULL gnomad_af
    insertVariant(case2, '3', 300, 'G', 'A', { gnomad_af: 0.05 })
    insertVariant(case1, '4', 400, 'T', 'C', {}) // NULL gnomad_af

    const page1 = cohortService.getCohortVariants({
      limit: 2,
      sort_by: 'gnomad_af',
      sort_order: 'desc'
    })
    expect(page1.data.length).toBe(2)
    expect(page1.has_more).toBe(true)

    const page2 = cohortService.getCohortVariants({
      limit: 2,
      sort_by: 'gnomad_af',
      sort_order: 'desc',
      cursor: page1.next_cursor!
    })
    expect(page2.data.length).toBe(2)

    // All 4 variants should appear across both pages (no duplicates)
    const allKeys = [...page1.data.map((v) => v.variant_key), ...page2.data.map((v) => v.variant_key)]
    expect(new Set(allKeys).size).toBe(4)
  })

  it('should traverse all results across pages without duplicates', () => {
    const case1 = insertCase('Case 1')
    const case2 = insertCase('Case 2')

    // 7 unique variants with varying carrier counts
    insertVariant(case1, '1', 100, 'A', 'G')
    insertVariant(case2, '1', 100, 'A', 'G') // shared: carrier_count=2
    insertVariant(case1, '2', 200, 'C', 'T')
    insertVariant(case2, '2', 200, 'C', 'T') // shared: carrier_count=2
    insertVariant(case1, '3', 300, 'G', 'A')
    insertVariant(case1, '4', 400, 'T', 'C')
    insertVariant(case1, '5', 500, 'A', 'T')

    // Paginate through all results
    const allVariantKeys: string[] = []
    let cursor = undefined as any
    let pages = 0

    while (pages < 10) { // safety limit
      const result = cohortService.getCohortVariants({
        limit: 2,
        cursor
      })
      allVariantKeys.push(...result.data.map((v) => v.variant_key))
      pages++
      if (!result.has_more) break
      cursor = result.next_cursor
    }

    // All 5 unique variants should appear exactly once
    expect(allVariantKeys.length).toBe(5)
    expect(new Set(allVariantKeys).size).toBe(5)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm run rebuild:node && npx vitest run tests/main/database/cohort.test.ts
```

Expected: FAIL — `has_more` and `next_cursor` don't exist on result yet.

**Step 3: Commit failing tests**

```bash
git add tests/main/database/cohort.test.ts
git commit -m "test: add failing tests for cursor-based cohort pagination

Tests cover: first page, subsequent pages, last page detection,
cursor invalidation on sort change, NULL sort values, and
full traversal without duplicates.

Refs #31"
```

---

## Task 4: Implement cursor-based pagination in CohortService

**Files:**
- Modify: `src/main/database/cohort.ts`

**Step 1: Update imports**

Add `CohortPaginationCursor` and `CohortPaginatedResult` to imports:

```typescript
import type {
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  CohortCarrier,
  GeneBurden,
  CohortPaginationCursor,
  CohortPaginatedResult
} from '../../shared/types/cohort'
```

**Step 2: Add cursor condition builder method**

Add after the `buildBooleanSearchCondition` method (around line 364):

```typescript
/**
 * Build cursor condition for keyset pagination on aggregated results.
 *
 * Since cohort results are aggregated (GROUP BY chr, pos, ref, alt),
 * we use variant_key as tiebreaker instead of a row id.
 *
 * @returns SQL HAVING condition and params, or null if cursor is invalid
 */
private buildCursorCondition(
  cursor: CohortPaginationCursor,
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc'
): { condition: string; params: (string | number | null)[] } | null {
  // Determine the effective sort key
  const effectiveSortKey = sortBy ?? 'carrier_count'

  // Invalidate cursor if sort changed
  if (cursor.sort_key !== effectiveSortKey) {
    return null
  }

  const sqlColumn = SORTABLE_COLUMNS[effectiveSortKey]
  if (sqlColumn === undefined) return null

  const params: (string | number | null)[] = []
  let condition: string

  // For aggregate columns, use the expression directly
  const isAggregate = AGGREGATE_COLUMNS.has(effectiveSortKey)
  const columnExpr = isAggregate ? this.getAggregateExpression(effectiveSortKey) : sqlColumn

  if (cursor.sort_value === null) {
    // Current position is in the NULL region
    if (sortOrder === 'asc') {
      // ASC: NULLs last in SQLite — only more NULLs with greater variant_key
      condition = `(${columnExpr} IS NULL AND (chr || ':' || pos || ':' || ref || ':' || alt) > ?)`
      params.push(cursor.variant_key)
    } else {
      // DESC: NULLs last in SQLite — only more NULLs with greater variant_key
      condition = `(${columnExpr} IS NULL AND (chr || ':' || pos || ':' || ref || ':' || alt) > ?)`
      params.push(cursor.variant_key)
    }
  } else {
    const compareOp = sortOrder === 'desc' ? '<' : '>'
    if (sortOrder === 'asc') {
      // ASC: get rows with greater sort value, or same value with greater variant_key, or NULLs (last)
      condition = `(${columnExpr} ${compareOp} ? OR (${columnExpr} = ? AND (chr || ':' || pos || ':' || ref || ':' || alt) > ?) OR ${columnExpr} IS NULL)`
      params.push(cursor.sort_value, cursor.sort_value, cursor.variant_key)
    } else {
      // DESC: get rows with lesser sort value, or same value with greater variant_key
      condition = `(${columnExpr} ${compareOp} ? OR (${columnExpr} = ? AND (chr || ':' || pos || ':' || ref || ':' || alt) > ?))`
      params.push(cursor.sort_value, cursor.sort_value, cursor.variant_key)
    }
  }

  return { condition, params }
}

/**
 * Get the SQL expression for an aggregate column.
 * These expressions must match what's used in the SELECT clause.
 */
private getAggregateExpression(column: string): string {
  switch (column) {
    case 'carrier_count':
      return 'COUNT(*)'
    case 'het_count':
      return "SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END)"
    case 'hom_count':
      return "SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END)"
    case 'cohort_frequency':
      // totalCases is interpolated at query build time, so this won't work standalone.
      // Use the alias in HAVING clause instead.
      return 'cohort_frequency'
    default:
      return column
  }
}
```

**Step 3: Update getCohortVariants to return CohortPaginatedResult and use cursor**

Key changes to `getCohortVariants`:

1. Change return type to `CohortPaginatedResult`
2. Replace `offset` with cursor condition in HAVING clause
3. Fetch `limit + 1` rows to detect `has_more`
4. Build `next_cursor` from last row

Replace the method signature and pagination logic:

```typescript
getCohortVariants(params: CohortSearchParams): CohortPaginatedResult {
  const limit = params.limit ?? 50
  const sortBy = params.sort_by !== undefined ? SORTABLE_COLUMNS[params.sort_by] : undefined
  const sortOrder = params.sort_order ?? 'desc'
  const effectiveSortKey = params.sort_by ?? 'carrier_count'

  // ... totalCases check unchanged ...

  // ... WHERE clause building unchanged ...

  // ... HAVING clause building unchanged (carrier_count_min, cohort_frequency_min, column filters) ...

  // Add cursor condition to HAVING clause
  const cursorParams: (string | number | null)[] = []
  if (params.cursor !== undefined) {
    const cursorResult = this.buildCursorCondition(params.cursor, params.sort_by, sortOrder)
    if (cursorResult === null) {
      // Invalid cursor (sort changed) — return empty
      return { data: [], next_cursor: null, has_more: false, total_count: 0 }
    }
    havingConditions.push(cursorResult.condition)
    cursorParams.push(...cursorResult.params)
  }

  // ... ORDER BY clause unchanged ...

  // Fetch limit+1 to detect has_more without a separate count query
  const fetchLimit = limit + 1

  const sql = `
    WITH deduped AS (
      SELECT
        chr, pos, ref, alt, case_id,
        MAX(gene_symbol) as gene_symbol,
        MAX(cdna) as cdna,
        MAX(aa_change) as aa_change,
        MAX(gt_num) as gt_num,
        MAX(consequence) as consequence,
        MAX(func) as func,
        MAX(clinvar) as clinvar,
        MAX(gnomad_af) as gnomad_af,
        MAX(cadd) as cadd,
        MAX(transcript) as transcript,
        MAX(omim_mim_number) as omim_id
      FROM variants
      ${whereClause}
      GROUP BY chr, pos, ref, alt, case_id
    )
    SELECT
      chr,
      pos,
      ref,
      alt,
      MAX(gene_symbol) as gene_symbol,
      MAX(cdna) as cdna,
      MAX(aa_change) as aa_change,
      COUNT(*) as carrier_count,
      ${totalCases} as total_cases,
      CAST(COUNT(*) AS REAL) / ${totalCases} as cohort_frequency,
      SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END) as het_count,
      SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END) as hom_count,
      chr || ':' || pos || ':' || ref || ':' || alt as variant_key,
      MAX(consequence) as consequence,
      MAX(func) as func,
      MAX(clinvar) as clinvar,
      MAX(gnomad_af) as gnomad_af,
      MAX(cadd) as cadd_phred,
      MAX(transcript) as transcript,
      MAX(omim_id) as omim_id,
      COUNT(*) OVER() as _total_count
    FROM deduped
    GROUP BY chr, pos, ref, alt
    ${havingClause}
    ${orderByClause}
    LIMIT ?
  `

  const stmt = this.getStatement(sql)
  const rawResults = stmt.all(
    ...params_array,
    ...havingParams,
    ...cursorParams,
    fetchLimit
  ) as (CohortVariant & { _total_count: number })[]

  // Detect has_more by checking if we got more than limit
  const hasMore = rawResults.length > limit
  const pageResults = hasMore ? rawResults.slice(0, limit) : rawResults

  // Extract total count from window function
  const totalCount = pageResults.length > 0 ? pageResults[0]._total_count : 0

  // Build next cursor from last row
  let nextCursor: CohortPaginationCursor | null = null
  if (hasMore && pageResults.length > 0) {
    const lastRow = pageResults[pageResults.length - 1]
    const sortColumn = SORTABLE_COLUMNS[effectiveSortKey] ?? 'carrier_count'
    nextCursor = {
      sort_value: (lastRow as Record<string, unknown>)[sortColumn === 'cadd' ? 'cadd_phred' : sortColumn] as string | number | null ?? null,
      sort_key: effectiveSortKey,
      variant_key: lastRow.variant_key
    }
  }

  // Strip _total_count
  const results = pageResults.map(({ _total_count, ...row }) => row) as CohortVariant[]

  return {
    data: results,
    next_cursor: nextCursor,
    has_more: hasMore,
    total_count: totalCount
  }
}
```

**Important implementation note:** The cursor condition goes into the HAVING clause because aggregate columns (carrier_count, cohort_frequency) are only available after GROUP BY. For non-aggregate sort columns, the condition can be placed in HAVING as well (valid SQL — HAVING can reference non-aggregate columns that are in the GROUP BY).

**Step 4: Run tests**

```bash
npx vitest run tests/main/database/cohort.test.ts
```

Expected: All cursor pagination tests PASS.

**Step 5: Commit**

```bash
git add src/main/database/cohort.ts
git commit -m "feat: implement cursor-based pagination in CohortService

Replaces OFFSET with keyset pagination using HAVING conditions.
Uses variant_key as tiebreaker for aggregate rows.
Fetches limit+1 to detect has_more without separate count query.
Returns CohortPaginatedResult with next_cursor.

Refs #31"
```

---

## Task 5: Update IPC handler for new return shape

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts:14-55`

**Step 1: Update the cohort:variants handler to pass through cursor fields**

The handler already deep-clones the result. Update it to include `has_more` and `next_cursor`:

```typescript
ipcMain.handle('cohort:variants', async (_event, params: unknown) => {
  return wrapHandler(async () => {
    const validated = CohortSearchParamsSchema.safeParse(params)
    if (!validated.success) {
      mainLogger.error(`Invalid cohort:variants params: ${validated.error.message}`, 'cohort')
      throw new Error('Invalid search parameters')
    }

    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    const result = cohortService.getCohortVariants(validated.data)

    const plainData = result.data.map((v) => ({
      chr: String(v.chr),
      pos: Number(v.pos),
      ref: String(v.ref),
      alt: String(v.alt),
      gene_symbol: v.gene_symbol ?? null,
      cdna: v.cdna ?? null,
      aa_change: v.aa_change ?? null,
      carrier_count: Number(v.carrier_count),
      total_cases: Number(v.total_cases),
      cohort_frequency: Number(v.cohort_frequency),
      het_count: Number(v.het_count),
      hom_count: Number(v.hom_count),
      variant_key: String(v.variant_key),
      consequence: v.consequence ?? null,
      func: v.func ?? null,
      clinvar: v.clinvar ?? null,
      gnomad_af: v.gnomad_af !== null ? Number(v.gnomad_af) : null,
      cadd_phred: v.cadd_phred !== null ? Number(v.cadd_phred) : null,
      transcript: v.transcript ?? null,
      omim_id: v.omim_id ?? null
    }))
    return {
      data: plainData,
      total_count: Number(result.total_count),
      has_more: result.has_more,
      next_cursor: result.next_cursor
    }
  })
})
```

**Step 2: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts
git commit -m "feat: update cohort IPC handler to return cursor pagination fields

Passes through has_more and next_cursor from CohortService.

Refs #31"
```

---

## Task 6: Update preload API binding

**Files:**
- Modify: `src/preload/index.ts:138-144`

**Step 1: Update the cohort.getVariants type**

The preload binding is untyped (uses `ipcRenderer.invoke` which returns `any`), so no code change is needed — the new fields (`has_more`, `next_cursor`) pass through automatically.

However, update the import for `CohortSearchParams` to ensure it's pulling the updated type:

```typescript
// No change needed — CohortSearchParams is imported from shared/types
// and the updated type (with cursor instead of offset) flows through
```

**This task is a no-op.** The preload layer is a thin pass-through. Proceed to Task 7.

---

## Task 7: Update useCohortData composable

**Files:**
- Modify: `src/renderer/src/composables/useCohortData.ts`

**Step 1: Update CohortQueryParams to use cursor**

Replace `offset` with cursor support:

```typescript
import type {
  CohortVariant,
  CohortSummary,
  CohortPaginationCursor
} from '../../../shared/types/cohort'

export interface CohortQueryParams {
  /** Number of items per page */
  limit: number
  /** Cursor for keyset pagination (undefined = first page) */
  cursor?: CohortPaginationCursor
  /** Column to sort by */
  sort_by?: string
  /** Sort direction */
  sort_order: 'asc' | 'desc'
  // ... all filter fields unchanged ...
}
```

**Step 2: Add cursor state and update return type**

```typescript
export interface UseCohortDataReturn {
  variants: Ref<CohortVariant[]>
  totalCount: Ref<number>
  isLoading: Ref<boolean>
  error: Ref<Error | null>
  summary: Ref<CohortSummary | null>
  /** Cursor for next page, null if no more results */
  nextCursor: Ref<CohortPaginationCursor | null>
  /** Whether more results exist */
  hasMore: Ref<boolean>
  fetchVariants: (params: CohortQueryParams) => Promise<void>
  fetchSummary: () => Promise<void>
  reset: () => void
}
```

**Step 3: Update the composable implementation**

Add refs and update `fetchVariants`:

```typescript
export function useCohortData(): UseCohortDataReturn {
  const variants = ref<CohortVariant[]>([])
  const totalCount = ref(0)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const summary = ref<CohortSummary | null>(null)
  const nextCursor = ref<CohortPaginationCursor | null>(null)
  const hasMore = ref(false)

  const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
    if (typeof window.api === 'undefined') {
      console.warn('window.api not available - running outside Electron')
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const ipcParams: Record<string, unknown> = {
        limit: params.limit,
        sort_order: params.sort_order
      }

      // Pass cursor instead of offset
      if (params.cursor !== undefined) {
        ipcParams.cursor = {
          sort_value: params.cursor.sort_value,
          sort_key: params.cursor.sort_key,
          variant_key: params.cursor.variant_key
        }
      }

      // ... rest of filter param building unchanged ...

      const plainParams = globalThis.structuredClone(ipcParams)
      const result = await (window as any).api.cohort.getVariants(plainParams)

      variants.value = result.data ?? []
      totalCount.value = result.total_count ?? 0
      nextCursor.value = result.next_cursor ?? null
      hasMore.value = result.has_more ?? false
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      variants.value = []
      totalCount.value = 0
      nextCursor.value = null
      hasMore.value = false
    } finally {
      isLoading.value = false
    }
  }

  const reset = (): void => {
    variants.value = []
    totalCount.value = 0
    error.value = null
    summary.value = null
    nextCursor.value = null
    hasMore.value = false
  }

  return {
    variants,
    totalCount,
    isLoading,
    error,
    summary,
    nextCursor,
    hasMore,
    fetchVariants,
    fetchSummary,
    reset
  }
}
```

**Step 4: Commit**

```bash
git add src/renderer/src/composables/useCohortData.ts
git commit -m "feat: update useCohortData composable for cursor pagination

Replaces offset with cursor in CohortQueryParams.
Adds nextCursor and hasMore reactive refs.
Passes cursor through IPC to backend.

Refs #31"
```

---

## Task 8: Update CohortTable.vue to use cursor pagination

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue:226-276`

**Step 1: Add cursor state tracking**

The key insight: Vuetify's `v-data-table-server` emits `{ page, itemsPerPage, sortBy }` on page/sort changes. We need to maintain a cursor map — when the user goes to page N, we need the cursor from page N-1.

Add a cursor tracking map after the composable destructuring:

```typescript
import type { CohortPaginationCursor } from '../../../shared/types/cohort'

const { variants, totalCount, isLoading, error, summary, nextCursor, hasMore, fetchVariants, fetchSummary } =
  useCohortData()

// Cursor tracking: page number -> cursor to use for that page
// Page 1 has no cursor (first page), page 2 uses cursor from page 1, etc.
const pageCursors = ref<Map<number, CohortPaginationCursor>>(new Map())
const currentPage = ref(1)
```

**Step 2: Update buildQueryParams to remove offset**

```typescript
const buildQueryParams = (cursor?: CohortPaginationCursor) => ({
  limit: 50,
  cursor,
  sort_order: 'desc' as const,
  search_term: searchTerm.value || undefined,
  // ... all other filter fields unchanged ...
})
```

**Step 3: Update handleTableOptions**

```typescript
const handleTableOptions = async (options: {
  page: number
  itemsPerPage: number
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>
}) => {
  const newSortBy = options.sortBy.length > 0 ? options.sortBy[0].key : undefined
  const newSortOrder = (options.sortBy.length > 0 ? options.sortBy[0].order : 'desc') as 'asc' | 'desc'

  // Reset cursors if sort changed or page size changed
  const sortChanged = newSortBy !== currentSortBy.value || newSortOrder !== currentSortOrder.value
  if (sortChanged) {
    pageCursors.value.clear()
    currentPage.value = 1
  }
  currentSortBy.value = newSortBy
  currentSortOrder.value = newSortOrder

  // Get cursor for requested page (page 1 = no cursor)
  const cursor = options.page > 1 ? pageCursors.value.get(options.page) : undefined

  const baseParams = buildQueryParams(cursor)
  const params = {
    ...baseParams,
    limit: options.itemsPerPage,
    sort_by: newSortBy,
    sort_order: newSortOrder
  }

  await fetchVariants(params)
  currentPage.value = options.page

  // Store cursor for next page
  if (nextCursor.value) {
    pageCursors.value.set(options.page + 1, nextCursor.value)
  }
}
```

**Step 4: Add sort tracking refs**

```typescript
const currentSortBy = ref<string | undefined>(undefined)
const currentSortOrder = ref<'asc' | 'desc'>('desc')
```

**Step 5: Reset cursors when filters change**

Update all filter-change handlers to clear the cursor map:

```typescript
const handleFilterChange = async () => {
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleClearAll = async () => {
  clearAllFilters()
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleClearFilter = async (filterId: string) => {
  clearFilter(filterId)
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleColumnFiltersChange = async (
  filters: Record<string, string> | undefined
): Promise<void> => {
  cohortColumnFilters.value = filters
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

const handleRetry = async () => {
  error.value = null
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}
```

**Step 6: Commit**

```bash
git add src/renderer/src/components/CohortTable.vue
git commit -m "feat: update CohortTable to use cursor-based pagination

Maintains page-to-cursor map for Vuetify v-data-table-server.
Resets cursors on sort/filter changes.
Page 1 = no cursor, subsequent pages use stored cursors.

Refs #31"
```

---

## Task 9: Update composable tests

**Files:**
- Modify: `tests/renderer/composables/useCohortData.test.ts`

**Step 1: Update mock to return cursor pagination fields**

Find the mock return value and add `has_more` and `next_cursor`:

```typescript
// In the mock setup, update the return value:
getVariants: vi.fn().mockResolvedValue({
  data: [/* ... */],
  total_count: 1,
  has_more: false,
  next_cursor: null
})
```

**Step 2: Update test assertions to check new fields**

```typescript
it('should expose nextCursor and hasMore', async () => {
  // ... setup mock with has_more: true and next_cursor ...
  expect(result.nextCursor.value).toEqual(/* cursor */)
  expect(result.hasMore.value).toBe(true)
})
```

**Step 3: Update the offset-based test to use cursor**

Find any test that passes `offset` in params and replace with cursor.

**Step 4: Run tests**

```bash
npx vitest run tests/renderer/composables/useCohortData.test.ts
```

**Step 5: Commit**

```bash
git add tests/renderer/composables/useCohortData.test.ts
git commit -m "test: update useCohortData tests for cursor pagination

Updates mock return values to include has_more and next_cursor.
Removes offset-based assertions, adds cursor assertions.

Refs #31"
```

---

## Task 10: Update IPC handler tests

**Files:**
- Modify: `tests/main/handlers/cohort-handlers.test.ts`

**Step 1: Update handler test assertions for new return shape**

The handler tests verify the IPC payload structure. Update to assert `has_more` and `next_cursor` fields.

**Step 2: Run tests**

```bash
npx vitest run tests/main/handlers/cohort-handlers.test.ts
```

**Step 3: Commit**

```bash
git add tests/main/handlers/cohort-handlers.test.ts
git commit -m "test: update cohort handler tests for cursor pagination response

Refs #31"
```

---

## Task 11: Update export handler (no pagination for export)

**Files:**
- Modify: `src/main/ipc/handlers/export.ts` (if it passes offset)

**Step 1: Check if export uses pagination**

The cohort export handler likely passes params without pagination (exports all matching). Verify and ensure it doesn't break — it should pass `limit: 10000` (or similar high limit) without cursor, which will work as a first-page query.

**Step 2: Fix if needed, commit**

```bash
git add src/main/ipc/handlers/export.ts
git commit -m "fix: ensure cohort export works without cursor pagination

Export fetches all matching variants without pagination.

Refs #31"
```

---

## Task 12: Run full test suite and lint

**Step 1: Run all tests**

```bash
npm run rebuild:node && npm test
```

**Step 2: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

**Step 3: Fix any issues**

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve lint/typecheck issues for cursor pagination

Refs #31"
```

---

## Summary of files changed

| File | Change |
|------|--------|
| `src/shared/types/cohort.ts` | Add `CohortPaginationCursor`, `CohortPaginatedResult`; replace `offset` with `cursor` in `CohortSearchParams` |
| `src/shared/types/ipc-schemas.ts` | Replace `offset` with `cursor` object in Zod schema |
| `src/main/database/cohort.ts` | Add `buildCursorCondition()`, `getAggregateExpression()`; update `getCohortVariants()` return type and logic |
| `src/main/ipc/handlers/cohort.ts` | Pass through `has_more` and `next_cursor` in response |
| `src/renderer/src/composables/useCohortData.ts` | Replace `offset` with `cursor` in params; add `nextCursor`, `hasMore` refs |
| `src/renderer/src/components/CohortTable.vue` | Add page-to-cursor map; update handlers to clear cursors on filter/sort change |
| `tests/main/database/cohort.test.ts` | Replace offset pagination tests with cursor tests |
| `tests/renderer/composables/useCohortData.test.ts` | Update mocks and assertions |
| `tests/main/handlers/cohort-handlers.test.ts` | Update payload assertions |

## Key design decisions

1. **variant_key as tiebreaker** — Aggregate rows have no single `id`. The `chr:pos:ref:alt` composite key is unique and sortable, making it a stable tiebreaker.

2. **HAVING clause for cursor** — Cursor conditions on aggregate columns (carrier_count, het_count) must go in HAVING, not WHERE. Non-aggregate sort columns also work in HAVING since they're in the GROUP BY.

3. **Page cursor map** — Vuetify's `v-data-table-server` still emits page numbers. We maintain a `Map<pageNumber, cursor>` to translate. Forward pagination stores cursors as pages are fetched. Backward navigation reuses stored cursors.

4. **Cursor invalidation** — When sort column changes, stored cursors become invalid. We clear the map and reset to page 1.

5. **`limit + 1` pattern** — Fetch one extra row to detect `has_more` without a separate count query. The extra row is stripped before returning.
