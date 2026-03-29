# Import Speed Optimization — Design Spec

**Date:** 2026-03-14
**Branch:** `fix/delete-worker-and-case-list-refresh`
**Baseline:** 517 variants/sec (50 files, 305K variants, 591s total)
**Target:** 1,500–2,000 variants/sec (3–4x improvement)

## Overview

Three categories of optimization applied to the import worker, delivered as a single PR:

1. **DB write optimizations** — pragma tuning, index management, batch size, FK bypass
2. **Single-pass format detection** — eliminate redundant file reads
3. **Pipeline parallelism** — overlap parsing of next file with insertion of current file

## 1. DB Write Optimizations

**Files:** `import-worker.ts`

### 1.1 Aggressive Pragma Settings

Replace current worker pragmas with bulk-import-optimized settings:

```sql
PRAGMA synchronous = OFF          -- Skip fsync (was NORMAL). OS crash risk accepted.
PRAGMA foreign_keys = OFF         -- Skip FK constraint checks (was ON)
PRAGMA cache_size = -64000        -- 64MB page cache (was -32000)
PRAGMA wal_autocheckpoint = 0     -- Defer WAL checkpoints until import completes
```

Unchanged: `journal_mode = WAL` (database-wide, cannot change while main app reads), `busy_timeout = 5000`, `temp_store = MEMORY`, `mmap_size = 268435456`.

**Why not `journal_mode = OFF`?** WAL mode is persistent and database-wide. Setting `journal_mode = OFF` on the worker connection silently fails (returns `wal`) when the main app already has the DB open in WAL mode. `synchronous = OFF` + `wal_autocheckpoint = 0` provides most of the same speed benefit while working correctly with concurrent readers.

### 1.2 Drop Non-Essential Indexes During Import

**Drop before import loop (9 indexes):**

```sql
-- From schema.ts
DROP INDEX IF EXISTS idx_variants_gene;
DROP INDEX IF EXISTS idx_variants_pos;
DROP INDEX IF EXISTS idx_variants_filters;
DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
DROP INDEX IF EXISTS idx_vt_selected;
DROP INDEX IF EXISTS idx_vt_transcript;
-- From migrations (migration 10)
DROP INDEX IF EXISTS idx_variants_filter_covering;
DROP INDEX IF EXISTS idx_variants_case_coords;
DROP INDEX IF EXISTS idx_variants_gene_notnull;
```

**Keep during import (2 indexes):**

- `idx_variants_case_id` — useful for delete-case cleanup
- `idx_vt_variant_id` — useful for cascade operations

**Recreate after import** in the `finally` block (idempotent `CREATE INDEX IF NOT EXISTS`). Note the partial index must include its `WHERE` clause:

```sql
CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
CREATE INDEX IF NOT EXISTS idx_variants_filter_covering ON variants(case_id, consequence, func, clinvar);
CREATE INDEX IF NOT EXISTS idx_variants_case_coords ON variants(case_id, chr, pos, ref, alt);
CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;
```

If the worker crashes, `initializeSchema()` recreates schema indexes on next app start. Migration indexes are recreated by the migration runner.

### 1.3 Increase Batch Size

Change default from 5,000 to 10,000 variants per transaction. Memory cost: ~5–6MB per batch, negligible for desktop.

### 1.4 Remove Redundant Existence Check

Remove `existsSync()` call before import — `createReadStream()` throws naturally if the file doesn't exist. Keep `statSync()` — it provides `fileSize` needed for the `insertCase` call.

### 1.5 Cleanup (finally block)

Always runs, even on crash/cancel:

```sql
-- Recreate all 9 dropped indexes (see 1.2 for full list)

-- Restore safe defaults
PRAGMA wal_checkpoint(TRUNCATE);    -- Block briefly to guarantee WAL is flushed and truncated
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA foreign_keys = ON;
```

**WAL growth note:** With `wal_autocheckpoint = 0`, the WAL file grows unbounded during import. For a 305K variant import, expect ~200–400MB WAL file. This temporarily degrades read performance for the main app connection (readers must scan more WAL frames). The post-import `TRUNCATE` checkpoint flushes and resets the WAL. If the main app holds an active read transaction at that moment, `TRUNCATE` will wait briefly — acceptable since import just finished.

**Estimated speedup:** 40–60% combined (synchronous=OFF dominates)

## 2. Single-Pass Format Detection

**Files:** `format-detection.ts`, `import-worker.ts`

### Problem

Each file is currently read twice: once by `detectFormat()` to identify the JSON structure, then again by `runImportPipeline()` for actual data extraction. Both passes decompress gzip and parse JSON.

### Solution

