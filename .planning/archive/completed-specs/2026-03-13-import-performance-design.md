# Import Performance & Worker Thread Architecture Design

**Date:** 2026-03-13
**Status:** Draft
**Relates to:** `.planning/docs/IMPORT-PERFORMANCE-ANALYSIS.md`

## Problem

Batch import of variant files (53+ files, ~160K variants) causes:
1. Complete UI blocking ("keine Rückmeldung") — synchronous SQLite on main thread
2. Progress display bugs — file/batch progress events overwrite each other
3. Slow imports — per-row query compilation, per-file FTS rebuilds

## Design Principles

- DRY, KISS, SOLID, modularisation
- Keep Kysely for all non-import queries (cloud migration readiness, type safety, filter builder DRY)
- Use raw better-sqlite3 prepared statements only in the bulk insert hot loop
- No throwaway code (no event loop yielding hack — worker thread solves it properly)

## Architecture

### Worker Thread Model

The entire import pipeline moves to a dedicated `worker_threads` Worker. The main thread becomes a thin relay between worker and renderer.

```
Main Thread                          Worker Thread
───────────────                      ─────────────────
IPC handler receives                 Opens own SQLite connection
  file path + options                Runs full pipeline:
       │                               File read → Gunzip → Parse
       ├──postMessage({type:'start'})──→ Field mapping → Batch accumulate
       │                               DB insert (prepared stmts)
       │←─postMessage({type:'progress'})── Progress updates
       │←─postMessage({type:'result'})──── Completion/error
       │
  Relays to renderer via IPC
  Handles cancel via SharedArrayBuffer flag
```

Key boundaries:
- **`ImportWorker`** — worker entry point, owns SQLite connection + pipeline orchestration
- **`ImportWorkerClient`** — main-thread typed wrapper, used by both single and batch import handlers (DRY)
- Existing strategies/transforms reused inside worker (no duplication)
- **`SharedArrayBuffer`** cancel flag — checked between batches and between stream chunks, clean shutdown (no `worker.terminate()`)

### Build Configuration

The import worker must be registered as a separate rollup entry point in `electron.vite.config.ts`:

```typescript
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts'),
  'import-worker': resolve(__dirname, 'src/main/workers/import-worker.ts')
}
```

Worker path resolution follows the existing `statistics-worker` pattern: `resolve(__dirname, 'import-worker.js')`.

### Worker Database Connection

The worker opens a **lightweight** SQLite connection — no schema initialization, no migrations, no Kysely, no repositories. Only:

1. Raw `better-sqlite3` connection to the database path
2. Encryption key application (passed via `start` message)
3. Same PRAGMAs as `DatabaseService` (WAL, busy_timeout, cache_size, mmap_size, etc.)
4. Prepared statements for variant/transcript inserts

This follows Interface Segregation — the worker needs only write capability, not the full `DatabaseService`.

**WAL contention note:** With WAL mode, the main thread can read while the worker writes. If the main thread also writes (e.g., user edits annotations during import), both compete for the write lock. The `busy_timeout` of 5000ms handles this, but concurrent writes during import may feel laggy.

**Connection cleanup:** The worker registers `process.on('exit')` and wraps operations in `try/finally` to ensure the connection is closed on normal exit, errors, and abnormal termination.

### Message Protocol

Single typed message interface replaces the current dual-throttle progress system:

```typescript
// Worker → Main
type WorkerMessage =
  | { type: 'progress'; fileIndex: number; totalFiles: number; fileName: string;
      overallPercent: number; phase: string; variantCount: number; skipped: number }
  | { type: 'file-complete'; fileIndex: number; result: ImportResult }
  | { type: 'complete'; results: BatchImportResult }
  | { type: 'error'; fileIndex: number; error: string; phase: string; stack?: string }

// Main → Worker
type MainMessage =
  | { type: 'start'; files: FileImportRequest[]; dbPath: string;
      encryptionKey?: string; throttleMs: number }
  | { type: 'cancel' }  // backup signal (SharedArrayBuffer is primary)
```

Design decisions:
- **One message type for progress** — no separate batch/file events overwriting each other (fixes Bug 2a/2c)
- **Every progress message carries full state** — renderer just assigns, no merging (fixes Bug 2b)
- **Throttling in the worker** — single throttle timer using `throttleMs` from config, main thread relays immediately
- **`cancel` message as backup** — `SharedArrayBuffer` flag checked synchronously between batches
- **Error messages include phase and stack** — for diagnosing which pipeline stage failed

### Case Creation & Ownership

The **worker** creates case records (it owns the full pipeline). The worker reports the `caseId` back via `file-complete` messages. The main thread does not need the case ID during import — only after completion for UI navigation.

**Partial failure handling:** Each file is wrapped in try/catch within the worker. If a file fails:
- The partially-created case is rolled back (deleted) within the worker
- The error is reported via an `error` message
- The worker continues with the next file (preserving partial success)
- The final `complete` message includes per-file results (success/failure/skipped)

### Prepared Statement Caching & Batch FTS

Inside the worker, prepared statements are created once per worker lifetime:

```typescript
// Prepared once (not per file, not per batch)
const insertVariant = db.prepare('INSERT INTO variants (...) VALUES (?, ?, ...)')
const insertTranscript = db.prepare('INSERT INTO variant_transcripts (...) VALUES (?, ?, ...)')

// Transaction wrapper reused per batch
const insertBatch = db.transaction((variants) => {
  for (const v of variants) {
    const { lastInsertRowid } = insertVariant.run(v.chr, v.pos, ...)
    for (const t of v._transcripts) {
      insertTranscript.run(lastInsertRowid, t.transcriptId, ...)
    }
  }
})
```

