# Cohort View Performance Optimization — Design Spec

**Date:** 2026-03-14
**Branch:** `feat/materialized-cohort-summary`
**Context:** ~350 cases, 500k+ variants, ~200k unique variants in summary table

## Problem

Cohort queries are getting slow as the dataset grows. The materialized summary tables (v13) eliminated live aggregation, but several per-query bottlenecks remain: correlated EXISTS subqueries for annotation filters, COUNT(*) OVER() forcing full materialization, computed expressions preventing index usage, and no protection against stale IPC responses in the renderer.

## Goals

1. Eliminate per-row correlated subqueries from cohort queries
2. Separate count from data queries to enable LIMIT early termination
3. Pre-compute filterable expressions into indexed columns
4. Add incremental summary updates for single-case operations
5. Improve renderer reactivity performance and request handling
6. Future-proof with targeted indexes for common filter patterns

## Non-Goals

- Keyset pagination (deferred until users report deep-page slowness)
- Full-text search on summary table (current LIKE-based search is adequate)
- Real-time summary updates during import (worker thread rebuild is fine)

---

## Phase 1 (P0): High Impact, Low Effort

### 1.1 Schema Changes — Migration v14

Add denormalized annotation flags, pre-computed frequency, and index to `cohort_variant_summary`:

```sql
-- Denormalized annotation flags
ALTER TABLE cohort_variant_summary ADD COLUMN has_star INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_variant_summary ADD COLUMN has_comment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_variant_summary ADD COLUMN acmg_best TEXT;

-- Pre-computed cohort frequency
ALTER TABLE cohort_variant_summary ADD COLUMN cohort_frequency REAL;

-- Index for frequency filter
CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq ON cohort_variant_summary(cohort_frequency);
```

**Note on variant_key index:** The standalone `idx_cvs_variant_key` index was removed from the design. `variant_key` is `chr || ':' || pos || ':' || ref || ':' || alt`, which is functionally equivalent to the existing PRIMARY KEY `(chr, pos, ref, alt)`. The ORDER BY tiebreaker should use the primary key columns directly: `ORDER BY chr, pos, ref, alt` instead of `ORDER BY variant_key`. The covering indexes in Phase 4 include sort columns as trailing entries where needed.

**Assumption:** Migrations run before service construction, so statement caches in `CohortService` will never hold stale schemas.

**Files:** `src/main/database/migrations.ts`

### 1.2 Single-Pass Rebuild with LEFT JOIN

Modify `REBUILD_VARIANT_SUMMARY_SQL` to populate annotation flags and cohort_frequency in the main INSERT using a LEFT JOIN against `variant_annotations`. This writes each row once instead of the two-pass approach (INSERT then UPDATE).

The LEFT JOIN runs against the ~200k grouped result rows (not the 500k raw variants). The annotation table's existing UNIQUE constraint on `(chr, pos, ref, alt)` provides the index for O(log N) lookups.

```sql
INSERT INTO cohort_variant_summary (
  chr, pos, ref, alt, gene_symbol, cdna, aa_change,
  consequence, func, clinvar, gnomad_af, cadd,
  transcript, omim_mim_number,
  carrier_count, het_count, hom_count,
  cohort_frequency, has_star, has_comment, acmg_best,
  variant_key
)
SELECT
  d.chr, d.pos, d.ref, d.alt,
  d.gene_symbol, d.cdna, d.aa_change,
  d.consequence, d.func, d.clinvar, d.gnomad_af, d.cadd,
  d.transcript, d.omim_mim_number,
  d.carrier_count, d.het_count, d.hom_count,
  CAST(d.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases),
  CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
  CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
  va.acmg_classification,
  d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt
FROM (
  WITH deduped AS (
    SELECT chr, pos, ref, alt, case_id,
      MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
      MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
      MAX(func) AS func, MAX(clinvar) AS clinvar,
      MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
      MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
      MAX(gt_num) AS gt_num
    FROM variants
    GROUP BY chr, pos, ref, alt, case_id
  )
  SELECT chr, pos, ref, alt,
    MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
    MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
    MAX(func) AS func, MAX(clinvar) AS clinvar,
    MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
    MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
    COUNT(*) AS carrier_count,
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
  FROM deduped
  GROUP BY chr, pos, ref, alt
) d
LEFT JOIN variant_annotations va
  ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt
```

