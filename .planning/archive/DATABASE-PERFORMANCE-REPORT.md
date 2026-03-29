# VarLens Database Performance Report

## Current Architecture Summary

- **Engine**: SQLite via `better-sqlite3-multiple-ciphers` (synchronous, encrypted)
- **Mode**: WAL journal, foreign keys enabled
- **Schema**: ~15 tables + 1 FTS5 virtual table, 3 migration versions
- **Import**: Streaming JSON/gzip → batch insert (5000 rows/transaction)
- **Query**: Dynamic WHERE builder, cursor pagination, FTS5 hybrid search
- **Caching**: Prepared statement cache, API response cache (`api_cache` table)

---

## 1. Missing Performance PRAGMAs

**Current** (`DatabaseService.ts`): Only `journal_mode=WAL` and `foreign_keys=ON`.

**Recommended additions** (safe for desktop, significant impact):

```sql
PRAGMA synchronous = NORMAL;     -- safe with WAL; skips fsync on most writes (~2-5x write speedup)
PRAGMA busy_timeout = 5000;      -- retry on SQLITE_BUSY instead of failing immediately
PRAGMA cache_size = -32000;      -- 32 MB page cache (default is ~2 MB)
PRAGMA temp_store = MEMORY;      -- temp tables/indexes in RAM
PRAGMA mmap_size = 268435456;    -- 256 MB memory-mapped I/O for faster reads
```

**On connection close:**

```sql
PRAGMA optimize;                 -- auto-ANALYZE tables that need it
```

**Impact**: Write throughput improves 2-5x from `synchronous=NORMAL` alone. Read-heavy queries (variant browsing, cohort aggregation) benefit from larger cache and mmap.

**PostgreSQL parity**: These are SQLite-specific; PostgreSQL has its own tuning knobs (`shared_buffers`, `work_mem`, etc.). Abstract behind a `configurePragmas()` method per engine.

---

## 2. Index Improvements

### 2.1 Missing Indexes

| Table | Proposed Index | Justification |
|-------|---------------|---------------|
| `variants` | `(case_id, chr, pos, ref, alt)` | `getAnnotationsForVariant` looks up by all 5 columns; current `idx_variants_chr_pos_ref_alt` lacks `case_id` |
| `variant_annotations` | `(acmg_classification)` | Cohort summary groups by `acmg_classification`; currently full table scan |
| `variants` | `(case_id, consequence)` | `getFilterOptions` runs `SELECT DISTINCT consequence WHERE case_id=?` on every filter panel open |
| `variants` | `(case_id, func)` | Same reason as above for func filter options |
| `variants` | `(case_id, clinvar)` | Same reason for clinvar filter options |
| `variants` | `(gene_symbol) WHERE gene_symbol IS NOT NULL` | Partial index for `getGeneBurden` — smaller, faster |

### 2.2 Covering Indexes for Hot Queries

The filter options queries (`variants:filterOptions` IPC) run 6 separate `SELECT DISTINCT` queries. A composite covering index avoids touching the main table:

```sql
CREATE INDEX idx_variants_filter_options
  ON variants(case_id, consequence, func, clinvar);
```

This single index covers all three `DISTINCT` queries for a given `case_id`.

### 2.3 Expression Index for Cohort Variant Key

`getGeneBurden` uses `COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt)` — this string concatenation can't use indexes. Options:
- Pre-compute a `variant_key` column (denormalize), or
- Use `COUNT(DISTINCT chr, pos, ref, alt)` which SQLite doesn't support — but grouping by the 4 columns in a subquery achieves the same effect more efficiently.

---

## 3. Cohort Query Optimization

### 3.1 Duplicate COUNT Query

`getCohortVariants` (cohort.ts:270-282) re-runs the entire CTE + GROUP BY + HAVING just to get a total count. For large cohorts this doubles query time.

**Fix**: Use a single query with `COUNT(*) OVER()` window function:

```sql
WITH deduped AS (...)
SELECT *, COUNT(*) OVER() as total_count
FROM (
  SELECT chr, pos, ref, alt, COUNT(*) as carrier_count, ...
  FROM deduped GROUP BY chr, pos, ref, alt
  HAVING ...
) sub
ORDER BY ... LIMIT ? OFFSET ?
```

