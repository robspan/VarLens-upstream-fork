# Cohort View Performance Optimization Plan

**Date:** 2026-03-14
**Branch:** `feat/materialized-cohort-summary`
**Context:** ~350 cases, 500k+ variants, ~200k unique variants in summary table. Cohort queries are slow.

## Current State (already implemented on branch)

- [x] Materialized summary tables (`cohort_variant_summary`, `gene_burden_summary`)
- [x] Migration v13 with tables, indexes, and meta tracking
- [x] `CohortSummaryService` with rebuild/markStale/getStatus
- [x] Rebuild triggered after import/delete in worker threads
- [x] Cohort queries read from summary table instead of raw `variants`
- [x] ANALYZE on summary tables after rebuild
- [x] Statement caching in `CohortService`
- [x] Dynamic WHERE clause construction (avoids `IS NULL OR` anti-pattern)
- [x] Good PRAGMA settings (WAL, 32MB cache, 256MB mmap, temp_store=MEMORY)

---

## P0 — High Impact, Low Effort

### 1. Denormalize annotation flags into `cohort_variant_summary`

**Problem:** The `starred_only`, `has_comment`, and `acmg_classifications` filters use correlated EXISTS subqueries evaluated per-row. The `case_variant_annotations` path JOINs through the 500k-row `variants` table. SQLite does NOT de-correlate correlated subqueries — each runs once per summary row (~200k evaluations).

**Solution:** Add pre-computed annotation columns to `cohort_variant_summary` and populate them during rebuild.

**Schema changes (migration v14):**
```sql
ALTER TABLE cohort_variant_summary ADD COLUMN has_star INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_variant_summary ADD COLUMN has_comment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_variant_summary ADD COLUMN acmg_best TEXT;
```

**Rebuild SQL update** (`cohort-summary-rebuild.ts`):
- Add columns to the INSERT statement
- Populate via subqueries during rebuild (one-time cost, not per-query):

```sql
-- has_star: check both global and per-case annotations
(SELECT MAX(
  CASE WHEN EXISTS (
    SELECT 1 FROM variant_annotations va2
    WHERE va2.chr = v_agg.chr AND va2.pos = v_agg.pos
    AND va2.ref = v_agg.ref AND va2.alt = v_agg.alt AND va2.starred = 1
  ) THEN 1
  WHEN EXISTS (
    SELECT 1 FROM case_variant_annotations cva2
    JOIN variants v2 ON cva2.variant_id = v2.id
    WHERE v2.chr = v_agg.chr AND v2.pos = v_agg.pos
    AND v2.ref = v_agg.ref AND v2.alt = v_agg.alt AND cva2.starred = 1
  ) THEN 1
  ELSE 0 END
)) AS has_star
```

Alternative (simpler, two-pass approach):
```sql
-- After main rebuild, UPDATE annotation flags separately:
UPDATE cohort_variant_summary SET has_star = 1
WHERE EXISTS (SELECT 1 FROM variant_annotations va
  WHERE va.chr = cohort_variant_summary.chr
  AND va.pos = cohort_variant_summary.pos
  AND va.ref = cohort_variant_summary.ref
  AND va.alt = cohort_variant_summary.alt
  AND va.starred = 1)
OR EXISTS (SELECT 1 FROM case_variant_annotations cva
  JOIN variants v ON cva.variant_id = v.id
  WHERE v.chr = cohort_variant_summary.chr
  AND v.pos = cohort_variant_summary.pos
  AND v.ref = cohort_variant_summary.ref
  AND v.alt = cohort_variant_summary.alt
  AND cva.starred = 1);
```

**Query simplification** (`cohort.ts`):
```typescript
// Before (expensive per-row EXISTS):
whereConditions.push(`(EXISTS (SELECT 1 FROM variant_annotations va ...))`)

// After (simple column check):
whereConditions.push('cvs.has_star = 1')
```

**Files to modify:**
- `src/main/database/migrations.ts` — add migration v14
- `src/shared/sql/cohort-summary-rebuild.ts` — update rebuild SQL
- `src/main/database/cohort.ts` — simplify annotation filter conditions
- Tests for migration v14 and updated cohort queries