Per-case annotations (`case_variant_annotations`) are handled by a second pass using UPDATE FROM (supported since SQLite 3.33.0, we have 3.51.x), since they require a JOIN through the `variants` table:

```sql
UPDATE cohort_variant_summary SET
  has_star = CASE WHEN has_star = 1 THEN 1 WHEN pca.has_star = 1 THEN 1 ELSE 0 END,
  has_comment = CASE WHEN has_comment = 1 THEN 1 WHEN pca.has_comment = 1 THEN 1 ELSE 0 END,
  acmg_best = CASE
    WHEN (SELECT MAX(rank) FROM (
      SELECT CASE acmg_best
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END AS rank
      UNION ALL
      SELECT CASE pca.acmg_best
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END
    )) = 5 THEN 'Pathogenic'
    WHEN (SELECT MAX(rank) FROM (...)) = 4 THEN 'Likely pathogenic'
    WHEN (SELECT MAX(rank) FROM (...)) = 3 THEN 'Uncertain significance'
    WHEN (SELECT MAX(rank) FROM (...)) = 2 THEN 'Likely benign'
    WHEN (SELECT MAX(rank) FROM (...)) = 1 THEN 'Benign'
    ELSE COALESCE(acmg_best, pca.acmg_best)
  END
FROM (
  SELECT v.chr, v.pos, v.ref, v.alt,
    MAX(cva.starred) AS has_star,
    MAX(CASE WHEN cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
      THEN 1 ELSE 0 END) AS has_comment,
    CASE MAX(CASE cva.acmg_classification
      WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
      WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
      WHEN 'Benign' THEN 1 ELSE 0 END)
      WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
      WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
      WHEN 1 THEN 'Benign' ELSE NULL
    END AS acmg_best
  FROM case_variant_annotations cva
  JOIN variants v ON cva.variant_id = v.id
  GROUP BY v.chr, v.pos, v.ref, v.alt
) pca
WHERE cohort_variant_summary.chr = pca.chr
  AND cohort_variant_summary.pos = pca.pos
  AND cohort_variant_summary.ref = pca.ref
  AND cohort_variant_summary.alt = pca.alt
```

**ACMG ranking**: Uses explicit numeric ranking (Pathogenic=5, Likely pathogenic=4, VUS=3, Likely benign=2, Benign=1). Alphabetical MIN/MAX is incorrect — "Benign" sorts first alphabetically, not "Pathogenic". The ranking merges global and per-case annotations, keeping the most pathogenic.

**Files:** `src/shared/sql/cohort-summary-rebuild.ts`

### 1.3 AFTER Triggers for Real-Time Annotation Sync

Create AFTER triggers on `variant_annotations` and `case_variant_annotations` to maintain denormalized flags when users star/comment/classify variants.

**Why triggers over application-level updates:**
- Atomic — trigger runs in the same transaction as the annotation write, crash-safe by default
- No forgotten code paths — any future code modifying annotations automatically updates the summary
- Sub-millisecond — single indexed lookup + single indexed row update (~100 microseconds)
- Idempotent recompute pattern — queries both tables from scratch, correct by construction

**Design principle: single canonical recompute.** All 6 triggers use the same recompute body — a full recompute from both annotation tables. This avoids duplicating the ACMG ranking logic with different INSERT/UPDATE/DELETE semantics and eliminates edge cases (e.g., DELETE trigger cannot reference NEW.*, UPDATE trigger needs post-update values). The recompute cost is negligible (~100 microseconds per trigger invocation via indexed lookups).

**Triggers needed (6 total):**

| Table | Event | Guard (WHEN clause) |
|-------|-------|---------------------|
| `variant_annotations` | AFTER INSERT | (none — always fire) |
| `variant_annotations` | AFTER UPDATE | `WHEN OLD.starred != NEW.starred OR OLD.global_comment IS NOT NEW.global_comment OR OLD.acmg_classification IS NOT NEW.acmg_classification` |
| `variant_annotations` | AFTER DELETE | (none — always fire) |
| `case_variant_annotations` | AFTER INSERT | (none — always fire) |
| `case_variant_annotations` | AFTER UPDATE | `WHEN OLD.starred != NEW.starred OR OLD.per_case_comment IS NOT NEW.per_case_comment OR OLD.acmg_classification IS NOT NEW.acmg_classification` |
| `case_variant_annotations` | AFTER DELETE | (none — always fire) |