This returns total count as a column on every row, eliminating the second query. Both SQLite (3.25+) and PostgreSQL support window functions.

### 3.2 OFFSET Pagination → Cursor Pagination

Cohort queries use `LIMIT ? OFFSET ?` which degrades as offset grows (SQLite must scan and discard all skipped rows). The variant queries already use cursor-based pagination — apply the same pattern to cohort queries.

### 3.3 MAX() for Representative Values

`getCohortVariants` uses `MAX(gene_symbol)`, `MAX(consequence)`, etc. to pick one value from deduplicated rows. This is semantically arbitrary.

**Better approach**: Rank consequences by clinical severity and pick the most impactful. This could use a CASE expression or a severity lookup table, which also works in PostgreSQL.

### 3.4 EXISTS Subqueries in Filters

Annotation filters use `EXISTS (SELECT 1 FROM variant_annotations WHERE chr=v.chr AND pos=v.pos ...)`. The `variant_annotations` table already has `idx_variant_annotations_coords` on `(chr, pos, ref, alt)` — this should be efficient. Verify with `EXPLAIN QUERY PLAN`.

---

## 4. Bulk Import Optimization

### 4.1 Current Pipeline

```
ReadStream → Gunzip → JSON Parser → StreamArray → FieldMapper → BatchAccumulator(5000) → DB Transaction
```

This is well-designed. Streaming prevents memory blowup.

### 4.2 Triple-Scan for Columnar Format

The columnar format currently:
1. Scans to detect format (ImportService.ts:92-176)
2. Scans to extract data dictionaries (ColumnarStrategy.ts:80-172)
3. Scans to stream actual data rows

**Fix**: Cache dictionaries during format detection pass. Saves one full file read (~33% import time reduction for this format).

### 4.3 FTS5 Trigger Overhead During Import

Every variant INSERT fires an FTS5 trigger (schema.ts:106-123). For large imports (100k+ variants), this adds significant overhead.

**Fix**: Defer FTS rebuild:
1. Drop FTS triggers before bulk import
2. Insert all variants
3. Rebuild FTS index: `INSERT INTO variants_fts(variants_fts) VALUES('rebuild')`
4. Re-create triggers

This is a well-known SQLite optimization that can speed up bulk inserts by 30-50%.

**PostgreSQL parity**: PostgreSQL full-text search (`tsvector`) has the same pattern — bulk load first, then `CREATE INDEX CONCURRENTLY`.

### 4.4 Batch Size Tuning

Current batch size of 5000 is reasonable. For this schema width (~20 columns + transcript sub-rows), benchmarking suggests the sweet spot is 2000-10000. Consider making it configurable or auto-tuning based on column count.

### 4.5 IMMEDIATE Transactions

`db.transaction()` defaults to `BEGIN DEFERRED`. For write transactions, use `db.transaction(fn).immediate()` to acquire a write lock immediately, avoiding potential upgrade deadlocks under concurrent IPC operations.

---

## 5. Query Engine Improvements

### 5.1 Run ANALYZE After Import

After each case import, run `ANALYZE` (or `PRAGMA optimize`) so the query planner has accurate statistics for the new data distribution. Without this, SQLite may choose suboptimal query plans for the newly imported case.

### 5.2 Prepared Statement Cache Eviction

Both `DatabaseService` and `CohortService` cache prepared statements in a `Map<string, Statement>` with no eviction. For dynamic queries (varying filter combinations), this can grow unbounded.

**Fix**: Use an LRU cache with a max size (e.g., 100 entries), or clear the cache periodically. This matters more for long-running sessions.

### 5.3 FTS5 Search + JOIN Performance

Current pattern (DatabaseService.ts:885-902):
```sql
SELECT v.* FROM variants v
JOIN variants_fts fts ON v.id = fts.rowid
WHERE v.case_id = ? AND variants_fts MATCH ?
```

**Better pattern**: Query FTS first, then filter:
```sql
SELECT * FROM variants
WHERE id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)
  AND case_id = ?
```

SQLite optimizes `IN (SELECT ...)` with FTS5 better than JOINs. Benchmark both.

### 5.4 LIKE Queries for Column Filters

Per-column text filters use `CAST(column AS TEXT) LIKE ? COLLATE NOCASE` (DatabaseService.ts:817). The `CAST()` prevents index usage.

