# Import Worker Thread Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire variant import pipeline to a dedicated worker thread, eliminating UI blocking, fixing progress bugs, and improving performance via prepared statements and batch FTS.

**Architecture:** A `worker_threads` Worker owns the SQLite connection and runs the full import pipeline (file read, parse, transform, insert). The main thread becomes a thin relay between worker and renderer. A typed `ImportWorkerClient` wraps the worker lifecycle. A new Pinia store centralizes import state for toolbar chip and status bar UI.

**Tech Stack:** Electron 40, worker_threads, better-sqlite3-multiple-ciphers, Vue 3/Vuetify 3/Pinia, electron-vite (rollup), TypeScript

### Known Implementation Notes (from architect review)

These issues were identified during plan review and must be addressed during implementation:

1. **`created_at` must use `Date.now()` (integer ms)**, not `datetime('now')` — matches `CaseRepository.createCase()`
2. **In-batch duplicate detection**: Worker must track `importedInBatch: Set<string>` to avoid UNIQUE constraint crashes when two files produce the same case name
3. **`checkDuplicates` survival**: When `BatchImportService` is deleted (Task 11), `checkDuplicates` and `extractCaseName` logic must be inlined into the batch-import IPC handler or extracted to a utility
4. **`caseId` capture in single import**: The `onFileComplete` callback must capture `caseId` into a closure variable before `onComplete` resolves the promise
5. **Cancel lifecycle**: `import:cancel` must NOT set `workerClient = null` — let the `onComplete` callback clean it up after the worker responds
6. **`data_info` metadata**: Worker must call `INSERT INTO case_data_info` for import provenance (file name, format type) — or the main thread does it after `file-complete`
7. **Encryption key**: `DatabaseService` needs a getter for the encryption key, or it must be threaded through from the renderer's database open flow
8. **`elapsedMs` reactivity**: The Pinia store's `elapsedMs` computed won't auto-update — use a 1-second `setInterval` timer that increments a reactive counter while `isActive` is true
9. **FTS trigger SQL**: Import from `../database/schema` (`createFTSTriggers`) instead of duplicating — it's already exported
10. **Extract format detection BEFORE writing worker** (Task 5 Step 4 should be Step 1)
11. **`stripText` on `FileImportRequest`**: Remove — `caseName` is pre-computed before the worker call

---

## Chunk 1: Shared Types & Build Configuration

### Task 1: Worker Message Types

**Files:**
- Create: `src/shared/types/import-worker.ts`

- [ ] **Step 1: Write the failing test**

Create a type-level test that verifies the message types compile correctly.

```typescript
// tests/main/import/worker-types.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { WorkerMessage, MainMessage, VariantInsertRow, TranscriptInsertRow } from '../../../src/shared/types/import-worker'

describe('import worker types', () => {
  it('WorkerMessage progress variant has required fields', () => {
    expectTypeOf<Extract<WorkerMessage, { type: 'progress' }>>().toMatchTypeOf<{
      type: 'progress'
      fileIndex: number
      totalFiles: number
      fileName: string
      overallPercent: number
      phase: string
      variantCount: number
      skipped: number
    }>()
  })

  it('MainMessage start variant has required fields', () => {
    expectTypeOf<Extract<MainMessage, { type: 'start' }>>().toMatchTypeOf<{
      type: 'start'
      files: Array<{ filePath: string; caseName: string; isDuplicate: boolean; duplicateStrategy: 'skip' | 'overwrite' }>
      dbPath: string
      throttleMs: number
    }>()
  })

  it('VariantInsertRow has all variant columns', () => {
    expectTypeOf<VariantInsertRow>().toMatchTypeOf<{
      chr: string
      pos: number
      ref: string
      alt: string
    }>()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/worker-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the shared types file**

```typescript
// src/shared/types/import-worker.ts
import type { TranscriptInsertRow } from './transcript'

/**
 * Variant row for raw prepared-statement insertion (no Kysely).
 * Must stay in sync with the variants table schema.
 */
export interface VariantInsertRow {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: number | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  moi: string | null
}

/** Columns for the INSERT INTO variants (...) statement */
export const VARIANT_INSERT_COLUMNS = [
  'case_id', 'chr', 'pos', 'ref', 'alt', 'gene_symbol', 'omim_mim_number',
  'consequence', 'gnomad_af', 'cadd', 'clinvar', 'gt_num', 'func', 'qual',
  'hpo_sim_score', 'transcript', 'cdna', 'aa_change', 'moi'
] as const

/** Columns for the INSERT INTO variant_transcripts (...) statement */
export const TRANSCRIPT_INSERT_COLUMNS = [
  'variant_id', 'transcript_id', 'gene_symbol', 'consequence', 'cdna',
  'aa_change', 'hpo_sim_score', 'moi', 'is_selected'
] as const

/** File import request sent from main to worker */
export interface FileImportRequest {
  filePath: string
  caseName: string
  isDuplicate: boolean
  duplicateStrategy: 'skip' | 'overwrite'
}

/** Worker → Main messages */
export type WorkerMessage =
  | {
      type: 'progress'
      fileIndex: number
      totalFiles: number
      fileName: string
      overallPercent: number
      phase: string
      variantCount: number
      skipped: number
    }
  | {
      type: 'file-complete'
      fileIndex: number
      result: {
        caseId: number
        caseName: string
        variantCount: number
        skipped: number
        elapsed: number
      }
    }
  | {
      type: 'complete'
      results: {
        succeeded: number
        failed: number
        skipped: number
        cancelled: boolean
        details: Array<{
          filePath: string
          fileName: string
          caseName: string
          status: 'success' | 'failed' | 'skipped'
          variantCount?: number
          error?: string
        }>
      }
    }
  | {
      type: 'error'
      fileIndex: number
      error: string
      phase: string
      stack?: string
    }

/** Main → Worker messages */
export type MainMessage =
  | {
      type: 'start'
      files: FileImportRequest[]
      dbPath: string
      encryptionKey?: string
      throttleMs: number
      batchSize?: number
    }
  | {
      type: 'cancel'
    }

export type { TranscriptInsertRow }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/import/worker-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/import-worker.ts tests/main/import/worker-types.test.ts
git commit -m "feat: add shared types for import worker message protocol"
```

---

### Task 2: Build Configuration — Add Worker Entry Point

**Files:**
- Modify: `electron.vite.config.ts:13-16`

- [ ] **Step 1: Add the import-worker rollup entry**

In `electron.vite.config.ts`, add `'import-worker'` to the `input` object:

```typescript
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts'),
  'import-worker': resolve(__dirname, 'src/main/workers/import-worker.ts')
}
```

- [ ] **Step 2: Create a minimal worker stub so the build succeeds**

```typescript
// src/main/workers/import-worker.ts
import { parentPort } from 'worker_threads'