**Note:** Annotation changes (starring, commenting, ACMG classification) must also trigger a summary refresh for these flags. Options:
- Mark summary stale and rebuild (simple, currently used pattern)
- Targeted UPDATE of the single affected row (faster, more complex)

---

### 2. Replace `COUNT(*) OVER()` with separate count query + caching

**Problem:** The window function `COUNT(*) OVER() AS _total_count` forces SQLite to materialize ALL matching rows before returning the first page. With broad filters on 200k rows, this doubles query time.

**Solution:** Split into two queries. Cache the count across page navigations (only recompute when filters change).

**Implementation:**

In `CohortService.getCohortVariants()`:
```typescript
getCohortVariants(params: CohortSearchParams): CohortPaginatedResult {
  // ... build whereClause, paramsArray as before ...

  // 1. Count query (only when filters change, not on page/sort change)
  let totalCount = 0
  if (params._count_needed !== false) {
    const countSql = `
      SELECT COUNT(*) as count
      FROM cohort_variant_summary cvs
      ${whereClause}
    `
    const countResult = this.db.prepare(countSql).get(...paramsArray) as { count: number }
    totalCount = countResult.count
  }

  // 2. Data query (no window function)
  const dataSql = `
    SELECT
      cvs.chr, cvs.pos, cvs.ref, cvs.alt, ...
    FROM cohort_variant_summary cvs
    ${whereClause}
    ${orderByClause}
    LIMIT ? OFFSET ?
  `
  const results = this.db.prepare(dataSql).all(...paramsArray, limit, offset)

  return { data: results, total_count: totalCount }
}
```

In `useCohortData.ts` — track whether filters changed vs just page/sort:
```typescript
// Cache count across page changes
let cachedCount = 0
let cachedFilterHash = ''

const fetchVariants = async (params) => {
  const filterHash = JSON.stringify({ /* filter params only, no offset/limit/sort */ })
  const filtersChanged = filterHash !== cachedFilterHash

  const result = await api.cohort.getVariants({
    ...params,
    _count_needed: filtersChanged
  })

  if (filtersChanged) {
    cachedCount = result.total_count
    cachedFilterHash = filterHash
  }
  totalCount.value = cachedCount
}
```

**Files to modify:**
- `src/main/database/cohort.ts` — split query, accept `_count_needed` param
- `src/shared/types/cohort.ts` — add `_count_needed` to `CohortSearchParams`
- `src/renderer/src/composables/useCohortData.ts` — filter change detection, count caching

---

### 3. Add missing `variant_key` index

**Problem:** `ORDER BY carrier_count DESC, variant_key ASC` — the tiebreaker column `variant_key` has no index, forcing a full sort of filtered results.

**Solution:** Add index in migration v14.

```sql
CREATE INDEX IF NOT EXISTS idx_cvs_variant_key
  ON cohort_variant_summary(variant_key);
```

**Files to modify:**
- `src/main/database/migrations.ts` — add to migration v14

---

## P1 — Medium Impact

### 4. Add `PRAGMA optimize=0x10002` on database open

**Problem:** Fresh connections lack query planner statistics. The planner may choose suboptimal indexes until the first `ANALYZE` runs.

**Solution:** Add to `DatabaseService` initialization, after PRAGMAs:
```typescript
db.pragma('optimize=0x10002')  // analyze all tables lacking stats
```

**Files to modify:**
- `src/main/database/DatabaseService.ts` — add after existing PRAGMAs

---

### 5. Pre-compute `cohort_frequency` in summary table

**Problem:** `CAST(carrier_count AS REAL) / totalCases` computed per-row at query time. The `cohort_frequency_min` filter uses this expression, preventing index usage.

**Solution:** Add `cohort_frequency REAL` column to `cohort_variant_summary`. Compute during rebuild. Add index.

```sql
-- Migration v14
ALTER TABLE cohort_variant_summary ADD COLUMN cohort_frequency REAL;

-- Rebuild SQL
..., CAST(COUNT(DISTINCT case_id) AS REAL) / (SELECT COUNT(*) FROM cases) AS cohort_frequency, ...

-- Index
CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq ON cohort_variant_summary(cohort_frequency);
```