**Fix**: For columns that are already TEXT (gene_symbol, consequence, etc.), skip the CAST. Only CAST for numeric columns. This allows index-assisted LIKE for prefix patterns.

---

## 6. Database Maintenance

### 6.1 Auto-Vacuum

Currently no auto-vacuum configured. After deleting cases (which cascade-deletes thousands of variants), the database file doesn't shrink.

**Recommendation**:
```sql
PRAGMA auto_vacuum = INCREMENTAL;  -- set at DB creation only
```

Then run `PRAGMA incremental_vacuum(200)` at app startup to gradually reclaim space. Offer a "Compact Database" option in settings that runs full `VACUUM`.

**Note**: `auto_vacuum` must be set before any tables are created. Add to database creation flow, not to existing databases (those need a full `VACUUM` to switch modes).

### 6.2 FTS5 Index Optimization

After significant data changes (import/delete), run:
```sql
INSERT INTO variants_fts(variants_fts) VALUES('optimize');
```

This merges FTS index segments for faster queries. Don't run after every small change — schedule after imports or case deletions.

### 6.3 Cache Cleanup

The `api_cache` table has `expires_at` but cleanup only happens on explicit call. Add periodic cleanup (e.g., on app startup):
```sql
DELETE FROM api_cache WHERE expires_at <= unixepoch();
```

---

## 7. PostgreSQL Migration Path

### 7.1 Already Compatible Features

These patterns used in VarLens work in both SQLite and PostgreSQL:

- CTEs (`WITH ... AS`)
- `ON CONFLICT ... DO UPDATE` (UPSERT)
- `RETURNING *`
- Window functions (if adopted per recommendation 3.1)
- Parameterized queries with `?` (needs adapter, see below)
- JOINs, subqueries, GROUP BY, HAVING, ORDER BY

### 7.2 Incompatibilities to Address

| Feature | Current (SQLite) | PostgreSQL Equivalent | Migration Effort |
|---------|-----------------|----------------------|-----------------|
| Parameter placeholders | `?` | `$1, $2, ...` | Query builder or adapter |
| Auto-increment PK | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL` or `GENERATED ALWAYS AS IDENTITY` | Schema abstraction |
| Boolean columns | `INTEGER` (0/1) | Native `BOOLEAN` | Type mapping |
| Timestamps | `INTEGER` (unix epoch) | `TIMESTAMP WITH TIME ZONE` | Type mapping |
| LIKE case sensitivity | Case-insensitive (ASCII) | Case-sensitive; use `ILIKE` | Query abstraction |
| `group_concat()` | SQLite built-in | `string_agg()` | Function mapping |
| FTS5 | Virtual table + MATCH | `tsvector`/`tsquery` + `@@` | Full rewrite of search |
| `PRAGMA` statements | SQLite-specific | PostgreSQL `SET` / config | Engine-specific init |
| `CAST(x AS TEXT) LIKE` | Works | Works but use `::text` | Minor |

### 7.3 Recommended Abstraction Strategy

**Repository Pattern** with engine-specific implementations:

```typescript
interface VariantRepository {
  insert(variants: Variant[]): void
  query(filters: VariantFilter): PaginatedResult<Variant>
  search(term: string, caseId: number): Variant[]
}

