# Materialized Cohort Summary Design

**Issue:** [#33 — perf: materialized cohort summary for faster aggregation queries](https://github.com/berntpopp/VarLens/issues/33)
**Date:** 2026-03-14

## Problem

Cohort queries (`getCohortVariants`, `getCohortSummary`, `getGeneBurden`) recompute aggregations from scratch on every request using a two-CTE GROUP BY across all variants. With 870 cases and ~6K variants per case (~5.2M rows), these queries are unacceptably slow.

## Solution Overview

Pre-compute two summary tables — `cohort_variant_summary` and `gene_burden_summary` — that are rebuilt after every data-changing operation (import/delete). Cohort queries read from the summary tables instead of aggregating live. The UI shows a staleness indicator during rebuilds and auto-refreshes when complete.

## Schema

### Migration v13

Three new tables, wrapped in a transaction:

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS cohort_variant_summary (
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  gene_symbol TEXT,
  cdna TEXT,
  aa_change TEXT,
  consequence TEXT,
  func TEXT,
  clinvar TEXT,
  gnomad_af REAL,
  cadd REAL,
  transcript TEXT,
  omim_mim_number TEXT,
  carrier_count INTEGER NOT NULL,
  het_count INTEGER NOT NULL,
  hom_count INTEGER NOT NULL,
  variant_key TEXT NOT NULL,
  PRIMARY KEY (chr, pos, ref, alt)
);

CREATE INDEX IF NOT EXISTS idx_cvs_gene ON cohort_variant_summary(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_cvs_carrier ON cohort_variant_summary(carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_filters ON cohort_variant_summary(gnomad_af, cadd);
CREATE INDEX IF NOT EXISTS idx_cvs_consequence ON cohort_variant_summary(consequence);

CREATE TABLE IF NOT EXISTS gene_burden_summary (
  gene_symbol TEXT PRIMARY KEY,
  variant_count INTEGER NOT NULL,
  unique_variant_count INTEGER NOT NULL,
  affected_case_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gbs_affected
  ON gene_burden_summary(affected_case_count DESC);

CREATE TABLE IF NOT EXISTS cohort_summary_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

COMMIT;
```

`cohort_summary_meta` stores `last_rebuilt_at` (epoch) and `is_stale` (`"0"` / `"1"`).

### Column naming conventions

The summary table stores columns using the raw `variants` table names (`cadd`, `omim_mim_number`). Queries must alias these for the `CohortVariant` type interface:
- `cadd AS cadd_phred`
- `omim_mim_number AS omim_id`

## Rebuild Logic

### CohortSummaryService

New class in `src/main/database/CohortSummaryService.ts`.

**`rebuild()` method** — single transaction rebuilding both tables:

```sql
BEGIN;

DELETE FROM cohort_variant_summary;
INSERT INTO cohort_variant_summary (
  chr, pos, ref, alt, gene_symbol, cdna, aa_change,
  consequence, func, clinvar, gnomad_af, cadd,
  transcript, omim_mim_number,
  carrier_count, het_count, hom_count, variant_key
)
SELECT
  chr, pos, ref, alt,
  MAX(gene_symbol), MAX(cdna), MAX(aa_change),
  MAX(consequence), MAX(func), MAX(clinvar),
  MAX(gnomad_af), MAX(cadd), MAX(transcript), MAX(omim_mim_number),
  COUNT(DISTINCT case_id),
  SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
  SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
  chr || ':' || pos || ':' || ref || ':' || alt
FROM variants
GROUP BY chr, pos, ref, alt;

DELETE FROM gene_burden_summary;
INSERT INTO gene_burden_summary (
  gene_symbol, variant_count, unique_variant_count,
  affected_case_count, updated_at
)
SELECT
  gene_symbol,
  COUNT(*) AS variant_count,
  COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) AS unique_variant_count,
  COUNT(DISTINCT case_id) AS affected_case_count,
  CAST(strftime('%s', 'now') AS INTEGER)
FROM variants
WHERE gene_symbol IS NOT NULL AND gene_symbol != ''
GROUP BY gene_symbol;

INSERT OR REPLACE INTO cohort_summary_meta (key, value)
VALUES ('last_rebuilt_at', CAST(strftime('%s', 'now') AS TEXT)),
       ('is_stale', '0');

COMMIT;

ANALYZE cohort_variant_summary;
ANALYZE gene_burden_summary;
```

**`markStale()` method** — sets `is_stale = '1'` in `cohort_summary_meta`.

**`getStatus()` method** — returns `{ is_stale: boolean, last_rebuilt_at: number }`.

### Known limitation: MAX() aggregation semantics

The rebuild uses `MAX(gene_symbol)`, `MAX(consequence)`, etc. to pick a single value when multiple cases carry the same variant with different annotations. `MAX()` picks the lexicographically largest value, which may not be the most clinically relevant (e.g., `synonymous_variant` > `missense_variant` alphabetically). This matches the current live query behavior in `getCohortVariants` (which also uses MAX in its deduped CTE) and is not a regression. A future improvement could use a priority-based selection for consequence severity.

### Rebuild uses `COUNT(DISTINCT case_id)` instead of the current two-CTE deduplication

The existing query uses a `deduped` CTE that GROUP BYs per (chr, pos, ref, alt, case_id) before counting. This was needed because a case might have duplicate variant rows for the same position. `COUNT(DISTINCT case_id)` achieves the same result in a single pass.

### Rebuild triggers

| Operation | Location | Action |
|---|---|---|
| Batch import complete | `import-worker.ts` | `markStale()` before import, `rebuild()` after FTS restore |
| Bulk delete complete | `delete-worker.ts` | `markStale()` before delete, `rebuild()` after FTS restore |
| Single case delete | `CaseRepository.deleteCase()` | `markStale()` only; rebuild deferred (see below) |

**Single case delete:** The main thread only calls `markStale()` after the delete and pushes `{ is_stale: true }` to the renderer. The actual rebuild is deferred to a short-lived worker thread to avoid blocking the Electron UI (a full rebuild can take 1-5 seconds). This uses the same worker thread pattern as the existing delete worker. The renderer shows the staleness indicator and auto-refreshes when the rebuild completes.

For bulk operations (import/delete), the rebuild runs on the same worker thread that performed the operation, before posting the `complete` message to the main thread.

WAL mode ensures the renderer can continue reading stale summary data during any rebuild.

## Query Rewrites

### `getCohortVariants`

**Before:** Two-CTE query aggregating from `variants` table with deduplication.

**After:** Flat SELECT from `cohort_variant_summary`:

```sql
SELECT
  cvs.chr, cvs.pos, cvs.ref, cvs.alt,
  cvs.gene_symbol, cvs.cdna, cvs.aa_change,
  cvs.carrier_count,
  :total_cases AS total_cases,
  CAST(cvs.carrier_count AS REAL) / :total_cases AS cohort_frequency,
  cvs.het_count, cvs.hom_count,
  cvs.variant_key,
  cvs.consequence, cvs.func, cvs.clinvar,
  cvs.gnomad_af,
  cvs.cadd AS cadd_phred,
  cvs.transcript,
  cvs.omim_mim_number AS omim_id,
  COUNT(*) OVER() AS _total_count
FROM cohort_variant_summary cvs
WHERE ...filters...
ORDER BY ...
LIMIT ? OFFSET ?
```

Changes:
- No `deduped` or `aggregated` CTEs
- `cohort_frequency` and `total_cases` computed at query time (not stored, since total_cases changes with every import/delete)
- HAVING filters (`carrier_count_min`, `cohort_frequency_min`) become WHERE conditions on pre-computed columns
- `AGGREGATE_COLUMNS` set and `filterHavingClause` logic removed
- Column aliases `cadd AS cadd_phred` and `omim_mim_number AS omim_id` match `CohortVariant` type

### Annotation filter rewrites

The current annotation filters use EXISTS subqueries referencing `variants.chr/pos/ref/alt` and `variants.id`. These must be rewritten for the summary table:

**`variant_annotations` (global — starred, ACMG, comments):** These join on chr/pos/ref/alt, which exist in the summary table. Just change the table alias:

```sql
-- starred_only
EXISTS (SELECT 1 FROM variant_annotations va
  WHERE va.chr = cvs.chr AND va.pos = cvs.pos
  AND va.ref = cvs.ref AND va.alt = cvs.alt AND va.starred = 1)

-- acmg_classifications
EXISTS (SELECT 1 FROM variant_annotations va
  WHERE va.chr = cvs.chr AND va.pos = cvs.pos
  AND va.ref = cvs.ref AND va.alt = cvs.alt
  AND va.acmg_classification IN (...))
```

**`case_variant_annotations` (per-case — starred, ACMG, comments):** These currently join on `cva.variant_id = variants.id`. Since the summary table has no `id`, these must join through `variants`:

```sql
-- starred_only (per-case)
EXISTS (SELECT 1 FROM variants v
  JOIN case_variant_annotations cva ON cva.variant_id = v.id
  WHERE v.chr = cvs.chr AND v.pos = cvs.pos
  AND v.ref = cvs.ref AND v.alt = cvs.alt AND cva.starred = 1)

-- acmg_classifications (per-case)
EXISTS (SELECT 1 FROM variants v
  JOIN case_variant_annotations cva ON cva.variant_id = v.id
  WHERE v.chr = cvs.chr AND v.pos = cvs.pos
  AND v.ref = cvs.ref AND v.alt = cvs.alt
  AND cva.acmg_classification IN (...))
```

These join back to the `variants` table but only for the subset of rows matching the annotation filter, which is typically very small (few starred/annotated variants). The existing index `idx_variants_chr_pos_ref_alt` supports this join efficiently.

### Search strategy change

The current FTS5 search operates on the `variants` table (5.2M rows) and returns rowids used in `id IN (SELECT rowid FROM variants_fts ...)`. Since the summary table has no `id` column mapping to variant rowids, FTS5 cannot be used directly.

**Replacement:** Use LIKE-based search on summary columns:
- Gene symbol: `gene_symbol LIKE '%term%'`
- Genomic position: `chr = ? AND pos = ?` (exact match, same as before)
- HGVS: `cdna LIKE '%term%' OR aa_change LIKE '%term%'`
- Consequence/OMIM: `consequence LIKE '%term%'` / `omim_mim_number LIKE '%term%'`

**Note on index usage:** LIKE patterns with a leading `%` wildcard (`'%term%'`) cannot use B-tree indexes — they result in a full table scan. At ~200K-500K rows in the summary table (vs 5.2M in variants), this is acceptable. The `idx_cvs_gene` index helps only for prefix matches (`gene_symbol LIKE 'BRCA%'`), not for infix matches. If search performance becomes a concern, a FTS5 table on the summary could be added as a future optimization.

The boolean search (`AND`/`OR`/`NOT`) rewrites from FTS5 MATCH to SQL LIKE with the same boolean logic.

### `getGeneBurden`

**Before:** GROUP BY on `variants` table.

**After:**
```sql
SELECT gene_symbol, variant_count, unique_variant_count,
  affected_case_count,
  (SELECT COUNT(*) FROM cases) AS total_cases
FROM gene_burden_summary
ORDER BY affected_case_count DESC, variant_count DESC
```

### `getCohortSummary`

Partial optimization — reads from summary where possible:
- `unique_variants`: `SELECT COUNT(*) FROM cohort_variant_summary`
- `genes_with_variants`: `SELECT COUNT(DISTINCT gene_symbol) FROM cohort_variant_summary WHERE gene_symbol IS NOT NULL`
- `total_cases`, `total_variants`, `starred_variants`, `acmg_counts`: unchanged (already fast, read from `cases` / `variant_annotations`)

## IPC and Renderer Integration

### New IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `cohort:summaryStatus` | renderer→main | Get `{ is_stale, last_rebuilt_at }` |
| `cohort:rebuildSummary` | renderer→main | Manual rebuild trigger |
| `cohort:summaryRebuilt` | main→renderer | Push event when rebuild completes or staleness changes |

### Renderer changes

**Cohort store** (Pinia):
- New `summaryStale: boolean` reactive state
- Listen for `cohort:summaryRebuilt` events via `window.api.on()`
- When `is_stale` flips from `true` to `false`, auto-refetch current cohort page

**UI indicator:**
- Subtle chip/spinner near cohort table header: "Updating cohort..." while stale
- Clears automatically when rebuild event arrives

**First load after migration:**
- If `cohort_variant_summary` is empty but `variants` has data, trigger immediate rebuild
- Show "Building cohort summary..." loading state instead of empty table

## What Does NOT Change

- `getCarriers()` — queries `variants` JOIN `cases` for a single variant, already fast
- Import/delete worker architecture — same worker threads, rebuild added at the end
- FTS5 on `variants` table — kept for per-case variant search, unaffected
- `CohortVariant` and `GeneBurden` type interfaces — unchanged

## Performance Expectations

| Operation | Before | After |
|---|---|---|
| Cohort variant query (page load) | Two-CTE GROUP BY over 5.2M rows | SELECT from ~300K row summary table |
| Gene burden query | GROUP BY over 5.2M rows | SELECT from ~15K row summary table |
| Summary rebuild (after import/delete) | N/A | ~1-5 seconds (one-time cost) |

## Future Optimization Path

If full rebuild becomes too slow at much larger scale (10K+ cases):
- **Incremental import:** `INSERT INTO summary...SELECT FROM variants WHERE case_id=? GROUP BY... ON CONFLICT DO UPDATE SET carrier_count = carrier_count + excluded.carrier_count`
- **Incremental delete:** Decrement counts for the deleted case's variants, remove zero-count rows
- This is significantly more complex and deferred until profiling justifies it

Other potential future improvements:
- **FTS5 on summary table:** If LIKE search becomes too slow, add a FTS5 virtual table on `cohort_variant_summary` columns, rebuilt alongside the summary
- **Priority-based MAX():** Replace lexicographic MAX for `consequence` with a severity-ordered selection
- **Composite pagination index:** Add covering index on common sort columns (e.g., `carrier_count DESC, variant_key ASC`) for deep pagination performance
