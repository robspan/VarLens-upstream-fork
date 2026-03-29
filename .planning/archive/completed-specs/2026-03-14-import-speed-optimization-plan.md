# Import Speed Optimization Plan

**Date:** 2026-03-14
**Status:** Proposed
**Baseline:** 517 variants/sec (50 files, 305K variants, 591s total, ~12s per file)
**Target:** 1,500–2,000 variants/sec (3–4x improvement)

## Current Bottleneck Analysis

Profiled against 50 real VarVis export files (`.json.gz`, ~6,000 variants each):

| Stage | % of Time | Duration (per file) | Notes |
|-------|-----------|-------------------|-------|
| **DB inserts** | 60–67% | ~7–8s | 18,000 SQL stmts per file (6K variants × ~3 stmts) |
| JSON parse + decompress | 18–25% | ~2–3s | stream-json, gzip |
| Field mapping | 8–12% | ~1–1.5s | Dictionary lookups, transcript extraction |
| FTS / overhead | 5–8% | ~0.5–1s | Already optimized (triggers dropped) |

**Root cause:** Each variant requires 1 `INSERT INTO variants` + ~2 `INSERT INTO variant_transcripts` statements, executed sequentially within a transaction. With 5 indexes on `variants` and 3 on `variant_transcripts`, each INSERT maintains all indexes in real-time.

## Optimizations (Ordered by Impact)

### Phase 1: DB Write Optimizations (est. 2–3x speedup)

These changes are all within `import-worker.ts` and require no schema or API changes.

#### 1A. Drop non-essential indexes during bulk import

Currently the worker drops FTS triggers but keeps all 8 indexes active during INSERT. Most indexes are only needed for query-time, not insert-time.

**Drop before import:**
```sql
DROP INDEX IF EXISTS idx_variants_gene;
DROP INDEX IF EXISTS idx_variants_pos;
DROP INDEX IF EXISTS idx_variants_filters;
DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
DROP INDEX IF EXISTS idx_vt_selected;
DROP INDEX IF EXISTS idx_vt_transcript;
```

**Keep during import (required for FK constraints):**
```sql
idx_variants_case_id    -- FK reference target
idx_vt_variant_id       -- FK reference target
```

**Recreate after all files imported:**
```sql
CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
-- ... etc
```

**Expected improvement:** 10–15% (fewer B-tree updates per INSERT)

**Risk:** Low. Indexes are `IF NOT EXISTS`, so idempotent recreation. If worker crashes mid-import, indexes are rebuilt on next app start via `initializeSchema()`.

#### 1B. Use `PRAGMA synchronous = OFF` during bulk import

Change from `NORMAL` to `OFF` in the import worker's `openDatabase()`. This tells SQLite to hand data to the OS without waiting for disk confirmation.

```typescript
// In import-worker.ts openDatabase()
db.pragma('synchronous = OFF')  // Only during bulk import
```

**Expected improvement:** 30–50% on write-heavy workloads. SQLite docs state "some operations are as much as 50 or more times faster with synchronous OFF".

**Risk:** If the OS crashes or power is lost during import, the database could corrupt. This is acceptable for an import operation because:
- The user can re-import if it fails
- Only the import worker uses this setting, not the main app connection
- Desktop apps rarely experience unclean shutdowns

#### 1C. Use `PRAGMA journal_mode = OFF` during bulk import

Since the import worker has its own connection and we accept crash risk:

```typescript
db.pragma('journal_mode = OFF')  // No rollback journal overhead
```

**Expected improvement:** 10–20% (eliminates journal I/O)

**Risk:** Same as 1B — no crash recovery for the import. Acceptable.

**Alternative:** Keep WAL but use `PRAGMA wal_autocheckpoint = 0` to defer checkpoints until import completes.

#### 1D. Increase batch size from 5,000 to 10,000

Larger transactions amortize the per-transaction overhead (commit, fsync) over more rows.

```typescript
const batchSize = msg.batchSize ?? 10_000  // was 5,000
```

**Expected improvement:** 5–10%

**Risk:** ~2x memory per batch (~5–6 MB), negligible for a desktop app.

### Phase 2: Eliminate Redundant I/O (est. 10–20% speedup)

#### 2A. Combine format detection with parsing

Currently each file is read twice:
1. `detectFormat()` — streams through gzip → JSON parser to identify top-level keys
2. `runImportPipeline()` — streams through gzip → JSON parser again for actual data

**Fix:** Detect format from the first few tokens of the parse stream, then continue parsing the same stream for data. This requires refactoring `detectFormat` to return the in-progress stream instead of closing it.

```typescript
// New approach: detect + parse in single pass
async function detectAndCreatePipeline(filePath: string): Promise<{
  formatInfo: FormatInfo
  stream: Readable  // Already positioned past the format-detection tokens
}> { ... }
```