class SqliteVariantRepository implements VariantRepository { ... }
class PostgresVariantRepository implements VariantRepository { ... }
```

**Why not a query builder (Knex/Kysely)?**
- Cohort CTE queries are too complex for most query builders
- FTS5 vs tsvector requires completely different query patterns
- Repository pattern gives full control per engine

**Start now**:
1. Extract `DatabaseService` methods into repository interfaces
2. Keep SQLite implementation as-is
3. Add PostgreSQL implementation when needed
4. Use a factory to select the right implementation

### 7.4 Schema Abstraction

Create a schema definition format that generates DDL for both engines:

```typescript
const variantsTable = {
  name: 'variants',
  columns: {
    id: { type: 'serial_pk' },           // → INTEGER PRIMARY KEY / SERIAL
    case_id: { type: 'integer', fk: 'cases.id', onDelete: 'CASCADE' },
    chr: { type: 'text', nullable: false },
    created_at: { type: 'timestamp' },     // → INTEGER / TIMESTAMPTZ
  }
}
```

This avoids maintaining two separate schema files.

---

## 8. Architecture Improvements

### 8.1 Read/Write Connection Separation

In WAL mode, reads don't block writes. Consider opening a separate read-only connection for query operations:

```typescript
this.writeDb = new Database(dbPath)
this.readDb = new Database(dbPath, { readonly: true })
```

This prevents long-running cohort aggregations from blocking variant imports. Both SQLite and PostgreSQL support this pattern.

### 8.2 Materialized Views for Cohort Data

Cohort queries (carrier counts, gene burden, frequency) are expensive and computed on every request. Consider:

1. **Materialized summary table** refreshed on case import/delete:
   ```sql
   CREATE TABLE cohort_variant_summary (
     chr TEXT, pos INTEGER, ref TEXT, alt TEXT,
     carrier_count INTEGER, het_count INTEGER, hom_count INTEGER,
     cohort_frequency REAL, gene_symbol TEXT,
     updated_at INTEGER
   );
   ```

2. **Refresh trigger**: After import completes or case deleted, rebuild summary.

3. **PostgreSQL parity**: PostgreSQL has native `MATERIALIZED VIEW` with `REFRESH MATERIALIZED VIEW CONCURRENTLY`. SQLite version is a manual table.

**Trade-off**: Faster reads, slower writes. Appropriate if cohort view is accessed frequently.

### 8.3 Denormalized Variant Key Column

Multiple queries construct `chr || ':' || pos || ':' || ref || ':' || alt` for grouping/deduplication. Add a computed column:

```sql
ALTER TABLE variants ADD COLUMN variant_key TEXT
  GENERATED ALWAYS AS (chr || ':' || pos || ':' || ref || ':' || alt) STORED;
CREATE INDEX idx_variants_key ON variants(variant_key);
```

SQLite supports generated columns (3.31+). PostgreSQL supports them too. This eliminates repeated string concatenation in queries.

### 8.4 Batch Delete Optimization

`deleteCasesBatch` builds dynamic `IN (...)` SQL (DatabaseService.ts:297). For large batches, this can exceed SQLite limits.

**Fix**: Use a temp table for batch operations:
```sql
CREATE TEMP TABLE ids_to_delete (id INTEGER);
-- Insert IDs
DELETE FROM cases WHERE id IN (SELECT id FROM ids_to_delete);
DROP TABLE ids_to_delete;
```

Works identically in PostgreSQL.

---

## 9. Priority Ranking

| # | Improvement | Effort | Impact | PG Parity |
|---|------------|--------|--------|-----------|
| 1 | Add performance PRAGMAs | Low | High | N/A |
| 2 | Add missing indexes (§2.1) | Low | High | Yes |
| 3 | Run ANALYZE after import | Low | Medium | Yes |
| 4 | Defer FTS rebuild during import | Medium | High | Yes |
| 5 | Window function for cohort count | Medium | High | Yes |
| 6 | Cursor pagination for cohort | Medium | Medium | Yes |
| 7 | Repository pattern extraction | High | N/A | Critical |
| 8 | Read/write connection split | Low | Medium | Yes |
| 9 | Auto-vacuum configuration | Low | Medium | N/A |
| 10 | Materialized cohort summary | High | High | Yes |
| 11 | Generated variant_key column | Low | Medium | Yes |
| 12 | Cache columnar dictionaries | Medium | Medium | N/A |
| 13 | FTS5 optimize after import | Low | Low | Yes |
| 14 | Prepared statement LRU cache | Low | Low | Yes |
| 15 | IMMEDIATE transactions | Low | Low | N/A |

---

## 10. Quick Wins Checklist

These can be implemented in a single session with high confidence:

- [ ] Add 5 performance PRAGMAs to `DatabaseService` constructor
- [ ] Add `PRAGMA optimize` to `close()` method
- [ ] Add covering index for filter options queries
- [ ] Add `(case_id, chr, pos, ref, alt)` composite index
- [ ] Run `ANALYZE` after `insertVariantsBatch` completes
- [ ] Add FTS5 `optimize` call after import
- [ ] Add `busy_timeout` PRAGMA
- [ ] Clean up expired API cache on startup
- [ ] Remove `CAST()` from TEXT column LIKE filters