if (!parentPort) throw new Error('Must be run as worker thread')

// Stub — will be implemented in Task 4
parentPort.on('message', () => {
  // placeholder
})
```

- [ ] **Step 3: Verify build succeeds**

Run: `npx electron-vite build`
Expected: Build succeeds, `out/main/import-worker.js` exists

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts src/main/workers/import-worker.ts
git commit -m "build: add import-worker rollup entry point"
```

---

## Chunk 2: BatchAccumulator Refactor

### Task 3: Refactor BatchAccumulator to Accept Flush Callback

**Files:**
- Modify: `src/main/import/transforms/BatchAccumulator.ts`
- Modify: `src/main/import/strategies/ColumnarStrategy.ts:54-61`
- Modify: `src/main/import/strategies/SimpleStrategy.ts` (same pattern)
- Modify: `src/main/import/strategies/ObjectStrategy.ts` (same pattern)
- Test: `tests/main/import/BatchAccumulator.test.ts`

- [ ] **Step 1: Write the failing test for flush callback interface**

```typescript
// tests/main/import/BatchAccumulator.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BatchAccumulator } from '../../../src/main/import/transforms/BatchAccumulator'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

describe('BatchAccumulator', () => {
  it('calls flushFn with caseId and batch when batchSize reached', async () => {
    const flushFn = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 2,
      flushFn,
      onProgress: undefined,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    const variants = [
      { chr: '1', pos: 100, ref: 'A', alt: 'T' },
      { chr: '1', pos: 200, ref: 'G', alt: 'C' },
      { chr: '1', pos: 300, ref: 'T', alt: 'A' }
    ]

    accumulator.write(variants[0])
    accumulator.write(variants[1])
    accumulator.write(variants[2])
    accumulator.end()

    await pipeline(accumulator, sink)

    // 2 flushes: batch of 2 + remainder of 1
    expect(flushFn).toHaveBeenCalledTimes(2)
    expect(flushFn).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ chr: '1', pos: 100 }),
      expect.objectContaining({ chr: '1', pos: 200 })
    ]))
    expect(flushFn).toHaveBeenCalledWith(1, [
      expect.objectContaining({ chr: '1', pos: 300 })
    ])
  })

  it('counts null chunks as skipped', async () => {
    const flushFn = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 10,
      flushFn,
      onProgress: undefined,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write(null)
    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.write(null)
    accumulator.end()

    await pipeline(accumulator, sink)

    expect(accumulator.skippedCount).toBe(2)
    expect(accumulator.inserted).toBe(1)
    expect(flushFn).toHaveBeenCalledTimes(1)
  })

  it('reports progress via onProgress callback', async () => {
    const flushFn = vi.fn()
    const onProgress = vi.fn()
    const accumulator = new BatchAccumulator({
      caseId: 1,
      batchSize: 1,
      flushFn,
      onProgress,
      startTime: Date.now()
    })

    const sink = new Writable({ objectMode: true, write: (_c, _e, cb) => cb() })

    accumulator.write({ chr: '1', pos: 100, ref: 'A', alt: 'T' })
    accumulator.end()

    await pipeline(accumulator, sink)

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'inserting', count: 1 })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/BatchAccumulator.test.ts`
Expected: FAIL — BatchAccumulator constructor doesn't accept `flushFn`

- [ ] **Step 3: Refactor BatchAccumulator**

Replace the `db` dependency with a `flushFn` callback:

```typescript
// src/main/import/transforms/BatchAccumulator.ts
import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import type { ProgressCallback } from '../types'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

export type FlushFn = (caseId: number, batch: MappedVariant[]) => void

interface BatchAccumulatorOptions {
  caseId: number
  batchSize: number
  flushFn: FlushFn
  onProgress?: ProgressCallback
  startTime: number
}

export class BatchAccumulator extends Transform {
  private batch: MappedVariant[] = []
  private totalInserted = 0
  private skipped = 0
  private readonly caseId: number
  private readonly batchSize: number
  private readonly flushFn: FlushFn
  private readonly onProgress?: ProgressCallback
  private readonly startTime: number

  constructor(options: BatchAccumulatorOptions) {
    super({ objectMode: true })
    this.caseId = options.caseId
    this.batchSize = options.batchSize
    this.flushFn = options.flushFn
    this.onProgress = options.onProgress
    this.startTime = options.startTime
  }

  _transform(
    chunk: MappedVariant | null,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (chunk === null) {
      this.skipped++
      callback()
      return
    }

    this.batch.push(chunk)

    if (this.batch.length >= this.batchSize) {
      this.flushBatch()
    }

    callback()
  }

  _flush(callback: TransformCallback): void {
    if (this.batch.length > 0) {
      this.flushBatch()
    }
    callback()
  }

  private flushBatch(): void {
    if (this.batch.length === 0) return

    this.flushFn(this.caseId, this.batch)
    this.totalInserted += this.batch.length

    if (this.onProgress) {
      this.onProgress({
        phase: 'inserting',
        count: this.totalInserted,
        elapsed: Date.now() - this.startTime,
        skipped: this.skipped
      })
    }

    this.batch = []
  }

  get inserted(): number {
    return this.totalInserted
  }

  get skippedCount(): number {
    return this.skipped
  }
}

export function createBatchAccumulator(options: BatchAccumulatorOptions): BatchAccumulator {
  return new BatchAccumulator(options)
}
```

- [ ] **Step 4: Update strategy call sites**

In each strategy (`ColumnarStrategy.ts`, `SimpleStrategy.ts`, `ObjectStrategy.ts`), change the `createBatchAccumulator` call from:

```typescript
const batchAccumulator = createBatchAccumulator({
  caseId,
  batchSize,
  db,
  onProgress: options.onProgress,
  startTime
})
```

to:

```typescript
const batchAccumulator = createBatchAccumulator({
  caseId,
  batchSize,
  flushFn: (cId, batch) => db.variants.insertVariantsBatch(cId, batch),
  onProgress: options.onProgress,
  startTime
})
```

- [ ] **Step 5: Run tests to verify everything passes**

Run: `npx vitest run tests/main/import/`
Expected: All import tests PASS (including existing FieldMapper, ObjectFormatMapper, ImportService tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/import/transforms/BatchAccumulator.ts \
  src/main/import/strategies/ColumnarStrategy.ts \
  src/main/import/strategies/SimpleStrategy.ts \
  src/main/import/strategies/ObjectStrategy.ts \
  tests/main/import/BatchAccumulator.test.ts
git commit -m "refactor: decouple BatchAccumulator from DatabaseService via flush callback"
```

---

## Chunk 3: Import Worker & Client

### Task 4: ImportWorkerClient (Main-Thread Wrapper)

**Files:**
- Create: `src/main/workers/import-worker-client.ts`
- Test: `tests/main/import/import-worker-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/import/import-worker-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportWorkerClient } from '../../../src/main/workers/import-worker-client'
import type { WorkerMessage, MainMessage } from '../../../src/shared/types/import-worker'
import { EventEmitter } from 'events'