UPDATE triggers have WHEN guards to skip no-op upserts. The `AnnotationRepository.upsertGlobalAnnotation()` uses `ON CONFLICT DO UPDATE` which fires AFTER UPDATE even when no column values actually change. The WHEN guard prevents unnecessary recomputation in that case. SQLite's `IS NOT` handles NULL comparisons correctly (unlike `!=` which returns NULL when either operand is NULL).

**Canonical recompute body** (shared by all 6 triggers — only the WHERE target differs):

```sql
UPDATE cohort_variant_summary SET
  has_star = (
    SELECT EXISTS(
      SELECT 1 FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
      AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
      AND va.starred = 1
    ) OR EXISTS(
      SELECT 1 FROM case_variant_annotations cva
      JOIN variants v ON cva.variant_id = v.id
      WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
      AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
      AND cva.starred = 1
    )
  ),
  has_comment = (
    SELECT EXISTS(
      SELECT 1 FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
      AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
      AND va.global_comment IS NOT NULL AND va.global_comment != ''
    ) OR EXISTS(
      SELECT 1 FROM case_variant_annotations cva
      JOIN variants v ON cva.variant_id = v.id
      WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
      AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
      AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
    )
  ),
  acmg_best = (
    SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
      WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
      WHEN 1 THEN 'Benign' ELSE NULL END
    FROM (
      SELECT CASE va.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END AS rank
      FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
      AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
      AND va.acmg_classification IS NOT NULL
      UNION ALL
      SELECT CASE cva.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END
      FROM case_variant_annotations cva
      JOIN variants v ON cva.variant_id = v.id
      WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
      AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
      AND cva.acmg_classification IS NOT NULL
    )
  )
WHERE chr = <target_chr> AND pos = <target_pos> AND ref = <target_ref> AND alt = <target_alt>;
```

**Trigger examples showing the three different target patterns:**

```sql
-- Global annotation INSERT: target from NEW.*
CREATE TRIGGER trg_va_after_insert
AFTER INSERT ON variant_annotations
FOR EACH ROW
BEGIN
  UPDATE cohort_variant_summary SET
    has_star = (...), has_comment = (...), acmg_best = (...)  -- canonical recompute
  WHERE chr = NEW.chr AND pos = NEW.pos AND ref = NEW.ref AND alt = NEW.alt;
END;

-- Global annotation DELETE: target from OLD.* (NEW does not exist in DELETE triggers)
CREATE TRIGGER trg_va_after_delete
AFTER DELETE ON variant_annotations
FOR EACH ROW
BEGIN
  UPDATE cohort_variant_summary SET
    has_star = (...), has_comment = (...), acmg_best = (...)  -- canonical recompute
  WHERE chr = OLD.chr AND pos = OLD.pos AND ref = OLD.ref AND alt = OLD.alt;
END;

-- Per-case annotation INSERT: resolve coordinates via variants table
CREATE TRIGGER trg_cva_after_insert
AFTER INSERT ON case_variant_annotations
FOR EACH ROW
BEGIN
  UPDATE cohort_variant_summary SET
    has_star = (...), has_comment = (...), acmg_best = (...)  -- canonical recompute
  WHERE (chr, pos, ref, alt) IN (
    SELECT chr, pos, ref, alt FROM variants WHERE id = NEW.variant_id
  );
END;
```

**Note on `IN` vs `=` for row-value comparison:** The `WHERE (chr, pos, ref, alt) IN (SELECT ...)` form safely handles the case where the variant has been deleted (subquery returns zero rows -> UPDATE affects nothing, which is correct since the summary row would also be gone via cascading delete or incremental remove).

**Worker thread safety:** Worker threads open independent SQLite connections. The triggers exist in the schema and fire in all connections. The delete worker currently drops only `variants_fts_*` triggers before bulk operations — the summary triggers are not affected.

**Files:** `src/main/database/migrations.ts` (triggers created in migration v14)

### 1.4 Query Simplification

