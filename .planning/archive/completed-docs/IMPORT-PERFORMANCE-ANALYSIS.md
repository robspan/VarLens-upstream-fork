# Import Performance Analysis & Optimization Report

**Date:** 2026-03-13
**Scope:** Batch import of variant files (e.g. `C:\development\agde-analyses\data\varvis_cache` with 53+ files)

## Executive Summary

The batch import system has **three critical issues**: (1) complete UI blocking caused by synchronous SQLite operations on the main Electron thread, (2) a progress reporting bug where file-level and batch-level progress events overwrite each other, and (3) massive per-file overhead from repeated FTS rebuilds and unprepared SQL statements. Together these cause the "keine Rückmeldung" (not responding) behavior, progress jumping back from e.g. 20/53 to 1/53, and slow imports.

---

## Issue 1: App Blocking ("keine Rückmeldung")

### Root Cause: Synchronous SQLite on Main Thread

**Severity: CRITICAL**

`better-sqlite3` is a **synchronous** C++ addon. Every database call blocks the Node.js event loop. The import pipeline calls `insertVariantsBatch()` from a `Transform` stream's `_transform()` method, which runs on the **main Electron process thread**.

**Call chain:**

```
BatchAccumulator._transform()           ← called by stream pipeline
  → this.flushBatch()                   ← sync
    → this.db.variants.insertVariantsBatch()  ← sync, blocks event loop
      → DROP FTS triggers                ← sync
      → for each 5000-variant chunk:
        → BEGIN TRANSACTION              ← sync
        → for each variant:
          → Kysely.compile()             ← sync (CPU-bound)
          → db.prepare(sql).run(params)  ← sync (I/O + CPU)
          → for each transcript:
            → Kysely.compile()           ← sync
            → db.prepare(sql).run(params)← sync
        → COMMIT                         ← sync
      → FTS rebuild                      ← sync, VERY EXPENSIVE
      → ANALYZE                          ← sync
      → FTS optimize                     ← sync
```

For a file with 3,000 variants and ~3 transcripts per variant, a single `flushBatch()` call:
- Compiles ~12,000 Kysely queries
- Calls `db.prepare()` ~12,000 times
- Executes ~12,000 SQL statements
- Then rebuilds FTS index over ALL variants for this case

This blocks the event loop for **seconds per batch**. During this time:
- No IPC messages can be sent or received (progress updates queue up)
- The renderer process can't communicate with main
- Windows marks the window as "not responding" after ~5 seconds of no message pump activity

**Evidence in code:**
- `src/main/import/transforms/BatchAccumulator.ts:67` — sync call to `insertVariantsBatch`
- `src/main/database/VariantRepository.ts:59-106` — massive synchronous loop
- `src/main/database/BaseRepository.ts:40-46` — `execRun()` compiles + prepares + runs each time

### Impact

- Complete UI freeze for 2-10+ seconds per 5000-variant batch
- "keine Rückmeldung" on Windows
- Progress updates are delayed/batched unpredictably
- Cancel button unresponsive during database writes
- For 53 files × ~3000 variants each = ~160K variants = ~32 batch flushes, each blocking for seconds

---

## Issue 2: Progress Display Bugs

### Bug 2a: File Progress Resets Batch Index

**Severity: HIGH**

In `src/main/ipc/handlers/batch-import.ts:210-228`, the `onFileProgress` callback sends **hardcoded zeros** for batch-level fields:

```typescript
const onFileProgress = (progress: ProgressUpdate): void => {
  // ...
  safeEmit('batch-import:progress', {
    currentIndex: 0,        // ← BUG: Always 0
    totalFiles: filePaths.length,
    currentFileName: '',     // ← BUG: Always empty
    overallPercent: 0,       // ← BUG: Always 0
    fileProgress: { ... }
  })
}
```

The renderer (`BatchImportDialog.vue:390-399`) applies ALL fields from every progress event:

```typescript
api!.batchImport.onProgress((progress: BatchProgress) => {
  currentIndex.value = progress.currentIndex    // ← Overwritten to 0!
  totalFiles.value = progress.totalFiles
  currentFileName.value = progress.currentFileName  // ← Overwritten to ''!
  overallPercent.value = progress.overallPercent     // ← Overwritten to 0!
  // ...
})
```

**Result:** When processing file 20/53, the sequence is:
1. Batch progress fires: `currentIndex=19` → UI shows "20 of 53"
2. File progress fires: `currentIndex=0` → UI jumps to "1 of 53"
3. Next batch progress fires: `currentIndex=19` → UI jumps back to "20 of 53"