// Mock Worker as EventEmitter
class MockWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn().mockResolvedValue(undefined)
}

// Intercept Worker constructor
vi.mock('worker_threads', () => {
  let mockWorker: MockWorker
  return {
    Worker: vi.fn().mockImplementation(() => {
      mockWorker = new MockWorker()
      return mockWorker
    }),
    get __mockWorker() {
      return mockWorker
    }
  }
})

describe('ImportWorkerClient', () => {
  let client: ImportWorkerClient

  beforeEach(() => {
    client = new ImportWorkerClient()
  })

  it('sends start message to worker', () => {
    const workerThreads = vi.mocked(require('worker_threads'))
    const mockWorker = workerThreads.__mockWorker as MockWorker

    const onProgress = vi.fn()
    const onFileComplete = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()

    client.start({
      files: [{ filePath: '/test.json.gz', caseName: 'test', isDuplicate: false, duplicateStrategy: 'skip' }],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress,
      onFileComplete,
      onComplete,
      onError
    })

    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        dbPath: '/test.db',
        throttleMs: 100
      })
    )
  })

  it('relays progress messages to callback', () => {
    const workerThreads = vi.mocked(require('worker_threads'))
    const onProgress = vi.fn()

    client.start({
      files: [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress,
      onFileComplete: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn()
    })

    const mockWorker = workerThreads.__mockWorker as MockWorker

    const progressMsg: WorkerMessage = {
      type: 'progress',
      fileIndex: 0,
      totalFiles: 1,
      fileName: 'test.json.gz',
      overallPercent: 50,
      phase: 'inserting',
      variantCount: 100,
      skipped: 2
    }

    mockWorker.emit('message', progressMsg)
    expect(onProgress).toHaveBeenCalledWith(progressMsg)
  })

  it('cancel sends cancel message', () => {
    const workerThreads = vi.mocked(require('worker_threads'))

    client.start({
      files: [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress: vi.fn(),
      onFileComplete: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn()
    })

    const mockWorker = workerThreads.__mockWorker as MockWorker
    client.cancel()
    expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/import-worker-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ImportWorkerClient**

```typescript
// src/main/workers/import-worker-client.ts
import { Worker } from 'worker_threads'
import { resolve } from 'path'
import type {
  WorkerMessage,
  MainMessage,
  FileImportRequest
} from '../../shared/types/import-worker'
import { mainLogger } from '../services/MainLogger'

export interface ImportWorkerCallbacks {
  files: FileImportRequest[]
  dbPath: string
  encryptionKey?: string
  throttleMs: number
  batchSize?: number
  onProgress: (msg: Extract<WorkerMessage, { type: 'progress' }>) => void
  onFileComplete: (msg: Extract<WorkerMessage, { type: 'file-complete' }>) => void
  onComplete: (msg: Extract<WorkerMessage, { type: 'complete' }>) => void
  onError: (msg: Extract<WorkerMessage, { type: 'error' }>) => void
}

export class ImportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string

  constructor() {
    this.workerPath = resolve(__dirname, 'import-worker.js')
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  start(callbacks: ImportWorkerCallbacks): void {
    if (this.worker !== null) {
      throw new Error('Import worker is already running')
    }

    this.worker = new Worker(this.workerPath)

    this.worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg)
          break
        case 'file-complete':
          callbacks.onFileComplete(msg)
          break
        case 'complete':
          callbacks.onComplete(msg)
          this.cleanup()
          break
        case 'error':
          callbacks.onError(msg)
          break
      }
    })

    this.worker.on('error', (err) => {
      mainLogger.error(`Import worker error: ${err.message}`, 'ImportWorkerClient')
      callbacks.onError({
        type: 'error',
        fileIndex: -1,
        error: err.message,
        phase: 'worker',
        stack: err.stack
      })
      this.cleanup()
    })

    this.worker.on('exit', (code) => {
      if (code !== 0 && this.worker !== null) {
        mainLogger.error(`Import worker exited with code ${code}`, 'ImportWorkerClient')
      }
      this.worker = null
    })

    const startMsg: MainMessage = {
      type: 'start',
      files: callbacks.files,
      dbPath: callbacks.dbPath,
      encryptionKey: callbacks.encryptionKey,
      throttleMs: callbacks.throttleMs,
      batchSize: callbacks.batchSize
    }

    this.worker.postMessage(startMsg)
  }

  cancel(): void {
    if (this.worker !== null) {
      this.worker.postMessage({ type: 'cancel' } satisfies MainMessage)
    }
  }

  private cleanup(): void {
    if (this.worker !== null) {
      this.worker.terminate().catch(() => {})
      this.worker = null
    }
  }

  async destroy(): Promise<void> {
    if (this.worker !== null) {
      await this.worker.terminate()
      this.worker = null
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/import/import-worker-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/workers/import-worker-client.ts tests/main/import/import-worker-client.test.ts
git commit -m "feat: add ImportWorkerClient main-thread wrapper"
```

---

### Task 5: Import Worker Entry Point

**Files:**
- Modify: `src/main/workers/import-worker.ts` (replace stub)
- Test: Integration test in `tests/main/import/import-worker.integration.test.ts`

This is the most complex task. The worker opens its own SQLite connection, runs the full import pipeline per file, and sends progress/result messages back to the main thread.

- [ ] **Step 1: Write the integration test**

```typescript
// tests/main/import/import-worker.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Worker } from 'worker_threads'
import { resolve } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { WorkerMessage, MainMessage } from '../../../src/shared/types/import-worker'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { gzipSync } from 'zlib'

// NOTE: This test requires `npm run rebuild:node` to have been run
// so that better-sqlite3 is compiled for Node.js, not Electron.
// The worker script must be built first: `npx electron-vite build`

describe('import-worker integration', () => {
  let tmpDir: string
  let dbPath: string
  let db: DatabaseType

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-test-'))
    dbPath = join(tmpDir, 'test.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    db.close()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('imports a simple format file via worker', async () => {
    // Create a test fixture
    const testData = {
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' },
        { chr: '2', pos: 200, ref: 'G', alt: 'C', gene_symbol: 'TP53' }
      ]
    }

    const gzipped = gzipSync(JSON.stringify(testData))
    const fixturePath = join(tmpDir, 'test.json.gz')
    writeFileSync(fixturePath, gzipped)

    // Run the worker
    const workerPath = resolve(__dirname, '../../../out/main/import-worker.js')
    const worker = new Worker(workerPath)

    const messages: WorkerMessage[] = []

    const result = await new Promise<Extract<WorkerMessage, { type: 'complete' }>>((resolvePromise, reject) => {
      worker.on('message', (msg: WorkerMessage) => {
        messages.push(msg)
        if (msg.type === 'complete') {
          resolvePromise(msg)
        }
      })
      worker.on('error', reject)

      const startMsg: MainMessage = {
        type: 'start',
        files: [{
          filePath: fixturePath,
          caseName: 'test-case',
          isDuplicate: false,
          duplicateStrategy: 'skip'
        }],
        dbPath,
        throttleMs: 50
      }

      worker.postMessage(startMsg)
    })

    await worker.terminate()

    expect(result.results.succeeded).toBe(1)
    expect(result.results.failed).toBe(0)

    // Verify data in database
    const verifyDb = new Database(dbPath)
    const caseRow = verifyDb.prepare('SELECT * FROM cases WHERE name = ?').get('test-case') as { id: number; variant_count: number }
    expect(caseRow).toBeTruthy()
    expect(caseRow.variant_count).toBe(2)

    const variants = verifyDb.prepare('SELECT * FROM variants WHERE case_id = ?').all(caseRow.id)
    expect(variants).toHaveLength(2)
    verifyDb.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx electron-vite build && npx vitest run tests/main/import/import-worker.integration.test.ts`
Expected: FAIL — worker is a stub

- [ ] **Step 3: Implement the import worker**

```typescript
// src/main/workers/import-worker.ts
import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { basename } from 'node:path'

import type {
  WorkerMessage,
  MainMessage,
  FileImportRequest
} from '../../shared/types/import-worker'
import type { ImportResult, DataDictionaries } from '../import/types'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { DATABASE_CONFIG } from '../../shared/config'

// Import transforms (reused from existing code)
import { createFieldMapper } from '../import/transforms/FieldMapper'
import { createObjectFormatMapper } from '../import/transforms/ObjectFormatMapper'
import { createBatchAccumulator } from '../import/transforms/BatchAccumulator'
import { resolveColumnIndices } from '../import/config/fieldMapping'

// Import format detection logic
import { ImportService } from '../import/ImportService'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort

import { createFTSTriggers } from '../database/schema'

// Cancel flag
let cancelled = false

const DROP_FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS variants_fts_ai;
  DROP TRIGGER IF EXISTS variants_fts_ad;
  DROP TRIGGER IF EXISTS variants_fts_au;
`

port.on('message', async (msg: MainMessage) => {
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    cancelled = false
    let db: DatabaseType | null = null

    try {
      // Open lightweight SQLite connection
      db = new Database(msg.dbPath)

      if (msg.encryptionKey) {
        const safeKey = msg.encryptionKey.split("'").join("''")
        db.pragma(`key='${safeKey}'`)
      }

      // Same PRAGMAs as DatabaseService
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      db.pragma('synchronous = NORMAL')
      db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
      db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
      db.pragma('temp_store = MEMORY')
      db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

      // Prepare statements once for worker lifetime
      const insertVariantStmt = db.prepare(`
        INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number,
          consequence, gnomad_af, cadd, clinvar, gt_num, func, qual,
          hpo_sim_score, transcript, cdna, aa_change, moi)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertTranscriptStmt = db.prepare(`
        INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol,
          consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertCaseStmt = db.prepare(`
        INSERT INTO cases (name, file_path, file_size, variant_count, created_at)
        VALUES (?, ?, ?, 0, ?)
      `)

      const deleteCaseStmt = db.prepare('DELETE FROM cases WHERE id = ?')
      const getCaseByNameStmt = db.prepare('SELECT id FROM cases WHERE name = ?')
      const updateVariantCountStmt = db.prepare('UPDATE cases SET variant_count = ? WHERE id = ?')

      // Transaction wrapper for batch insert
      const insertBatch = db.transaction(
        (caseId: number, variants: Array<Record<string, unknown>>) => {
          for (const v of variants) {
            const result = insertVariantStmt.run(
              caseId,
              v.chr, v.pos, v.ref, v.alt,
              v.gene_symbol ?? null, v.omim_mim_number ?? null,
              v.consequence ?? null, v.gnomad_af ?? null,
              v.cadd ?? null, v.clinvar ?? null,
              v.gt_num ?? null, v.func ?? null, v.qual ?? null,
              v.hpo_sim_score ?? null, v.transcript ?? null,
              v.cdna ?? null, v.aa_change ?? null, v.moi ?? null
            )

            const transcripts = v._transcripts as Array<Record<string, unknown>> | undefined
            if (transcripts && transcripts.length > 0) {
              const variantId = result.lastInsertRowid
              for (const t of transcripts) {
                insertTranscriptStmt.run(
                  variantId,
                  t.transcript_id, t.gene_symbol,
                  t.consequence, t.cdna, t.aa_change,
                  t.hpo_sim_score, t.moi, t.is_selected
                )
              }
            }
          }
        }
      )

      // Drop FTS triggers once at start (batch optimization)
      db.exec(DROP_FTS_TRIGGERS)

      // Track in-batch duplicates (two files producing same case name)
      const importedInBatch = new Set<string>()

      const totalFiles = msg.files.length
      const batchSize = msg.batchSize ?? DATABASE_CONFIG.BATCH_INSERT_SIZE
      const results: Array<{
        filePath: string
        fileName: string
        caseName: string
        status: 'success' | 'failed' | 'skipped'
        variantCount?: number
        error?: string
      }> = []
      let succeeded = 0
      let failed = 0
      let skipped = 0

      // Throttle progress messages
      let lastProgressTime = 0

      for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
        if (cancelled) {
          // Mark remaining as skipped
          for (let j = fileIndex; j < totalFiles; j++) {
            const f = msg.files[j]
            results.push({
              filePath: f.filePath,
              fileName: basename(f.filePath),
              caseName: f.caseName,
              status: 'skipped',
              error: 'Cancelled by user'
            })
            skipped++
          }
          break
        }

        const file = msg.files[fileIndex]
        const fileName = basename(file.filePath)

        try {
          // Handle duplicates (database + in-batch)
          const existing = getCaseByNameStmt.get(file.caseName) as { id: number } | undefined
          const isInBatchDuplicate = importedInBatch.has(file.caseName)
          if (existing || file.isDuplicate || isInBatchDuplicate) {
            if (file.duplicateStrategy === 'skip') {
              results.push({
                filePath: file.filePath,
                fileName,
                caseName: file.caseName,
                status: 'skipped',
                error: 'Duplicate case name'
              })
              skipped++
              continue
            } else if (existing) {
              deleteCaseStmt.run(existing.id)
            }
          }

          // Create case record
          if (!existsSync(file.filePath)) {
            throw new Error(`File not found: ${file.filePath}`)
          }
          const fileSize = statSync(file.filePath).size
          const caseResult = insertCaseStmt.run(file.caseName, file.filePath, fileSize, Date.now())
          const caseId = Number(caseResult.lastInsertRowid)

          const startTime = Date.now()
          let variantCount = 0
          let fileSkipped = 0

          try {
            // Detect format (reuse ImportService.detectFormat logic)
            const importService = new ImportService(null as never) // Only using detectFormat
            const formatInfo = await (importService as any).detectFormat(file.filePath)

            // Build and run the appropriate pipeline
            const flushFn = (cId: number, batch: Array<Record<string, unknown>>): void => {
              insertBatch(cId, batch)
            }

            const onProgress = (): void => {
              const now = Date.now()
              if (now - lastProgressTime >= msg.throttleMs) {
                lastProgressTime = now
                const progressMsg: WorkerMessage = {
                  type: 'progress',
                  fileIndex,
                  totalFiles,
                  fileName,
                  overallPercent: Math.round(((fileIndex + 0.5) / totalFiles) * 100),
                  phase: 'inserting',
                  variantCount,
                  skipped: fileSkipped
                }
                port.postMessage(progressMsg)
              }
            }

            const accumulator = createBatchAccumulator({
              caseId,
              batchSize,
              flushFn,
              onProgress: (update) => {
                variantCount = update.count
                fileSkipped = update.skipped ?? 0
                onProgress()
              },
              startTime
            })

            // Build pipeline based on format
            await runImportPipeline(file.filePath, formatInfo, accumulator)

            variantCount = accumulator.inserted
            fileSkipped = accumulator.skippedCount

            // Update case variant count
            updateVariantCountStmt.run(variantCount, caseId)

            const elapsed = Date.now() - startTime

            results.push({
              filePath: file.filePath,
              fileName,
              caseName: file.caseName,
              status: 'success',
              variantCount
            })
            succeeded++
            importedInBatch.add(file.caseName)

            const fileCompleteMsg: WorkerMessage = {
              type: 'file-complete',
              fileIndex,
              result: { caseId, caseName: file.caseName, variantCount, skipped: fileSkipped, elapsed }
            }
            port.postMessage(fileCompleteMsg)
          } catch (importError) {
            // Rollback case on import failure
            deleteCaseStmt.run(caseId)
            throw importError
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          const errorStack = error instanceof Error ? error.stack : undefined

          results.push({
            filePath: file.filePath,
            fileName,
            caseName: file.caseName,
            status: 'failed',
            error: errorMsg
          })
          failed++

          const workerErrorMsg: WorkerMessage = {
            type: 'error',
            fileIndex,
            error: errorMsg,
            phase: 'import',
            stack: errorStack
          }
          port.postMessage(workerErrorMsg)
        }

        // Send progress for file completion
        const progressMsg: WorkerMessage = {
          type: 'progress',
          fileIndex: fileIndex + 1,
          totalFiles,
          fileName: fileIndex + 1 < totalFiles ? basename(msg.files[fileIndex + 1].filePath) : fileName,
          overallPercent: Math.round(((fileIndex + 1) / totalFiles) * 100),
          phase: fileIndex + 1 < totalFiles ? 'reading' : 'finalizing',
          variantCount: 0,
          skipped: 0
        }
        port.postMessage(progressMsg)
      }

      // FTS rebuild + ANALYZE + optimize (non-interruptible)
      const finalizingMsg: WorkerMessage = {
        type: 'progress',
        fileIndex: totalFiles,
        totalFiles,
        fileName: '',
        overallPercent: 99,
        phase: 'finalizing',
        variantCount: 0,
        skipped: 0
      }
      port.postMessage(finalizingMsg)

      try {
        db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
      } catch (e) {
        // Log but don't fail
      }
      try {
        db.exec(createFTSTriggers)
      } catch (e) {
        // Log but don't fail
      }
      try {
        db.exec('ANALYZE')
      } catch (e) {
        // Log but don't fail
      }
      try {
        db.exec("INSERT INTO variants_fts(variants_fts) VALUES('optimize')")
      } catch (e) {
        // Log but don't fail
      }

      // Send completion
      const completeMsg: WorkerMessage = {
        type: 'complete',
        results: { succeeded, failed, skipped, cancelled, details: results }
      }
      port.postMessage(completeMsg)
    } catch (fatalError) {
      // Ensure FTS triggers are restored even on fatal error
      if (db) {
        try {
          db.exec(createFTSTriggers)
        } catch {
          // best effort
        }
      }

      const errorMsg: WorkerMessage = {
        type: 'error',
        fileIndex: -1,
        error: fatalError instanceof Error ? fatalError.message : String(fatalError),
        phase: 'fatal',
        stack: fatalError instanceof Error ? fatalError.stack : undefined
      }
      port.postMessage(errorMsg)
    } finally {
      if (db) {
        try {
          db.close()
        } catch {
          // best effort
        }
      }
    }
  }
})

/**
 * Detect format and run the appropriate streaming pipeline.
 * Reuses existing transform stages (FieldMapper, ObjectFormatMapper, BatchAccumulator).
 */
async function runImportPipeline(
  filePath: string,
  formatInfo: FormatInfo,
  accumulator: ReturnType<typeof createBatchAccumulator>
): Promise<void> {
  switch (formatInfo.format) {
    case 'simple':
      await pipeline(
        createReadStream(filePath),
        createGunzip(),
        parser(),
        pick({ filter: 'variants' }),
        streamArray(),
        createObjectFormatMapper(),
        accumulator
      )
      break

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      await pipeline(
        createReadStream(filePath),
        createGunzip(),
        parser(),
        pick({ filter: samplePath }),
        streamArray(),
        createObjectFormatMapper(),
        accumulator
      )
      break
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'

      // Parse header for dictionaries + column indices
      const { dictionaries, columnIndices } = await parseHeader(filePath, headerPath)
      const fieldMapper = createFieldMapper(dictionaries, columnIndices)

      await pipeline(
        createReadStream(filePath),
        createGunzip(),
        parser(),
        pick({ filter: dataPath }),
        streamArray(),
        fieldMapper,
        accumulator
      )
      break
    }
  }
}

/**
 * Parse columnar header to extract data dictionaries and column indices.
 * Extracted from ColumnarStrategy to reuse in worker context.
 */
async function parseHeader(
  filePath: string,
  headerPath: string
): Promise<{ dictionaries: DataDictionaries; columnIndices: ReturnType<typeof resolveColumnIndices> }> {
  return new Promise((resolve, reject) => {
    const dictionaries: DataDictionaries = {
      gene: {},
      impact: {},
      transcript: {},
      hpoSimScore: {},
      moi: {}
    }

    const headerItems: { id: string }[] = []
    const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'MoI'])
    let resolved = false

    const stream = createReadStream(filePath)
      .pipe(createGunzip())
      .pipe(parser())
      .pipe(pick({ filter: headerPath }))
      .pipe(streamArray())

    const cleanup = (): void => {
      stream.removeAllListeners()
      stream.destroy()
    }

    stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
      if (resolved) return

      const headerItem = data.value
      const fieldId = headerItem.id as string

      headerItems[data.key] = { id: fieldId }

      if (fieldsToExtract.has(fieldId) && headerItem.dataDictionary != null) {
        const rawDict = headerItem.dataDictionary as Record<string, unknown>

        switch (fieldId) {
          case 'Gene':
            dictionaries.gene = rawDict as Record<string, string>
            break
          case 'Transcript':
            dictionaries.transcript = rawDict as Record<string, string>
            break
          case 'HpoSimScore':
            dictionaries.hpoSimScore = rawDict as Record<string, number>
            break
          case 'MoI':
            for (const [key, value] of Object.entries(rawDict)) {
              if (Array.isArray(value) && value.length > 0) {
                const abbrevs = (value as { abbreviation?: string }[])
                  .map((obj) => obj.abbreviation)
                  .filter(Boolean)
                dictionaries.moi[key] = abbrevs.join(', ')
              } else {
                dictionaries.moi[key] = ''
              }
            }
            break
        }
      }
    })

    stream.on('end', () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve({ dictionaries, columnIndices: resolveColumnIndices(headerItems) })
    })

    stream.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(err)
    })
  })
}
```

**Important note for the implementer:** The `detectFormat` method is private on `ImportService`. You will need to either:
1. Extract `detectFormat` to a standalone exported function in `src/main/import/format-detection.ts`, OR
2. Make it a public static method on `ImportService`

Option 1 is cleaner. Extract `detectFormat` and `extractFirstSampleId` from `ImportService.ts` into a new `src/main/import/format-detection.ts` file, then import it in both `ImportService` and the worker. This avoids the `null as never` hack in the code above.

- [ ] **Step 4: Extract format detection to standalone module**

Create `src/main/import/format-detection.ts` with the `detectFormat` and `extractFirstSampleId` functions extracted from `ImportService.ts`. Update `ImportService.ts` to import and delegate to these functions. Update the worker to import `detectFormat` from the new module.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx electron-vite build && npx vitest run tests/main/import/import-worker.integration.test.ts`
Expected: PASS