Replace correlated EXISTS subqueries and computed expressions with simple column checks:

```typescript
// Annotation filters — was expensive per-row EXISTS subqueries
if (params.starred_only) whereConditions.push('cvs.has_star = 1')
if (params.has_comment) whereConditions.push('cvs.has_comment = 1')
if (params.acmg_classifications?.length) {
  const placeholders = params.acmg_classifications.map(() => '?').join(', ')
  whereConditions.push(`cvs.acmg_best IN (${placeholders})`)
  paramsArray.push(...params.acmg_classifications)
}

// Cohort frequency — was CAST(carrier_count AS REAL) / totalCases
whereConditions.push('cvs.cohort_frequency >= ?')
```

**cohort_frequency dual-source resolution:** Use the stored `cohort_frequency` column for WHERE filtering (it is indexed). Compute dynamically in the SELECT for display accuracy: `CAST(cvs.carrier_count AS REAL) / ${totalCases} AS cohort_frequency`. This gives the best of both worlds — indexed filtering + always-correct display value.

**ORDER BY tiebreaker change:** Replace `ORDER BY ${sortBy} ${direction}, variant_key ASC` with `ORDER BY ${sortBy} ${direction}, chr ASC, pos ASC, ref ASC, alt ASC`. This uses the primary key directly, eliminating the need for a separate `variant_key` index.

**Files:** `src/main/database/cohort.ts`

### 1.5 Split COUNT from Data Query

Remove `COUNT(*) OVER() AS _total_count` window function. Split into two queries with count caching.

```typescript
getCohortVariants(params: CohortSearchParams): CohortPaginatedResult {
  // ... build whereClause, paramsArray ...

  let totalCount = 0
  if (params._count_needed !== false) {
    const countSql = `SELECT COUNT(*) as count FROM cohort_variant_summary cvs ${whereClause}`
    totalCount = (this.db.prepare(countSql).get(...paramsArray) as { count: number }).count
  }

  const dataSql = `
    SELECT cvs.chr, cvs.pos, ...
      CAST(cvs.carrier_count AS REAL) / ${totalCases} AS cohort_frequency, ...
    FROM cohort_variant_summary cvs
    ${whereClause} ${orderByClause}
    LIMIT ? OFFSET ?
  `
  const results = this.db.prepare(dataSql).all(...paramsArray, limit, offset)
  return { data: results, total_count: totalCount }
}
```

**Why:** COUNT(*) OVER() forces SQLite to materialize ALL matching rows before returning the first page. Splitting allows LIMIT to terminate early on the data query.

**Files:** `src/main/database/cohort.ts`, `src/shared/types/cohort.ts` (add `_count_needed` to `CohortSearchParams`)

---

## Phase 2 (P1): Quick Wins

### 2.1 PRAGMA optimize on Database Open

Add to `DatabaseService` initialization after existing PRAGMAs:

```typescript
db.pragma('optimize=0x10002')
```

Flag `0x10002` = analyze all tables (not just queried ones) with a safety limit. Usually a no-op — only runs ANALYZE when stats are stale. Safe to call on every connection open.

**Files:** `src/main/database/DatabaseService.ts`

### 2.2 shallowRef for Variant Array

Replace `ref<CohortVariant[]>([])` with `shallowRef`. Vue docs explicitly recommend this for "performance optimizations of large data structures." The variant array is replaced wholesale on each fetch — never mutated in place — so shallowRef is safe.

```typescript
import { ref, shallowRef } from 'vue'
const variants = shallowRef<CohortVariant[]>([])
```

**Files:** `src/renderer/src/composables/useCohortData.ts`

### 2.3 Generation Counter for Stale Response Discard

Electron IPC can't be aborted. A generation counter prevents slow older responses from overwriting fast newer ones during rapid filter changes.

```typescript
let requestGeneration = 0

const fetchVariants = async (params: CohortQueryParams): Promise<void> => {
  const thisGeneration = ++requestGeneration
  isLoading.value = true
  error.value = null
  try {
    const result = await (api as any).cohort.getVariants(buildIpcParams(params))
    if (thisGeneration !== requestGeneration) return
    variants.value = result.data ?? []
    totalCount.value = result.total_count ?? 0
  } catch (err) {
    if (thisGeneration !== requestGeneration) return
    error.value = err instanceof Error ? err : new Error(String(err))
    variants.value = []
    totalCount.value = 0
  } finally {
    if (thisGeneration === requestGeneration) isLoading.value = false
  }
}
```