This creates the observed "jumping back and forth" behavior.

### Bug 2b: Variant Count Never Resets Between Files

**Severity: MEDIUM**

In `BatchImportDialog.vue:396-398`:

```typescript
if (progress.fileProgress !== undefined) {
  variantCount.value = progress.fileProgress.count
}
```

The variant count is only updated when `fileProgress` is present. Between files, only batch-level progress events fire (no `fileProgress`), so the variant count retains the **last file's final count**. When the next file starts, its first batch might report e.g. 500 variants, but this update competes with the batch-level events that don't reset it.

Additionally, since `variantCount` is never explicitly reset when switching to a new file, the display accumulates confusingly.

### Bug 2c: Two Throttle Timers Interfere

Both `onBatchProgress` and `onFileProgress` have independent throttle timers (`lastBatchEmitTime` and `lastFileEmitTime`). Since they send to the same `batch-import:progress` channel with overlapping fields, the UI state oscillates between batch-level and file-level values within the same 200ms window.

---

## Issue 3: Massive Per-File Overhead

### 3a: FTS Rebuild After Every File

**Severity: HIGH**

`VariantRepository.insertVariantsBatch()` (lines 116-141) runs these operations after EVERY file:

```sql
INSERT INTO variants_fts(variants_fts) VALUES('rebuild')  -- Rebuilds ENTIRE FTS index
ANALYZE                                                      -- Re-analyzes ALL tables
INSERT INTO variants_fts(variants_fts) VALUES('optimize')  -- Optimizes FTS
```

For 53 files imported sequentially:
- **53 FTS rebuilds** — each scans the entire `variants` table (which grows with each file)
- **53 ANALYZE** calls — re-statistics all tables and indexes
- **53 FTS optimizes**

The FTS rebuild time is O(n) where n is the total number of variants. By file 53, the rebuild scans ~150K+ rows. The cumulative cost is O(n²) across all files.

### 3b: No Prepared Statement Reuse

**Severity: HIGH**

In `VariantRepository.insertVariantsBatch()`, each variant insert goes through:

```typescript
const result = this.execRun(
  this.kysely.insertInto('variants').values({ ... })
)
```

Which compiles to:
```typescript
const compiled = query.compile()                           // Kysely builds SQL string
return this.db.prepare(compiled.sql).run(...compiled.parameters)  // better-sqlite3 prepares + runs
```

The SQL template is **identical every time** (only parameters change):
```sql
INSERT INTO variants (case_id, chr, pos, ref, alt, ...) VALUES (?, ?, ?, ?, ?, ...)
```

But it's recompiled by Kysely AND re-prepared by better-sqlite3 for **every single row**. For 5000 variants with 3 transcripts each = 20,000 prepare+compile calls per batch.

**better-sqlite3 best practice** (from docs): "If you're inserting or updating a lot of data, always prepare the statements outside the loop."

```javascript
// CURRENT (slow): prepare inside loop
for (const v of batch) {
  this.execRun(this.kysely.insertInto('variants').values({...}))
}

// OPTIMAL: prepare once, reuse
const stmt = db.prepare('INSERT INTO variants (...) VALUES (?, ?, ...)')
for (const v of batch) {
  stmt.run(v.chr, v.pos, ...)
}
```

### 3c: FTS Triggers Dropped/Restored Per File

FTS triggers are dropped before insert and restored after — 53 times for 53 files. The DROP/CREATE DDL is cheap individually but adds up.

### 3d: Double Batch Chunking

`BatchAccumulator` accumulates variants into batches of 5000, then `insertVariantsBatch` re-chunks them into 5000 again:

```typescript
// BatchAccumulator: flushes at batchSize (5000)
this.db.variants.insertVariantsBatch(this.caseId, this.batch)

// VariantRepository: re-chunks at BATCH_SIZE (5000)
for (let i = 0; i < variants.length; i += BATCH_SIZE) {
  const batch = variants.slice(i, i + BATCH_SIZE)
  insertBatch(batch)
}
```

Since both use the same 5000 default, the inner loop always runs once — but the slicing is unnecessary overhead and the API suggests it expects larger arrays.

---

## Issue 4: Additional Anti-Patterns

### 4a: Sequential File Processing

`BatchImportService.processBatch()` processes files strictly sequentially:

```typescript
for (let i = 0; i < filePaths.length; i++) {
  const importResult = await this.importService.importVariants(filePath, { ... })
}
```

While sequential processing avoids database contention, it means the CPU/disk is idle during decompression/parsing of the next file while the current one is being written. A pipeline approach could overlap parsing and writing.