- [ ] **Step 6: Run all existing tests**

Run: `npx vitest run tests/main/import/`
Expected: All PASS (including existing ImportService tests, which now use the extracted detectFormat)

- [ ] **Step 7: Commit**

```bash
git add src/main/workers/import-worker.ts \
  src/main/import/format-detection.ts \
  src/main/import/ImportService.ts \
  tests/main/import/import-worker.integration.test.ts
git commit -m "feat: implement import worker with full pipeline orchestration"
```

---

## Chunk 4: IPC Handler Rewiring

### Task 6: Rewire Import IPC Handlers to Use Worker

**Files:**
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: `src/main/ipc/handlers/batch-import.ts`

- [ ] **Step 1: Rewrite single import handler**

Replace `src/main/ipc/handlers/import.ts` to delegate to `ImportWorkerClient`:

```typescript
// src/main/ipc/handlers/import.ts
import { dialog, BrowserWindow, app } from 'electron'
import { dirname } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import type { WorkerMessage } from '../../../shared/types/import-worker'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config/api.config'

let workerClient: ImportWorkerClient | null = null

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

interface Settings {
  lastImportDirectory?: string
}

function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath()) === true) {
      return JSON.parse(readFileSync(settingsPath(), 'utf8'))
    }
  } catch {
    // Ignore
  }
  return {}
}

function saveSettings(settings: Settings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  } catch (error) {
    mainLogger.error(`Failed to save settings: ${error}`, 'import')
  }
}

function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) {
    mainLogger.warn(`Window closed during import, skipping ${channel}`, 'import')
    return
  }
  win.webContents.send(channel, data)
}

export function registerImportHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('import:selectFile', async () => {
    const settings = loadSettings()

    const result = await dialog.showOpenDialog({
      title: 'Select Variant File',
      defaultPath: settings.lastImportDirectory,
      properties: ['openFile'],
      filters: [
        { name: 'JSON Files', extensions: ['json', 'json.gz', 'gz'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled === true || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    saveSettings({ ...settings, lastImportDirectory: dirname(filePath) })
    return filePath
  })

  ipcMain.handle('import:start', async (_event, filePath: string, caseName: string) => {
    return wrapHandler(async () => {
      const db = getDb()

      if (workerClient?.isRunning) {
        throw new Error('An import is already in progress')
      }

      workerClient = new ImportWorkerClient()

      return new Promise((resolve, reject) => {
        let capturedCaseId = 0

        workerClient!.start({
          files: [{
            filePath,
            caseName,
            isDuplicate: false,
            duplicateStrategy: 'skip'
          }],
          dbPath: db.getPath(),
          // NOTE: encryption key must be threaded through — see Known Implementation Notes #7
          throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
          onProgress: (msg) => {
            safeEmit('import:progress', {
              phase: msg.phase,
              count: msg.variantCount,
              elapsed: 0,
              skipped: msg.skipped
            })
          },
          onFileComplete: (msg) => {
            // Capture caseId from file-complete (fires before onComplete)
            capturedCaseId = msg.result.caseId
          },
          onComplete: (msg) => {
            workerClient = null
            const detail = msg.results.details[0]
            if (detail && detail.status === 'success') {
              safeEmit('import:progress', {
                phase: 'inserting',
                count: detail.variantCount ?? 0,
                elapsed: 0,
                skipped: 0
              })
              resolve({
                caseId: capturedCaseId,
                variantCount: detail.variantCount ?? 0,
                skipped: 0,
                errors: [],
                elapsed: 0
              })
            } else {
              reject(new Error(detail?.error ?? 'Import failed'))
            }
          },
          onError: (msg) => {
            if (msg.fileIndex === -1) {
              workerClient = null
              reject(new Error(msg.error))
            }
          }
        })
      })
    })
  })

  ipcMain.handle('import:cancel', async () => {
    // Only send cancel — do NOT null out workerClient here.
    // The onComplete callback handles cleanup after the worker responds.
    if (workerClient !== null) {
      workerClient.cancel()
    }
  })
}
```