**Caveat:** `cohort_frequency` changes whenever case count changes (not just when variants change). The rebuild already runs after import/delete, so this stays consistent. But a case deletion that doesn't trigger a full rebuild would leave stale frequencies — the staleness tracking already handles this.

**Files to modify:**
- `src/main/database/migrations.ts` — schema change in v14
- `src/shared/sql/cohort-summary-rebuild.ts` — add to SELECT
- `src/main/database/cohort.ts` — use column instead of expression

---

### 6. Incremental summary updates for single-case operations

**Problem:** Every import/delete rebuilds the entire summary (DELETE + INSERT 200k rows). For a single case, only ~1,500 variants change.

**Solution:** Add `incrementalAdd(caseId)` and `incrementalRemove(caseId)` to `CohortSummaryService`.

```sql
-- incrementalAdd: merge new case's variants into summary
INSERT INTO cohort_variant_summary (chr, pos, ref, alt, gene_symbol, ..., carrier_count, het_count, hom_count, variant_key)
SELECT
  chr, pos, ref, alt,
  MAX(gene_symbol), ...,
  1,  -- this case contributes 1 carrier
  SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
  SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
  chr || ':' || pos || ':' || ref || ':' || alt
FROM variants
WHERE case_id = ?
GROUP BY chr, pos, ref, alt
ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
  carrier_count = carrier_count + excluded.carrier_count,
  het_count = het_count + excluded.het_count,
  hom_count = hom_count + excluded.hom_count;
```

```sql
-- incrementalRemove: subtract a case's contribution
-- Step 1: Decrement counts
UPDATE cohort_variant_summary
SET carrier_count = carrier_count - sub.carrier_count,
    het_count = het_count - sub.het_count,
    hom_count = hom_count - sub.hom_count
FROM (
  SELECT chr, pos, ref, alt,
    COUNT(*) AS carrier_count,
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
  FROM variants WHERE case_id = ?
  GROUP BY chr, pos, ref, alt
) sub
WHERE cohort_variant_summary.chr = sub.chr
  AND cohort_variant_summary.pos = sub.pos
  AND cohort_variant_summary.ref = sub.ref
  AND cohort_variant_summary.alt = sub.alt;

-- Step 2: Remove variants with zero carriers
DELETE FROM cohort_variant_summary WHERE carrier_count <= 0;
```

**Keep full rebuild for:** bulk imports (>1 case), bulk deletes, manual trigger.

**Files to modify:**
- `src/main/database/CohortSummaryService.ts` — add `incrementalAdd()`, `incrementalRemove()`
- `src/shared/sql/cohort-summary-rebuild.ts` — add incremental SQL constants
- `src/main/workers/import-worker.ts` — use incremental for single-file imports
- `src/main/workers/delete-worker.ts` — use incremental for single-case deletes

---

### 7. Use `shallowRef` in Vue composable

**Problem:** `ref<CohortVariant[]>([])` deep-wraps every property of every variant object in Proxy. With 50 items x ~20 properties per page, this creates ~1,000 unnecessary Proxy objects on every fetch.

**Solution:** Replace `ref` with `shallowRef` for read-only data arrays.

```typescript
// useCohortData.ts
import { shallowRef } from 'vue'
const variants = shallowRef<CohortVariant[]>([])
// Assignment still triggers reactivity:
variants.value = result.data ?? []
```

Safe because: the cohort table never mutates individual variant properties — the entire array is replaced on each fetch.

**Files to modify:**
- `src/renderer/src/composables/useCohortData.ts` — change `ref` to `shallowRef` for `variants`

---

### 8. Add request generation counter for stale response discard

**Problem:** Rapid filter changes fire multiple IPC requests. Without cancellation, a slow older response can overwrite a fast newer response.

**Solution:** Add a generation counter to `fetchVariants`:

```typescript
let requestGeneration = 0

const fetchVariants = async (params) => {
  const thisGeneration = ++requestGeneration
  isLoading.value = true
  try {
    const result = await api.cohort.getVariants(params)
    if (thisGeneration !== requestGeneration) return  // stale, discard
    variants.value = result.data ?? []
    totalCount.value = result.total_count ?? 0
  } catch (err) {
    if (thisGeneration !== requestGeneration) return
    error.value = err instanceof Error ? err : new Error(String(err))
  } finally {
    if (thisGeneration === requestGeneration) {
      isLoading.value = false
    }
  }
}
```