### 4b: Format Detection Re-reads File

`ImportService.importVariants()` calls `detectFormat()` which opens and partially reads the file, then the strategy opens and reads it again from the beginning. For large gzipped files, this means decompressing twice.

### 4c: New ImportService per Request

`batch-import.ts:167-168` creates new `ImportService` and `BatchImportService` instances for every `batch-import:start` call. While lightweight, it prevents any cross-request caching.

---

## Proposed Solutions

### Solution 1: Worker Thread for Database Operations (Fixes Issue 1)

**Priority: CRITICAL — Eliminates "keine Rückmeldung"**

Move all SQLite operations to a dedicated `worker_threads` Worker. The main thread stays responsive for IPC and UI events.

```
Main Thread (responsive)          Worker Thread (database)
─────────────────────────        ─────────────────────────
IPC handlers                      better-sqlite3 connection
Progress event emission           Sync insert operations
Window management                 FTS rebuild
Cancel signal handling            ANALYZE
```

**Implementation approach:**
1. Create `src/main/workers/import-worker.ts` using `worker_threads`
2. Worker receives file path + options via `parentPort.postMessage()`
3. Worker opens its own SQLite connection (better-sqlite3 supports this)
4. Worker sends progress updates via `parentPort.postMessage()`
5. Main thread relays progress to renderer via IPC
6. Cancel via `worker.terminate()` or shared `SharedArrayBuffer` flag

**Key constraint:** better-sqlite3 connections are NOT shareable between threads. The worker must open its own connection. This is fine for imports since they're write-heavy and isolated.

**Alternative:** Use `setImmediate()` / `setTimeout(0)` between batch inserts to yield the event loop. Simpler but less effective — still blocks during each individual batch insert.

### Solution 2: Fix Progress Reporting (Fixes Issue 2)

**Priority: HIGH — Fixes jumping/confusing display**

**Fix 2a:** Make `onFileProgress` include current batch context:

```typescript
const onFileProgress = (progress: ProgressUpdate): void => {
  safeEmit('batch-import:progress', {
    currentIndex: currentFileIndex,        // ← Track current index
    totalFiles: filePaths.length,
    currentFileName: currentFileName,       // ← Track current file
    overallPercent: currentOverallPercent,  // ← Track overall percent
    fileProgress: { ... }
  })
}
```

**Fix 2b:** Reset variant count in the renderer when a new file starts:

```typescript
api!.batchImport.onProgress((progress: BatchProgress) => {
  currentIndex.value = progress.currentIndex
  // ...
  if (progress.fileProgress !== undefined) {
    variantCount.value = progress.fileProgress.count
  } else {
    // New file starting — reset variant count
    variantCount.value = 0
  }
})
```

**Fix 2c:** Merge batch and file progress into a single consistent update:

```typescript
// Single throttled emitter combining batch + file state
const emitProgress = throttle((batchState, fileState?) => {
  safeEmit('batch-import:progress', { ...batchState, fileProgress: fileState })
}, PROGRESS_THROTTLE_MS)
```

### Solution 3: Batch-Level FTS/ANALYZE (Fixes Issue 3a)

**Priority: HIGH — Major speedup for multi-file imports**

Defer FTS rebuild and ANALYZE to the END of the entire batch import:

```typescript
// New method: insertVariantsBatchBulk() — no FTS rebuild
insertVariantsBatchRaw(caseId, variants) {
  // Drop triggers (if not already dropped)
  // Insert variants in transaction
  // Do NOT rebuild FTS, do NOT ANALYZE
}

// Called once at end of batch:
rebuildFTSAndAnalyze() {
  this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
  this.db.exec(createFTSTriggers)
  this.db.exec('ANALYZE')
  this.db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
}
```

This reduces 53 FTS rebuilds to **1** — potentially a 10-50x speedup for the FTS portion.

### Solution 4: Prepared Statement Caching (Fixes Issue 3b)

**Priority: HIGH — Major speedup for insert operations**

Pre-prepare the INSERT statements and reuse them:

```typescript
insertVariantsBatch(caseId, variants) {
  const insertVariant = this.db.prepare(`
    INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, ...)
    VALUES (?, ?, ?, ?, ?, ?, ...)
  `)
  const insertTranscript = this.db.prepare(`
    INSERT INTO variant_transcripts (variant_id, transcript_id, ...)
    VALUES (?, ?, ...)
  `)

  const insertBatch = this.db.transaction((batch) => {
    for (const v of batch) {
      const result = insertVariant.run(caseId, v.chr, v.pos, ...)
      if (v._transcripts) {
        for (const t of v._transcripts) {
          insertTranscript.run(result.lastInsertRowid, t.transcript_id, ...)
        }
      }
    }
  })

  insertBatch(variants)
}
```