**Note on encryption key:** The `DatabaseService` does not expose the encryption key after construction. If encrypted databases need to work with the worker, you'll need to either:
1. Store the encryption key in `DatabaseService` and expose it via a getter, OR
2. Pass it through the IPC handler from the renderer (which already has it from the database open flow)

This is an implementation detail to resolve during coding.

- [ ] **Step 2: Rewrite batch import handler**

Update `src/main/ipc/handlers/batch-import.ts` — the `batch-import:start` handler should:
1. Build the `FileImportRequest[]` array (including duplicate check results)
2. Create an `ImportWorkerClient`
3. Relay progress/completion to renderer via `safeEmit('batch-import:progress', ...)`
4. Return the `BatchResult` from `onComplete`

The `batch-import:checkDuplicates` handler stays on the main thread (lightweight DB read). The ZIP handlers stay on the main thread (they don't block for long).

- [ ] **Step 3: Run lint and typecheck**

Run: `npx eslint src/main/ipc/handlers/import.ts src/main/ipc/handlers/batch-import.ts --fix && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Build and smoke test**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/import.ts src/main/ipc/handlers/batch-import.ts
git commit -m "feat: rewire import IPC handlers to use worker thread"
```

---

## Chunk 5: Import Status Store & UI Components

### Task 7: Pinia Import Status Store

**Files:**
- Create: `src/renderer/src/stores/importStatusStore.ts`

- [ ] **Step 1: Write the store**

```typescript
// src/renderer/src/stores/importStatusStore.ts
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type ImportPhase = 'idle' | 'importing' | 'finalizing' | 'complete' | 'error' | 'cancelled'

export interface ImportFileDetail {
  filePath: string
  fileName: string
  caseName: string
  status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped'
  variantCount?: number
  error?: string
}

export const useImportStatusStore = defineStore('importStatus', () => {
  // State
  const phase = ref<ImportPhase>('idle')
  const currentFileIndex = ref(0)
  const totalFiles = ref(0)
  const currentFileName = ref('')
  const overallPercent = ref(0)
  const currentPhase = ref('')
  const variantCount = ref(0)
  const skipped = ref(0)
  const startTime = ref(0)
  const dialogOpen = ref(false)
  const details = ref<ImportFileDetail[]>([])
  const errorMessage = ref('')

  // Reactive elapsed timer (Date.now() is not reactive, so we tick a counter)
  const elapsedTick = ref(0)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  // Computed
  const isActive = computed(() => phase.value === 'importing' || phase.value === 'finalizing')
  // eslint-disable-next-line no-undef
  const elapsedMs = computed(() => {
    void elapsedTick.value // reactive dependency
    return isActive.value ? Date.now() - startTime.value : 0
  })
  const fileProgress = computed(() =>
    totalFiles.value > 0 ? `${currentFileIndex.value}/${totalFiles.value}` : ''
  )

  // Actions
  function startImport(files: number): void {
    phase.value = 'importing'
    totalFiles.value = files
    currentFileIndex.value = 0
    overallPercent.value = 0
    variantCount.value = 0
    skipped.value = 0
    startTime.value = Date.now()
    details.value = []
    errorMessage.value = ''
    // Start 1-second timer for elapsed display
    if (elapsedTimer !== null) clearInterval(elapsedTimer)
    elapsedTimer = setInterval(() => { elapsedTick.value++ }, 1000)
  }

  function updateProgress(data: {
    fileIndex: number
    totalFiles: number
    fileName: string
    overallPercent: number
    phase: string
    variantCount: number
    skipped: number
  }): void {
    currentFileIndex.value = data.fileIndex
    totalFiles.value = data.totalFiles
    currentFileName.value = data.fileName
    overallPercent.value = data.overallPercent
    currentPhase.value = data.phase
    variantCount.value = data.variantCount
    skipped.value = data.skipped

    if (data.phase === 'finalizing') {
      phase.value = 'finalizing'
    }
  }

  function fileComplete(detail: ImportFileDetail): void {
    details.value.push(detail)
  }

  function importComplete(result: {
    succeeded: number
    failed: number
    skipped: number
    cancelled: boolean
    details: ImportFileDetail[]
  }): void {
    phase.value = result.cancelled ? 'cancelled' : 'complete'
    details.value = result.details
    overallPercent.value = 100
  }

  function importError(error: string): void {
    phase.value = 'error'
    errorMessage.value = error
  }

  function reset(): void {
    phase.value = 'idle'
    currentFileIndex.value = 0
    totalFiles.value = 0
    currentFileName.value = ''
    overallPercent.value = 0
    currentPhase.value = ''
    variantCount.value = 0
    skipped.value = 0
    startTime.value = 0
    dialogOpen.value = false
    details.value = []
    errorMessage.value = ''
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
    elapsedTick.value = 0
  }

  return {
    // State
    phase,
    currentFileIndex,
    totalFiles,
    currentFileName,
    overallPercent,
    currentPhase,
    variantCount,
    skipped,
    startTime,
    dialogOpen,
    details,
    errorMessage,
    // Computed
    isActive,
    elapsedMs,
    fileProgress,
    // Actions
    startImport,
    updateProgress,
    fileComplete,
    importComplete,
    importError,
    reset
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/stores/importStatusStore.ts
git commit -m "feat: add Pinia import status store"
```

---

### Task 8: ImportStatusChip Component

**Files:**
- Create: `src/renderer/src/components/ImportStatusChip.vue`
- Modify: `src/renderer/src/components/AppToolbar.vue`

- [ ] **Step 1: Create ImportStatusChip**

```vue
<!-- src/renderer/src/components/ImportStatusChip.vue -->
<template>
  <v-chip
    v-if="importStore.isActive"
    size="small"
    color="white"
    variant="outlined"
    class="mx-1 import-chip"
    @click="$emit('click')"
  >
    <v-progress-circular
      :indeterminate="importStore.phase === 'finalizing'"
      :model-value="importStore.overallPercent"
      size="16"
      width="2"
      class="mr-1"
    />
    <span class="text-caption">
      {{ importStore.fileProgress }}
      ({{ importStore.overallPercent }}%)
    </span>
    <v-tooltip activator="parent" location="bottom">
      {{ importStore.phase === 'finalizing' ? 'Finalizing import...' : `Importing ${importStore.currentFileName}` }}
    </v-tooltip>
  </v-chip>
</template>

<script setup lang="ts">
import { useImportStatusStore } from '../stores/importStatusStore'

const importStore = useImportStatusStore()

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.import-chip {
  cursor: pointer;
}
</style>
```

- [ ] **Step 2: Add chip to AppToolbar**

In `src/renderer/src/components/AppToolbar.vue`, add the chip before the `<v-spacer />`:

After the context indicator `</div>` closing tag (line ~63), before `<v-spacer />`, add:

```vue
<ImportStatusChip @click="$emit('show-import-progress')" />
```

Add the import:
```typescript
import ImportStatusChip from './ImportStatusChip.vue'
```

Add the emit:
```typescript
'show-import-progress': []
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ImportStatusChip.vue \
  src/renderer/src/components/AppToolbar.vue
git commit -m "feat: add import status chip to toolbar"
```

---

### Task 9: ImportStatusBar Component

**Files:**
- Create: `src/renderer/src/components/ImportStatusBar.vue`

- [ ] **Step 1: Create the status bar**

```vue
<!-- src/renderer/src/components/ImportStatusBar.vue -->
<template>
  <v-sheet
    v-if="importStore.isActive"
    color="grey-lighten-3"
    class="import-status-bar d-flex align-center px-3 py-1"
    elevation="1"
  >
    <v-progress-linear
      :model-value="importStore.overallPercent"
      :indeterminate="importStore.phase === 'finalizing'"
      color="primary"
      height="4"
      rounded
      class="mr-3 flex-grow-1"
      style="max-width: 200px"
    />

    <span class="text-caption text-truncate mr-2" style="max-width: 200px">
      {{ importStore.currentFileName }}
    </span>

    <span class="text-caption text-medium-emphasis mr-2">
      {{ importStore.variantCount.toLocaleString() }} variants
    </span>

    <span class="text-caption text-medium-emphasis mr-2">
      {{ formattedElapsed }}
    </span>

    <v-spacer />

    <v-btn size="x-small" variant="text" @click="$emit('expand')">
      Expand
    </v-btn>

    <v-btn size="x-small" variant="text" color="error" @click="$emit('cancel')">
      Cancel
    </v-btn>
  </v-sheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useImportStatusStore } from '../stores/importStatusStore'

const importStore = useImportStatusStore()

defineEmits<{
  expand: []
  cancel: []
}>()

const formattedElapsed = computed(() => {
  const ms = importStore.elapsedMs
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${remainingSeconds}s`
})
</script>