**Files:** `src/renderer/src/composables/useCohortData.ts`

### 2.4 Count Caching Across Page Changes

Track a filter hash to only recount when filters change, not on page/sort navigation:

```typescript
let cachedFilterHash = ''

// In fetchVariants:
const { offset, limit, sort_by, sort_order, ...filterParams } = params
const filterHash = JSON.stringify(filterParams)
const filtersChanged = filterHash !== cachedFilterHash
const ipcParams = buildIpcParams(params)
if (!filtersChanged) ipcParams._count_needed = false
// ... after fetch:
if (filtersChanged) cachedFilterHash = filterHash
```

**Files:** `src/renderer/src/composables/useCohortData.ts`

### 2.5 Remove Redundant structuredClone

Electron IPC already does V8 structured cloning. `buildIpcParams()` already spreads reactive arrays (`[...params.consequences]`) to strip Vue Proxies. The extra `globalThis.structuredClone()` is a redundant deep copy.

```typescript
// Before:
const plainParams = globalThis.structuredClone(buildIpcParams(params))
// After:
const plainParams = buildIpcParams(params)
```

**Dependency note:** The safety of this change relies on `buildIpcParams` continuing to spread arrays. If it ever stops spreading, Vue Proxies would reach the IPC boundary and fail. This is acceptable since `buildIpcParams` is in the same file and the spreading is intentional.

**Files:** `src/renderer/src/composables/useCohortData.ts`

---

## Phase 3 (P1): Moderate Effort

### 3.1 Incremental Summary Updates

Add `incrementalAdd(caseId)` and `incrementalRemove(caseId)` to `CohortSummaryService`. For single-case operations, update only the ~1,500 affected variants instead of rebuilding all 200k rows.

**incrementalAdd** uses UPSERT (`ON CONFLICT DO UPDATE`) to merge a new case's variants.

**incrementalRemove** uses UPDATE FROM to decrement counts, then `DELETE WHERE carrier_count <= 0` to clean up.

**Execution order for incrementalRemove:** Within the same transaction: (1) run `incrementalRemove(caseId)` which reads from `variants WHERE case_id = ?` to find affected coordinates and decrement counts, (2) then `DELETE FROM cases WHERE id = ?` which cascades to delete the variants via `ON DELETE CASCADE`. The incremental remove must execute first because the cascade immediately deletes the variants data it needs to read.

**When to use:**
- Single case import -> `incrementalAdd`
- Single case delete -> `incrementalRemove`
- Bulk operations, manual trigger -> full `rebuild()`

**cohort_frequency staleness:** Incremental ops recompute frequency for affected rows but leave unaffected rows with a stale denominator. The error is 1/n (<0.3% at 350 cases) — acceptable until next full rebuild. The WHERE clause uses the stored column for filtering, but the SELECT computes dynamically for display, so displayed values are always correct.

**Annotation flags:** The AFTER triggers handle annotation sync automatically. Freshly imported cases have no annotations, so default values (has_star=0, has_comment=0, acmg_best=NULL) are correct.

**Files:**
- `src/main/database/CohortSummaryService.ts` — add `incrementalAdd()`, `incrementalRemove()`
- `src/shared/sql/cohort-summary-rebuild.ts` — add incremental SQL constants
- `src/main/workers/import-worker.ts` — use incremental for single-file imports
- `src/main/workers/delete-worker.ts` — use incremental for single-case deletes

---

## Phase 4 (P2): Lower Priority / Larger Effort

### 4.1 Covering Indexes

Capped at 2-3 targeted composites for the most common filter patterns. Each additional index costs up to 5x on inserts during rebuild.

```sql
-- Most common: filter by consequence + gnomad_af, sort by carrier_count
CREATE INDEX IF NOT EXISTS idx_cvs_covering_common
  ON cohort_variant_summary(consequence, gnomad_af, carrier_count);

-- Gene search + sort
CREATE INDEX IF NOT EXISTS idx_cvs_gene_covering
  ON cohort_variant_summary(gene_symbol, carrier_count);
```