This eliminates ~12,000 Kysely compile + SQLite prepare calls per batch. Expected speedup: **2-5x** for raw insert performance.

### Solution 5: Background Import with Status Indicator

**Priority: MEDIUM — UX improvement**

Allow users to minimize the import to a background task:

1. **Background mode toggle** — Button in import dialog: "Continue in Background"
2. **Status indicator** — Small icon in AppToolbar or bottom status bar showing:
   - Spinner/progress ring with percentage
   - File count (e.g., "12/53")
   - Click to re-open progress dialog
3. **Non-modal operation** — Import continues via worker thread (Solution 1)
4. **Completion notification** — Snackbar or toast when batch finishes

**UI location options:**
- **AppToolbar** (top right) — Add an import status chip/badge
- **Bottom status bar** (new) — Persistent status bar showing import progress
- **System tray notification** — For when app is minimized

### Solution 6: Event Loop Yielding (Quick Win)

**Priority: MEDIUM — Simpler than worker threads, partial fix**

If worker threads are complex to implement, insert `setImmediate()` breaks between batch commits:

```typescript
async insertVariantsBatchAsync(caseId, variants) {
  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    const batch = variants.slice(i, i + BATCH_SIZE)
    insertBatch(batch)  // sync — blocks briefly

    // Yield to event loop between chunks
    await new Promise(resolve => setImmediate(resolve))
  }
}
```

This won't fix the blocking during each individual batch commit (~100-500ms) but allows IPC messages to be processed between batches.

---

## Recommended Implementation Order

| Phase | Fix | Effort | Impact |
|-------|-----|--------|--------|
| 1 | Fix progress reporting bugs (Solution 2) | Low (1-2h) | Fixes jumping/confusion |
| 2 | Prepared statement caching (Solution 4) | Medium (2-4h) | 2-5x insert speedup |
| 3 | Batch-level FTS/ANALYZE (Solution 3) | Medium (2-4h) | 10-50x FTS speedup |
| 4 | Event loop yielding (Solution 6) | Low (1h) | Partial UI responsiveness |
| 5 | Worker thread migration (Solution 1) | High (1-2d) | Full UI responsiveness |
| 6 | Background import UI (Solution 5) | Medium (4-8h) | Background import UX |

**Phases 1-4 are the highest ROI** — they fix the bugs and provide major speedups with moderate effort. Phase 5 (worker threads) provides the complete solution for UI blocking but requires more architectural change.

---

## Performance Estimates

**Current performance** (estimated for 53 files, ~3000 variants each):
- ~160K total variants
- ~12K Kysely compiles + SQLite prepares per 5K batch = ~384K total
- 53 FTS rebuilds (each scanning growing variant table)
- Total: estimated 5-15+ minutes with frequent "not responding"

**After Solutions 2-4:**
- Prepared statements: ~3x fewer CPU cycles per variant
- Single FTS rebuild: ~50x reduction in FTS time
- Fixed progress: accurate, non-jumping display
- Estimated: 1-3 minutes, still with brief UI freezes

**After Solution 5 (worker thread):**
- All database work off main thread
- UI stays fully responsive throughout
- Estimated: 1-3 minutes with smooth progress updates

**After Solution 6 (background import):**
- User can continue working during import
- Progress visible in toolbar/status bar

---

## Appendix: Key File Locations

| Component | File | Key Lines |
|-----------|------|-----------|
| BatchAccumulator (blocking flush) | `src/main/import/transforms/BatchAccumulator.ts` | 64-79 |
| VariantRepository (sync inserts) | `src/main/database/VariantRepository.ts` | 45-144 |
| BaseRepository (per-call prepare) | `src/main/database/BaseRepository.ts` | 40-46 |
| Batch IPC handler (progress bug) | `src/main/ipc/handlers/batch-import.ts` | 210-228 |
| BatchImportDialog (UI state) | `src/renderer/src/components/BatchImportDialog.vue` | 388-399 |
| BatchProgressPhase (display) | `src/renderer/src/components/batch-import/BatchProgressPhase.vue` | 1-13 |
| BatchImportService (sequential) | `src/main/import/BatchImportService.ts` | 81-185 |
| Database config (batch size) | `src/shared/config/database.config.ts` | 9 |