**Files to modify:**
- `src/renderer/src/composables/useCohortData.ts`

---

## P2 — Lower Priority / Larger Effort

### 9. Keyset pagination for deep pages

**Problem:** `LIMIT 50 OFFSET 10000` scans and discards 10k rows. Degrades linearly.

**Solution:** Use cursor-based pagination: `WHERE variant_key > ? ORDER BY variant_key LIMIT 50`. Requires UI changes to support "next/prev" instead of arbitrary page jumps.

**Defer until:** users report slow deep-page navigation. With filters active, result sets are typically small enough that OFFSET is fine.

---

### 10. Covering indexes for common filter combinations

**Problem:** Dynamic filters create many WHERE clause combinations. Single-column indexes help but a covering index avoids table lookups entirely.

**Candidates:**
```sql
-- Most common: filter by consequence + gnomad_af, sort by carrier_count
CREATE INDEX idx_cvs_covering_common
  ON cohort_variant_summary(consequence, gnomad_af, carrier_count, variant_key);

-- Gene search + sort
CREATE INDEX idx_cvs_gene_covering
  ON cohort_variant_summary(gene_symbol, carrier_count, variant_key);
```

**Trade-off:** Each additional index slows down rebuilds. Monitor query patterns before adding.

---

### 11. Partial index for non-null gene_symbol

```sql
CREATE INDEX IF NOT EXISTS idx_cvs_gene_notnull
  ON cohort_variant_summary(gene_symbol)
  WHERE gene_symbol IS NOT NULL;
```

Saves ~30-50% index space by excluding intergenic variants.

---

### 12. Remove redundant `structuredClone()` before IPC

Electron IPC already uses V8 structured cloning. The explicit `structuredClone(buildIpcParams(...))` in the composable is a redundant serialization pass.

---

## Implementation Order

```
Phase 1 (P0 — do first, biggest wins):
  1.3  Add variant_key index (trivial, migration v14)
  1.1  Denormalize annotation flags (migration v14 + rebuild SQL + query simplification)
  1.2  Split COUNT from data query + cache count

Phase 2 (P1 — quick wins):
  2.4  PRAGMA optimize on open
  2.7  shallowRef in composable
  2.8  Request generation counter
  2.5  Pre-compute cohort_frequency

Phase 3 (P1 — moderate effort):
  2.6  Incremental summary updates

Phase 4 (P2 — defer):
  3.9   Keyset pagination
  3.10  Covering indexes
  3.11  Partial indexes
  3.12  Remove redundant structuredClone
```

## Research Sources

- [SQLite Query Optimizer](https://sqlite.org/optoverview.html) — confirms no de-correlation of correlated subqueries
- [SQLite Window Functions](https://sqlite.org/windowfunctions.html) — COUNT(*) OVER() materializes full result
- [SQLite ANALYZE / PRAGMA optimize](https://sqlite.org/lang_analyze.html) — 0x10002 flag for fresh connections
- [better-sqlite3 Performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — statement reuse patterns
- [GEMINI genomics tool](https://gemini.readthedocs.io/) — SQLite-based variant DB, uses pre-computed aggregates
- [VCFdbR](https://www.biorxiv.org/content/10.1101/2020.04.28.066894v1.full) — biobank-scale VCF in SQLite
- [GenomicSQLite](https://mlin.github.io/GenomicSQLite/) — genomic range indexing concepts
- [SQLite Triggers as Materialized Views](https://madflex.de/SQLite-triggers-as-replacement-for-a-materialized-view/)
- [Keyset Pagination](https://use-the-index-luke.com/no-offset) — O(1) vs O(n) pagination
- [Vue shallowRef](https://vuejs.org/api/reactivity-advanced.html#shallowref) — avoids deep proxying
- [Electron IPC V8 serialization](https://github.com/electron/electron/pull/20214) — structured clone is automatic