Column order follows "left to right, no skipping, stops at first range." Equality columns first, then range filter, then sort columns. Trailing `variant_key` column removed since the tiebreaker now uses the primary key directly.

### 4.2 Partial Index for Non-null gene_symbol

```sql
CREATE INDEX IF NOT EXISTS idx_cvs_gene_notnull
  ON cohort_variant_summary(gene_symbol)
  WHERE gene_symbol IS NOT NULL;
```

Saves ~30-50% index space by excluding intergenic variants. Query WHERE clause must match the index definition exactly for SQLite to use it.

### 4.3 Keyset Pagination (Deferred)

Not implemented in this work. Current OFFSET pagination is acceptable with filtered result sets. Implement when users report slow deep-page navigation (page 100+) on large cohorts.

**Files:** `src/main/database/migrations.ts` (indexes in migration v14 or v15)

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `src/main/database/migrations.ts` | Migration v14: schema changes, indexes, triggers |
| `src/shared/sql/cohort-summary-rebuild.ts` | Updated rebuild SQL with LEFT JOIN, annotation flags, cohort_frequency; incremental SQL constants |
| `src/main/database/cohort.ts` | Simplified WHERE clauses, split COUNT, use pre-computed columns, PK tiebreaker |
| `src/shared/types/cohort.ts` | Add `_count_needed` to `CohortSearchParams` |
| `src/main/database/CohortSummaryService.ts` | Add `incrementalAdd()`, `incrementalRemove()` |
| `src/main/database/DatabaseService.ts` | Add `PRAGMA optimize=0x10002` |
| `src/renderer/src/composables/useCohortData.ts` | shallowRef, generation counter, count caching, remove structuredClone |
| `src/main/workers/import-worker.ts` | Use incremental for single-case imports |
| `src/main/workers/delete-worker.ts` | Use incremental for single-case deletes |

## Testing Strategy

- Unit tests for migration v14 (schema changes, trigger behavior)
- Unit tests for incremental add/remove correctness
- Unit tests for ACMG ranking logic (verify Pathogenic > LP > VUS > LB > Benign)
- Integration tests for count caching (filter change vs page change)
- Trigger correctness tests: annotate variant -> verify summary flags update; rebuild -> verify flags preserved; delete annotation -> verify flags revert; delete case -> verify incremental remove + trigger interaction
- Existing cohort query tests updated for new column names

## Research Sources

- [SQLite Query Optimizer](https://sqlite.org/optoverview.html) — confirms no de-correlation of correlated subqueries
- [SQLite Window Functions](https://sqlite.org/windowfunctions.html) — COUNT(*) OVER() materializes full result
- [SQLite PRAGMA optimize](https://sqlite.org/pragma.html) — 0x10002 flag
- [SQLite UPDATE FROM](https://sqlite.org/lang_update.html) — supported since 3.33.0
- [SQLite CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html) — AFTER triggers, transaction semantics
- [SQLite Atomic Commit](https://sqlite.org/atomiccommit.html) — trigger + annotation write atomicity
- [ACMG/AMP 2015 Guidelines (PMC4544753)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) — 5-tier classification ordering
- [ClinVar Clinical Significance](https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/) — numeric classification codes
- [Vue shallowRef docs](https://vuejs.org/api/reactivity-advanced.html#shallowref) — recommended for large data structures
- [Vue Performance Guide](https://github.com/vuejs/docs/blob/main/src/guide/best-practices/performance.md) — shallowRef for immutable structures
- [Electron IPC V8 serialization](https://github.com/electron/electron/pull/20214) — structured clone is automatic
- [better-sqlite3 Performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL mode, statement reuse
- [PowerSync SQLite Optimizations](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance) — batch sizes, index trade-offs
- [Use The Index, Luke](https://use-the-index-luke.com/no-offset) — keyset pagination O(1) vs O(n)
- [Evan Schwartz: Subtleties of SQLite Indexes](https://emschwartz.me/subtleties-of-sqlite-indexes/) — composite index column order
- [Evan Schwartz: Short-Circuiting Correlated Subqueries](https://emschwartz.me/short-circuiting-correlated-subqueries-in-sqlite/) — EXISTS optimization