**Column list sync:** The INSERT column list is defined as a shared constant in `src/shared/types/import-worker.ts` alongside the schema types. If a column is added to the Kysely schema, the constant must be updated in the same change.

FTS strategy:
- **Batch imports:** drop FTS triggers once at start, insert all files without FTS rebuild, single FTS rebuild + ANALYZE + optimize at the end, restore triggers
- **Single imports:** same drop/rebuild pattern (faster than per-row triggers)
- **No double chunking** — `BatchAccumulator` flushes batches, worker calls `insertBatch()` directly
- **FTS trigger restore in `finally`** — if the worker crashes between trigger drop and rebuild, the `finally` block restores triggers so subsequent app sessions have working FTS search
- **Non-interruptible FTS rebuild** — cancel flag is not checked during the final FTS rebuild. Progress shows a "Finalizing..." phase during this operation.

### BatchAccumulator Refactor

`BatchAccumulator` currently depends on `DatabaseService` for flushing. Refactored to accept a flush callback (Dependency Inversion):

```typescript
// Before: coupled to DatabaseService
constructor(db: DatabaseService, caseId: number, batchSize: number)

// After: depends on abstraction
constructor(flushFn: (caseId: number, batch: MappedVariant[]) => void, caseId: number, batchSize: number)
```

This makes the transform testable without a database and reusable in the worker context where there is no `DatabaseService`.

### Background Import UI

Two components for visibility during imports:

**Toolbar indicator (AppToolbar):**
- Small chip — spinner icon, "12/53" file count, percentage
- Click opens full progress dialog
- Disappears after completion (brief success state)

**Bottom status bar (new):**
- Thin bar below main content area
- Shows: current file name, progress bar, variant count, elapsed time
- "Expand" button opens full dialog, "Cancel" button
- Only renders when import is active

**Dialog behavior:**
- Import dialog becomes dismissible during import (currently modal)
- "Continue in Background" minimizes to toolbar + status bar
- Re-opening shows full progress
- Completion triggers snackbar notification

**State management:**
- New Pinia store `useImportStatusStore` — import state, progress, results
- Both toolbar indicator and status bar read from this store
- Store updated by IPC progress handler (single source of truth)
- Store tracks dialog open state (prevents duplicate imports)
- Store resets on unexpected worker termination (main process `app.on('before-quit')` signals graceful shutdown)

### Worker Lifecycle

One worker per import operation (single or batch), terminated after completion. Workers are not pooled — imports are infrequent and the startup cost is negligible compared to import duration.

### Variant Count Update

The **worker** updates `cases.variant_count` after each file completes (within the per-file transaction). The duplicate `updateCaseVariantCount` call in strategies is removed.

## Module Structure

### New files

```
src/main/workers/
  import-worker.ts              # Worker entry — SQLite conn, pipeline orchestration
  import-worker-client.ts       # Main-thread typed wrapper (postMessage/onMessage)

src/shared/types/
  import-worker.ts              # WorkerMessage/MainMessage types, column constants

src/renderer/src/stores/
  importStatus.ts               # Pinia store — import state + progress

src/renderer/src/components/
  ImportStatusBar.vue            # Bottom progress bar
  ImportStatusChip.vue           # Toolbar chip component
```

### Modified files

```
electron.vite.config.ts               # Add import-worker rollup entry
src/main/ipc/handlers/import.ts       # Simplified — delegates to ImportWorkerClient
src/main/ipc/handlers/batch-import.ts # Simplified — delegates to ImportWorkerClient
src/main/import/ImportService.ts       # Simplified — no longer owns DB calls
src/main/import/transforms/BatchAccumulator.ts  # Refactored — flush callback
src/renderer/src/components/
  ImportDialog.vue                     # Dismissible, reads from store
  BatchImportDialog.vue                # Dismissible, reads from store
  AppToolbar.vue                       # Import status chip added
```

### Deleted

```
src/main/import/BatchImportService.ts  # Logic moves to worker
```

Removed from VariantRepository:
- `insertVariantsBatch` bulk method (read/query methods stay)
- Dual throttle logic in batch-import handler
- Double-chunking logic
- Duplicate `updateCaseVariantCount` call in strategies

### Unchanged

- All strategies and transforms (reused in worker, except BatchAccumulator signature change)
- Format detection (`ImportService.detectFormat`)
- All read/query repositories
- Kysely usage for non-import queries

## Implementation Order

| Phase | What | Why |
|-------|------|-----|
| 1 | Worker thread + message protocol | Foundational — everything layers on this |
| 2 | Prepared statement caching + batch FTS | Performance — natural fit inside worker |
| 3 | Progress bug fixes | Comes free with new protocol design |
| 4 | Background import UI (store + toolbar + status bar) | UX — depends on working worker + progress |
| 5 | Dialog refactor (dismissible, background mode) | Final UX polish |

## Future Optimizations (Out of Scope)

- **Parallel file parsing:** Overlap parsing of next file with DB writes of current file
- **Format detection caching:** Avoid double-reading gzipped files (detect + parse)
- **Adaptive batch size:** Tune based on variant field count and available memory

## Performance Expectations

**Current:** 5-15+ minutes for 53 files, frequent "not responding"

**After this work:**
- ~1-3 minutes (prepared statements + single FTS rebuild)
- UI fully responsive throughout (worker thread)
- Accurate, non-jumping progress display
- User can continue working during import