New function `detectAndCreatePipeline()`:

```typescript
async function detectAndCreatePipeline(filePath: string): Promise<{
  formatInfo: FormatInfo
  pipeline: Readable
}>
```

1. Open one decompressed stream + JSON parser
2. Collect top-level keys using `stream-json`'s token-level events (same logic as current `detectFormat`)
3. Once format is determined, dynamically attach the correct `pick()` + `streamArray()` filters to the **same parser** — the parser hasn't consumed data tokens yet, only structural keys
4. For `object` format: extract the first sample ID from the token stream before switching to variant extraction

**Stream reuse mechanism:** Use `stream-json`'s `filter`/`assembler` API at the token level rather than `pick()`. Format detection consumes only top-level key tokens (depth 1). Once the format is known, attach a token-level filter that selects the correct path (e.g., `variants.*` for simple, `samples.SAMPLE_ID.variants.*` for object). This avoids the need to replay bytes — the parser is stateful and continues from where detection left off.

**Columnar format limitation:** Columnar format inherently requires parsing the `header` array before processing `data` rows. The single-pass approach still eliminates the separate `detectFormat()` read, but `parseHeader()` will buffer the header from the detection stream rather than opening a third stream. Net benefit is smaller for columnar (~5–10%) vs simple/object formats (~15–20%).

**Fallback:** If format detection fails or the stream can't be reused, fall back to the current two-pass approach. The fallback triggers on any error during stream reconfiguration, not silently — if the token filter produces zero variants for a file that should have data, treat it as a failure and retry with two-pass.

**Estimated speedup:** 10–20% per file for simple/object formats; 5–10% for columnar

## 3. Pipeline Parallelism

**Files:** `import-worker.ts`

### Approach

Overlap parsing of file N+1 with insertion of file N using bounded async lookahead (one slot):

```
File 1:   [parse]──────[insert]──────
File 2:              [parse]──────[insert]──────
File 3:                           [parse]──────[insert]──────
```

### Implementation

Pre-parse the next file into an in-memory variant array (~6K variants ≈ 3MB) while the current file's batch inserts run. When the current file completes, the next file's parsed data is already available.

```typescript
let nextFileParsed: Promise<ParsedBatch> | null = null

for (let i = 0; i < files.length; i++) {
  if (i + 1 < files.length) {
    nextFileParsed = preParseFile(files[i + 1])
  }
  await insertVariants(currentParsedData)
  if (nextFileParsed) {
    currentParsedData = await nextFileParsed
    nextFileParsed = null
  }
}
```

### Edge Cases

- **Cancellation:** Pre-parse promise checks `isCancelled()` and aborts early. The underlying read stream must be explicitly destroyed (not left to drain) to avoid holding the file handle open. Buffered variants are discarded by GC.
- **Error handling:** Pre-parse failure is captured in the promise and surfaced when awaited — doesn't crash the current file's insert
- **Single file:** No benefit — only helps multi-file imports (2+ files)
- **Memory:** One extra file buffered (~3MB). Negligible for desktop.

**Estimated speedup:** 20–30% for multi-file imports

## Expected Results

| Scenario | Current | After All Phases |
|----------|---------|-----------------|
| Single file (6K variants) | 12s | 4–5s |
| 50 files (305K variants) | 591s (10 min) | 150–240s (2.5–4 min) |
| Throughput | 517 v/s | 1,500–2,000 v/s |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `synchronous = OFF` + OS crash = corrupt DB | Import worker uses own connection; user can re-import. Main app stays at NORMAL. Restored in `finally`. |
| Dropped indexes lost if worker crashes | `initializeSchema()` recreates on next app start. Also recreated in worker's `finally` block. |
| FK checks off allows invalid data | Import worker controls insert order (case -> variants -> transcripts). Restored in `finally`. |
| Single-pass stream reuse fails | Fallback to two-pass approach. |
| Pre-parse memory for large files | Bounded to one file (~3MB). Negligible for desktop. |

## Benchmarking

Use existing E2E benchmark (`tests/e2e/benchmark-import-delete.e2e.ts`) with 50 files from `/tmp/varlens-bench/`. Metrics:
- Total import time
- Average time per file
- Variants/sec throughput
- Slowest 5 files (outlier detection)

## Files Modified

| File | Changes |
|------|---------|
| `src/main/workers/import-worker.ts` | Pragma tuning, index drop/recreate, batch size, file check removal, pre-parse lookahead, cleanup block |
| `src/main/import/format-detection.ts` | New `detectAndCreatePipeline()` function |
| `src/shared/config/database.config.ts` | `BATCH_INSERT_SIZE: 10_000` |