<style scoped>
.import-status-bar {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  height: 36px;
  min-height: 36px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/ImportStatusBar.vue
git commit -m "feat: add import status bar component"
```

---

## Chunk 6: Dialog Refactor & Wiring

### Task 10: Wire Import Dialogs to Store + Background Mode

**Files:**
- Modify: `src/renderer/src/components/ImportDialog.vue`
- Modify: `src/renderer/src/components/BatchImportDialog.vue`

This task adapts the existing import dialogs to:
1. Read progress state from `useImportStatusStore` instead of local refs
2. Add "Continue in Background" button that dismisses the dialog
3. Show completion via snackbar notification

- [ ] **Step 1: Read ImportDialog.vue and BatchImportDialog.vue thoroughly**

Before modifying, read both files completely to understand their current structure, sub-components, and event flow. The specific changes will depend on how they currently track progress.

- [ ] **Step 2: Update ImportDialog to use store**

Key changes:
- Replace local progress tracking refs with `useImportStatusStore()` reads
- The `import:progress` listener should update the store instead of local refs
- Add a "Continue in Background" button that sets `store.dialogOpen = false` and closes the dialog (import continues)
- On completion, if dialog is not open, show a snackbar

- [ ] **Step 3: Update BatchImportDialog to use store**

Same pattern as ImportDialog:
- Replace local progress tracking with store reads
- The `batch-import:progress` listener updates the store
- Add "Continue in Background" dismiss option
- Completion snackbar when dialog is closed

- [ ] **Step 4: Wire up the parent component**

Where `ImportDialog` and `BatchImportDialog` are rendered (likely `App.vue` or a layout component), add `ImportStatusBar` and handle its events:
- `@expand` reopens the import dialog
- `@cancel` calls the cancel IPC

Handle the `show-import-progress` emit from `AppToolbar` to reopen the progress dialog.

- [ ] **Step 5: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 6: Build and test manually**

Run: `make dev`
Expected: App launches, import works via worker thread, progress shows in toolbar chip and status bar

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ImportDialog.vue \
  src/renderer/src/components/BatchImportDialog.vue \
  src/renderer/src/components/ImportStatusBar.vue
git commit -m "feat: wire import dialogs to status store with background mode"
```

---

## Chunk 7: Cleanup & Final Verification

### Task 11: Remove Dead Code

**Files:**
- Modify: `src/main/import/BatchImportService.ts` (remove `processBatch`, keep `checkDuplicates` + helpers)
- Modify: `src/main/import/index.ts` (update exports)
- Modify: `src/main/database/VariantRepository.ts` (remove `insertVariantsBatch` method)

- [ ] **Step 1: Verify no remaining references to deleted code**

Search for `processBatch` and `insertVariantsBatch` across the codebase. Ensure:
- No code calls `batchImportService.processBatch()` (all import execution now goes through worker)
- No code calls `db.variants.insertVariantsBatch()` (worker uses raw prepared statements)
- `checkDuplicates` is still used by `batch-import:checkDuplicates` IPC handler

- [ ] **Step 2: Trim BatchImportService to utility**

Remove `processBatch` method from `BatchImportService.ts`. Keep `checkDuplicates`, `extractFileName`, and `extractCaseName` — these are still used by the batch-import IPC handler to build `FileImportRequest[]` and check for duplicates before sending to the worker. Remove the `ImportService` dependency from the constructor (no longer needed).

Alternatively, extract these into a standalone `src/main/import/batch-utils.ts` module with pure functions — this is cleaner since the class wrapper is no longer needed.

- [ ] **Step 3: Remove insertVariantsBatch from VariantRepository**

The variant insertion is now done via raw prepared statements in the worker. Remove the `insertVariantsBatch` method from `VariantRepository`. Keep all read/query methods.

Also remove the `createFTSTriggers` import if no longer used in this file.

- [ ] **Step 4: Remove duplicate updateCaseVariantCount calls in strategies**

In `ColumnarStrategy.ts:86`, `SimpleStrategy.ts`, and `ObjectStrategy.ts`, remove the `db.cases.updateCaseVariantCount(caseId, variantCount)` call — this is now handled by the worker.

- [ ] **Step 5: Run full CI checks**

Run: `make ci`
Expected: All lint, typecheck, and test checks pass

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "refactor: remove dead import code (BatchImportService, insertVariantsBatch)"
```

---

### Task 12: End-to-End Verification

- [ ] **Step 1: Build for Electron**

Run: `make rebuild && npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 2: Manual testing checklist**

Run `make dev` and verify:
- [ ] Single file import works (file picker → import → case appears)
- [ ] Batch import works (folder picker → duplicate check → import)
- [ ] Progress shows in toolbar chip during import
- [ ] Progress shows in status bar during import
- [ ] "Continue in Background" dismisses dialog, import continues
- [ ] Clicking toolbar chip reopens progress dialog
- [ ] Cancel stops the import
- [ ] UI remains responsive during large imports
- [ ] Completion triggers snackbar notification
- [ ] FTS search works after import (gene symbol search)
- [ ] ZIP import still works

- [ ] **Step 3: Run all tests**

Run: `make test`
Expected: All tests PASS

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -u
git commit -m "fix: address issues found during end-to-end verification"
```