**Expected improvement:** 10–20% per file (eliminates full re-read + re-decompress)

**Risk:** Medium. Requires careful stream lifecycle management. Format detection must not consume data tokens needed by the pipeline.

#### 2B. Pre-parse file list for format detection

Before the main import loop, detect all file formats in parallel using `Promise.all()`. This overlaps I/O with the sequential import.

```typescript
// Before main loop
const formats = await Promise.all(
  msg.files.map(f => detectFormat(f.filePath))
)

// During import, use cached format
const formatInfo = formats[fileIndex]
```

**Expected improvement:** Removes ~200–500ms per file from the critical path.

**Risk:** Low. Read-only operation.

### Phase 3: Pipeline Parallelism (est. 20–30% speedup on multi-file imports)

#### 3A. Overlap parsing with insertion

Use a producer-consumer pattern where one "thread" (async generator) reads and parses the next file while the current file's variants are being inserted into SQLite.

```
File N:   [parse]──────[insert]──────
File N+1:              [parse]──────[insert]──────
File N+2:                           [parse]──────[insert]──────
```

**Implementation:** Use a bounded async queue. The import loop pre-parses the next file into a variant buffer (up to 1 batch worth) while the current batch is being inserted.

**Expected improvement:** 20–30% for multi-file imports (overlaps I/O-bound parsing with CPU/disk-bound insertion).

**Risk:** Medium. Increases memory usage (buffering next file's variants). Adds complexity to cancel and error handling.

#### 3B. Parallel file parsing with worker pool (future)

Spawn 2–3 parse workers that read/decompress/parse files into variant arrays, feeding a single insert worker. This maximizes I/O throughput on multi-core machines.

**Not recommended now:** Adds significant complexity. Phase 1+2 should achieve the target throughput.

### Phase 4: Minor Optimizations

#### 4A. Skip `existsSync` + `statSync` for each file

Currently each file does `existsSync(file.filePath)` and `statSync(file.filePath)` before import. The `createReadStream` will throw if the file doesn't exist, so these are redundant.

#### 4B. Use `PRAGMA cache_size = -64000` (64 MB)

Double the cache for the import worker. More pages in memory = fewer disk reads during index updates.

#### 4C. Disable foreign key checks during bulk import

```typescript
db.pragma('foreign_keys = OFF')  // Only in import worker
```

Eliminates FK constraint checking on every INSERT. Safe because the import worker controls the data flow and always inserts cases before their variants.

**Expected improvement:** 5–10%

## Implementation Order

| Step | Change | Est. Speedup | Files Modified |
|------|--------|-------------|----------------|
| 1 | Drop indexes during import | 10–15% | `import-worker.ts` |
| 2 | `synchronous = OFF` + `journal_mode = OFF` | 30–50% | `import-worker.ts` |
| 3 | Disable FK checks during import | 5–10% | `import-worker.ts` |
| 4 | Batch size 5K → 10K | 5–10% | `import-worker.ts`, `database.config.ts` |
| 5 | Pre-parse file formats | ~200ms/file | `import-worker.ts` |
| 6 | Combine detect + parse (single read) | 10–20% | `format-detection.ts`, `import-worker.ts` |
| 7 | Pipeline parallelism (overlap parse/insert) | 20–30% | `import-worker.ts` |

Steps 1–4 are all in `import-worker.ts` and can be done in a single PR. Steps 5–7 are progressively more complex.

## Expected Results

| Scenario | Current | After Phase 1 | After Phase 1+2 |
|----------|---------|---------------|-----------------|
| Single file (6K variants) | 12s | 5–6s | 4–5s |
| 50 files (305K variants) | 591s (10 min) | 240–300s (4–5 min) | 180–240s (3–4 min) |
| Throughput | 517 v/s | 1,200–1,500 v/s | 1,500–2,000 v/s |

## Benchmarking

Use the existing E2E benchmark test (`tests/e2e/benchmark-import-delete.e2e.ts`) with 50 files from `/tmp/varlens-bench/` to measure before/after. Key metrics:
- Total import time
- Average time per file
- Variants/sec throughput
- Slowest 5 files (detect outliers)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `synchronous = OFF` + crash = corrupt DB | Import worker uses its own connection; user can re-import. Main app connection stays at `NORMAL`. |
| Dropped indexes lost if worker crashes | `initializeSchema()` recreates all indexes on next app start. Also add explicit index recreation in worker's `finally` block. |
| FK checks off allows invalid data | Import worker controls the insert order (case → variants → transcripts). Data integrity is guaranteed by the pipeline, not the DB constraint. |
| Larger batch size uses more memory | 10K variants ≈ 5–6 MB. Negligible for desktop. |
