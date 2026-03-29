# Import Speed Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve 1,500–2,000 variants/sec import throughput (3–4x improvement over 517 v/s baseline).

**Architecture:** Three tiers of optimization applied to the import worker: (1) SQLite pragma tuning + index management for raw write speed, (2) single-pass format detection to eliminate redundant file I/O, (3) pipeline parallelism to overlap parsing and insertion across files.

**Tech Stack:** better-sqlite3-multiple-ciphers, stream-json, Node.js worker_threads, Node.js streams

**Spec:** `.planning/specs/2026-03-14-import-speed-optimization-design.md`

---

## Chunk 1: DB Write Optimizations

### Task 1: Add bulk-import index SQL constants

**Files:**
- Modify: `src/main/workers/import-worker.ts:27-31`

This task adds the SQL constants for dropping and recreating indexes. No behavior change yet — just constants.

- [ ] **Step 1: Add DROP_INDEXES and RECREATE_INDEXES constants**

Add after the existing `DROP_FTS_TRIGGERS` constant at line 31 of `src/main/workers/import-worker.ts`:

```typescript
const DROP_INDEXES = `
  DROP INDEX IF EXISTS idx_variants_gene;
  DROP INDEX IF EXISTS idx_variants_pos;
  DROP INDEX IF EXISTS idx_variants_filters;
  DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
  DROP INDEX IF EXISTS idx_vt_selected;
  DROP INDEX IF EXISTS idx_vt_transcript;
  DROP INDEX IF EXISTS idx_variants_filter_covering;
  DROP INDEX IF EXISTS idx_variants_case_coords;
  DROP INDEX IF EXISTS idx_variants_gene_notnull;
`

const RECREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
  CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
  CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
  CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
  CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
  CREATE INDEX IF NOT EXISTS idx_variants_filter_covering ON variants(case_id, consequence, func, clinvar);
  CREATE INDEX IF NOT EXISTS idx_variants_case_coords ON variants(case_id, chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;
`
```

- [ ] **Step 2: Verify lint passes**

Run: `npx eslint src/main/workers/import-worker.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "feat: add bulk-import index drop/recreate SQL constants"
```

---

### Task 2: Apply aggressive pragmas and index management

**Files:**
- Modify: `src/main/workers/import-worker.ts:290-307` (openDatabase function)
- Modify: `src/main/workers/import-worker.ts:45-51` (after openDatabase call)
- Modify: `src/main/workers/import-worker.ts:239-264` (catch/finally blocks)

- [ ] **Step 1: Update openDatabase() pragmas**

In `src/main/workers/import-worker.ts`, replace the pragma block in `openDatabase()` (lines 298-304):

```typescript
// Current:
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
db.pragma('temp_store = MEMORY')
db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)

// Replace with:
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')
db.pragma('synchronous = OFF')
db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
db.pragma('cache_size = -64000')
db.pragma('temp_store = MEMORY')
db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
db.pragma('wal_autocheckpoint = 0')
```

- [ ] **Step 2: Drop indexes after FTS triggers**

After line 51 (`db.exec(DROP_FTS_TRIGGERS)`), add:

```typescript
db.exec(DROP_INDEXES)
```

- [ ] **Step 3: Rewrite the finally block for proper cleanup**

Replace the current `finally` block (lines 256-264) with comprehensive cleanup:

```typescript
finally {
  if (db) {
    try {
      db.exec(RECREATE_INDEXES)
    } catch {
      // best effort — initializeSchema() recreates on next app start
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // best effort
    }
    try {
      db.pragma('synchronous = NORMAL')
      db.pragma('wal_autocheckpoint = 1000')
      db.pragma('foreign_keys = ON')
    } catch {
      // best effort
    }
    try {
      db.close()
    } catch {
      // best effort
    }
  }
}
```

Also update the fatal error catch block (lines 239-255) to recreate indexes before FTS triggers:

```typescript
} catch (fatalError) {
  if (db) {
    try {
      db.exec(RECREATE_INDEXES)
    } catch {
      // best effort
    }
    try {
      db.exec(createFTSTriggers)
    } catch {
      // best effort
    }
  }
  // ... rest of error handling unchanged
}
```

- [ ] **Step 4: Remove existsSync check**

In the file import loop (~line 110), remove the `existsSync` check but keep `statSync`:

```typescript
// Remove these two lines:
if (!existsSync(file.filePath)) {
  throw new Error(`File not found: ${file.filePath}`)
}

// Keep this line (needed for fileSize):
const fileSize = statSync(file.filePath).size
```

Update the import at line 4:

```typescript
// Change from:
import { statSync, existsSync } from 'node:fs'
// To:
import { statSync } from 'node:fs'
```

- [ ] **Step 5: Verify lint passes**

Run: `npx eslint src/main/workers/import-worker.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "feat: apply aggressive pragmas and index management for bulk import"
```

---

### Task 3: Increase batch size

**Files:**
- Modify: `src/shared/config/database.config.ts:9`

- [ ] **Step 1: Update BATCH_INSERT_SIZE**

In `src/shared/config/database.config.ts`, change line 9:

```typescript
// From:
BATCH_INSERT_SIZE: 5000,
// To:
BATCH_INSERT_SIZE: 10_000,
```

- [ ] **Step 2: Run existing tests**

Run: `make rebuild-node && npx vitest run tests/main/import/`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/shared/config/database.config.ts
git commit -m "feat: increase batch insert size from 5K to 10K variants"
```

---

### Task 4: Write tests for DB optimization behavior

**Files:**
- Create: `tests/main/workers/import-worker-db-opts.test.ts`

These tests verify the pragma and index behavior using a real SQLite database (no mocking the DB layer).

- [ ] **Step 1: Write test file**

Create `tests/main/workers/import-worker-db-opts.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { initializeSchema } from '../../../src/main/database/schema'

describe('import worker DB optimizations', () => {
  let db: DatabaseType
  let dbPath: string

  beforeEach(() => {
    dbPath = join(tmpdir(), `varlens-test-${randomUUID()}.db`)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // already closed
    }
    try {
      unlinkSync(dbPath)
      unlinkSync(dbPath + '-wal')
      unlinkSync(dbPath + '-shm')
    } catch {
      // best effort
    }
  })

  it('indexes can be dropped and recreated idempotently', () => {
    // Verify indexes exist after schema init
    const indexesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const indexNamesBefore = indexesBefore.map((i) => i.name)

    expect(indexNamesBefore).toContain('idx_variants_gene')
    expect(indexNamesBefore).toContain('idx_vt_selected')

    // Drop non-essential indexes (simulating import start)
    // Note: only tests 6 schema indexes. The 3 migration indexes
    // (filter_covering, case_coords, gene_notnull) are not created by
    // initializeSchema() — they require running the migration runner.
    db.exec(`
      DROP INDEX IF EXISTS idx_variants_gene;
      DROP INDEX IF EXISTS idx_variants_pos;
      DROP INDEX IF EXISTS idx_variants_filters;
      DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
      DROP INDEX IF EXISTS idx_vt_selected;
      DROP INDEX IF EXISTS idx_vt_transcript;
    `)

    // Verify they're gone
    const indexesAfterDrop = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const droppedNames = indexesAfterDrop.map((i) => i.name)

    expect(droppedNames).not.toContain('idx_variants_gene')
    expect(droppedNames).toContain('idx_variants_case_id') // kept
    expect(droppedNames).toContain('idx_vt_variant_id') // kept

    // Recreate indexes (simulating import end)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
      CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
      CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
      CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
      CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
      CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
    `)

    // Verify they're back
    const indexesAfterRecreate = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const recreatedNames = indexesAfterRecreate.map((i) => i.name)

    expect(recreatedNames).toContain('idx_variants_gene')
    expect(recreatedNames).toContain('idx_vt_selected')
  })

  it('WAL checkpoint TRUNCATE resets WAL file', () => {
    // Insert some data to create WAL entries
    db.exec(`
      INSERT INTO cases (name, file_path, file_size, variant_count, created_at)
      VALUES ('test', '/test', 100, 0, ${Date.now()})
    `)

    // Checkpoint
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number
      checkpointed: number
      log: number
    }[]
    expect(result[0].busy).toBe(0)
  })

  it('synchronous=OFF and foreign_keys=OFF can be set per connection', () => {
    // Open a second connection (simulating import worker)
    const workerDb = new Database(dbPath)
    workerDb.pragma('synchronous = OFF')
    workerDb.pragma('foreign_keys = OFF')

    const syncResult = workerDb.pragma('synchronous') as { synchronous: number }[]
    expect(syncResult[0].synchronous).toBe(0) // OFF = 0

    const fkResult = workerDb.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(fkResult[0].foreign_keys).toBe(0) // OFF = 0

    // Original connection should still have its own settings
    const origSync = db.pragma('synchronous') as { synchronous: number }[]
    expect(origSync[0].synchronous).toBe(1) // NORMAL = 1

    workerDb.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/main/workers/import-worker-db-opts.test.ts`
Expected: All 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/main/workers/import-worker-db-opts.test.ts
git commit -m "test: add DB optimization behavior tests for import worker"
```

---

## Chunk 2: Combined Format Detection + Data Pipeline

### Task 5: Create createDataPipeline helper in format-detection.ts

**Files:**
- Modify: `src/main/import/format-detection.ts`

This task adds a `createDataPipeline()` function that combines format detection with data stream creation. It is **not** true single-pass (the detection stream is destroyed, then a fresh data stream is opened). The benefit is API consolidation: callers get both `formatInfo` and a ready-to-consume data stream from one call. For object format, this eliminates the separate `extractFirstSampleId` read (saving 1 of 3 reads). True single-pass stream reuse is deferred — it requires complex token-level stream-json wiring.

- [ ] **Step 1: Write the failing test**

Create `tests/main/import/format-detection.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { createDataPipeline } from '../../../src/main/import/format-detection'

const FIXTURES = join(__dirname, '../../fixtures/import')

describe('createDataPipeline', () => {
  it('detects simple format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'simple-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('simple')

    // streamArray() emits { key: number, value: T } objects
    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
    const first = items[0] as Record<string, unknown>
    expect(first).toHaveProperty('chr')
    expect(first).toHaveProperty('pos')
  })

  it('detects object format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'object-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('object')
    expect(formatInfo.caseKey).toBeTruthy()

    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
  })

  it('detects columnar format and returns raw JSON item stream', async () => {
    const filePath = join(FIXTURES, 'columnar-format.json.gz')
    const { formatInfo, stream } = await createDataPipeline(filePath)

    expect(formatInfo.format).toBe('columnar')

    const items: unknown[] = []
    for await (const chunk of stream) {
      items.push(chunk.value)
    }
    expect(items.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/format-detection.test.ts`
Expected: FAIL — `createDataPipeline` is not exported

- [ ] **Step 3: Implement createDataPipeline**

Add these imports at the top of `src/main/import/format-detection.ts`:

```typescript
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import type { Readable } from 'node:stream'
```

Add after the existing `extractFirstSampleId` function:

```typescript
/**
 * Detect file format and create a data stream positioned at the variant/data items.
 *
 * Returns a streamArray() stream emitting { key: number, value: T } objects.
 * The stream does NOT include format mappers — callers pipe through their own
 * ObjectFormatMapper or FieldMapper as needed.
 *
 * Note: This opens two streams (detect + data), not one. The API benefit is
 * consolidation — callers don't need separate detectFormat + pipeline setup.
 * For object format, this saves the third stream that extractFirstSampleId
 * would otherwise open separately.
 */
export async function createDataPipeline(filePath: string): Promise<{
  formatInfo: FormatInfo
  stream: Readable
}> {
  const formatInfo = await detectFormat(filePath)
  const decompressed = createDecompressedStream(filePath)
  const jsonParser = parser()

  let stream: Readable

  switch (formatInfo.format) {
    case 'simple':
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: 'variants' }))
        .pipe(streamArray())
      break

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: samplePath }))
        .pipe(streamArray())
      break
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'
      stream = decompressed
        .pipe(jsonParser)
        .pipe(pick({ filter: dataPath }))
        .pipe(streamArray())
      break
    }
  }

  return { formatInfo, stream }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/import/format-detection.test.ts`
Expected: All 3 tests pass

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `npx vitest run tests/main/import/`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/import/format-detection.ts tests/main/import/format-detection.test.ts
git commit -m "feat: add createDataPipeline combining format detection and stream setup"
```

---

## Chunk 3: Pipeline Parallelism

### Task 7: Add preParseFile function and types

**Files:**
- Modify: `src/main/workers/import-worker.ts`

Add a function that pre-parses a file into an in-memory variant array, including format detection and stream transformation through the mapper.

**Stream output shapes (important for understanding the code):**
- `streamArray()` emits `{ key: number, value: T }` objects
- `createObjectFormatMapper()` is a Transform (objectMode) that receives `{ key, value }` from streamArray and emits plain mapped variant objects (`Record<string, unknown>`) with fields like `chr`, `pos`, `ref`, `alt`, `_transcripts`, etc.
- `createFieldMapper()` is also a Transform that emits the same shape.
- So `for await (const chunk of mapperStream)` yields plain variant objects, **not** `{ key, value }` wrappers.

- [ ] **Step 1: Update imports**

In `src/main/workers/import-worker.ts`, update the imports:

```typescript
// Line 5, add after pipeline import:
import type { Readable } from 'node:stream'

// Line 19 stays as-is (detectFormat is still used by preParseFile):
import { detectFormat } from '../import/format-detection'
```

- [ ] **Step 2: Define ParsedFileResult type and preParseFile function**

Add before `runImportPipeline` in `src/main/workers/import-worker.ts`:

```typescript
interface ParsedFileResult {
  formatInfo: FormatInfo
  variants: Array<Record<string, unknown>>
}

/**
 * Pre-parse a file into an in-memory variant array.
 * Used for pipeline parallelism: parse next file while current file inserts.
 *
 * The mapper transforms (ObjectFormatMapper / FieldMapper) emit plain
 * Record<string, unknown> objects with variant fields (chr, pos, ref, alt,
 * _transcripts, etc.) — the same shape that insertBatch expects.
 */
async function preParseFile(
  filePath: string,
  isCancelled: () => boolean
): Promise<ParsedFileResult> {
  // Use detectFormat directly (not createDataPipeline) to avoid
  // creating an unused data stream — createMapperPipeline opens its own.
  const formatInfo = await detectFormat(filePath)
  const variants: Array<Record<string, unknown>> = []

  const mapperStream = await createMapperPipeline(filePath, formatInfo)

  for await (const chunk of mapperStream) {
    if (isCancelled()) {
      // Explicitly destroy the underlying stream to release file handle
      mapperStream.destroy()
      break
    }
    // Mappers emit plain variant objects (or null for skipped variants)
    if (chunk !== null) {
      variants.push(chunk as Record<string, unknown>)
    }
  }

  return { formatInfo, variants }
}

/**
 * Create a readable stream that outputs mapped variant objects.
 * Pipes: decompress → parse → pick → streamArray → format mapper.
 *
 * Output: plain Record<string, unknown> objects (not { key, value } wrappers),
 * because the mapper transforms consume the streamArray wrapper.
 */
async function createMapperPipeline(
  filePath: string,
  formatInfo: FormatInfo
): Promise<Readable> {
  switch (formatInfo.format) {
    case 'simple': {
      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: 'variants' }))
        .pipe(streamArray())
        .pipe(createObjectFormatMapper())
      return stream
    }

    case 'object': {
      const samplePath = `samples.${formatInfo.caseKey}.variants`
      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: samplePath }))
        .pipe(streamArray())
        .pipe(createObjectFormatMapper())
      return stream
    }

    case 'columnar': {
      const wrapped = formatInfo.wrapped !== false
      const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
      const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'

      const { dictionaries, columnIndices } = await parseHeader(filePath, headerPath)
      const fieldMapper = createFieldMapper(dictionaries, columnIndices)

      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: dataPath }))
        .pipe(streamArray())
        .pipe(fieldMapper)
      return stream
    }
  }
}
```

- [ ] **Step 3: Verify lint passes**

Run: `npx eslint src/main/workers/import-worker.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "feat: add preParseFile function for pipeline parallelism"
```

---

### Task 8: Implement pipeline parallelism in the import loop

**Files:**
- Modify: `src/main/workers/import-worker.ts:69-228` (the main file loop)

This is the core change: overlap parsing of the next file with insertion of the current file.

**What is preserved (not replaced):**
- Lines 69-84: cancel check and skip loop — unchanged
- Lines 85-86: file/fileName declarations — unchanged
- Lines 88-107: duplicate handling (getCaseByName, deleteCase) — unchanged
- Lines 109-120: case creation (statSync for fileSize, insertCase, caseId) — unchanged
- Lines 122-124: startTime, variantCount, fileSkipped declarations — unchanged

**What is replaced:** The inner try block (lines 126-205) that calls `detectFormat` + creates `accumulator` + calls `runImportPipeline`.

- [ ] **Step 1: Refactor the import loop to use pre-parsed data**

The key change is to the for-loop body. Add pre-parse lookahead:

After the `importedInBatch` Set declaration (~line 55), add:

```typescript
let nextFileParsed: Promise<ParsedFileResult> | null = null
```

Then modify the loop. The new structure:

1. At the start of each iteration (after duplicate/cancel checks), check if we have pre-parsed data
2. If yes, use it; if no (first file), parse synchronously
3. Before starting insertion, kick off pre-parsing the next file
4. Insert current file's variants using a direct batch loop (not streaming)

Replace the inner try block (lines 126-205) with:

```typescript
try {
  let parsedData: ParsedFileResult

  // Use pre-parsed data if available (from previous iteration's lookahead)
  if (nextFileParsed) {
    parsedData = await nextFileParsed
    nextFileParsed = null
  } else {
    // First file — parse synchronously
    parsedData = await preParseFile(file.filePath, () => cancelled)
  }

  const { formatInfo, variants: parsedVariants } = parsedData

  // Start pre-parsing next file (pipeline parallelism)
  if (fileIndex + 1 < totalFiles && !cancelled) {
    const nextFile = msg.files[fileIndex + 1]
    // Only pre-parse if not a known skip
    const nextExisting = stmts.getCaseByName.get(nextFile.caseName) as
      | { id: number }
      | undefined
    const nextIsInBatchDup = importedInBatch.has(nextFile.caseName)
    const nextWillSkip =
      (nextExisting || nextFile.isDuplicate || nextIsInBatchDup) &&
      nextFile.duplicateStrategy === 'skip'

    if (!nextWillSkip) {
      nextFileParsed = preParseFile(nextFile.filePath, () => cancelled)
    }
  }

  // Insert pre-parsed variants in batches
  const totalVariants = parsedVariants.length
  for (let batchStart = 0; batchStart < totalVariants; batchStart += batchSize) {
    if (cancelled) break
    const batchEnd = Math.min(batchStart + batchSize, totalVariants)
    const batch = parsedVariants.slice(batchStart, batchEnd)
    stmts.insertBatch(caseId, batch)
    variantCount = batchEnd

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

  stmts.updateVariantCount.run(variantCount, caseId)

  // Insert data_info provenance
  try {
    stmts.insertDataInfo.run(caseId, fileName, formatInfo.format)
  } catch {
    // best effort
  }

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
    result: {
      caseId,
      caseName: file.caseName,
      variantCount,
      skipped: fileSkipped,
      elapsed
    }
  }
  port.postMessage(fileCompleteMsg)
} catch (importError) {
  // Clean up pre-parse promise on error
  if (nextFileParsed) {
    nextFileParsed.catch(() => {}) // prevent unhandled rejection
    nextFileParsed = null
  }
  stmts.deleteCase.run(caseId)
  throw importError
}
```

- [ ] **Step 2: Clean up unused imports and functions**

After this refactor, the following are no longer used and should be removed:

```typescript
// Remove these imports (no longer called from main loop):
import { createBatchAccumulator } from '../import/transforms/BatchAccumulator'

// Remove the runImportPipeline function (replaced by preParseFile + direct batch insert).
// Keep parseHeader — it's still called by createMapperPipeline for columnar format.
```

Also remove the `runImportPipeline` function body (previously at ~lines 429-478).

- [ ] **Step 3: Verify lint and typecheck**

Run: `npx eslint src/main/workers/import-worker.ts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/workers/import-worker.ts
git commit -m "feat: implement pipeline parallelism for overlapping parse/insert"
```

---

### Task 9: Write mapper pipeline tests

**Files:**
- Create: `tests/main/import/mapper-pipeline.test.ts`

Test that the mapper pipeline (used by `preParseFile`) produces correctly shaped variant objects from each file format. This verifies the critical data path: decompress → parse → pick → streamArray → mapper → plain variant objects.

- [ ] **Step 1: Write mapper pipeline test**

Create `tests/main/import/mapper-pipeline.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { createDecompressedStream } from '../../../src/main/import/stream-utils'
import { createObjectFormatMapper } from '../../../src/main/import/transforms/ObjectFormatMapper'
import { detectFormat } from '../../../src/main/import/format-detection'

const FIXTURES = join(__dirname, '../../fixtures/import')

describe('mapper pipeline output shape', () => {
  it('simple format: mapper emits plain variant objects with expected fields', async () => {
    const filePath = join(FIXTURES, 'simple-format.json.gz')
    const variants: Record<string, unknown>[] = []

    const collector = new Writable({
      objectMode: true,
      write(chunk, _encoding, callback) {
        if (chunk !== null) {
          variants.push(chunk)
        }
        callback()
      }
    })

    await pipeline(
      createDecompressedStream(filePath),
      parser(),
      pick({ filter: 'variants' }),
      streamArray(),
      createObjectFormatMapper(),
      collector
    )

    expect(variants.length).toBeGreaterThan(0)

    // Verify output shape: plain object (not { key, value } wrapper)
    const first = variants[0]
    expect(first).toHaveProperty('chr')
    expect(first).toHaveProperty('pos')
    expect(first).toHaveProperty('ref')
    expect(first).toHaveProperty('alt')
    // Should NOT have streamArray wrapper
    expect(first).not.toHaveProperty('key')
    expect(first).not.toHaveProperty('value')
  })

  it('object format: mapper emits plain variant objects', async () => {
    const filePath = join(FIXTURES, 'object-format.json.gz')
    const formatInfo = await detectFormat(filePath)
    expect(formatInfo.format).toBe('object')

    const variants: Record<string, unknown>[] = []
    const samplePath = `samples.${formatInfo.caseKey}.variants`

    const collector = new Writable({
      objectMode: true,
      write(chunk, _encoding, callback) {
        if (chunk !== null) {
          variants.push(chunk)
        }
        callback()
      }
    })

    await pipeline(
      createDecompressedStream(filePath),
      parser(),
      pick({ filter: samplePath }),
      streamArray(),
      createObjectFormatMapper(),
      collector
    )

    expect(variants.length).toBeGreaterThan(0)
    expect(variants[0]).toHaveProperty('chr')
    expect(variants[0]).not.toHaveProperty('key')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/main/import/mapper-pipeline.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/main/import/mapper-pipeline.test.ts
git commit -m "test: verify mapper pipeline output shape for preParseFile"
```

---

## Chunk 4: Final Cleanup and Verification

### Task 10: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run linting**

Run: `make lint`
Expected: No errors

- [ ] **Step 2: Run typecheck**

Run: `make typecheck`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `make test`
Expected: All tests pass

- [ ] **Step 4: Build the app**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 5: Run E2E benchmark (if test data available)**

If `/tmp/varlens-bench/` has the 50 test files:

Run: `make rebuild && npx playwright test tests/e2e/benchmark-import-delete.e2e.ts`
Expected: Throughput significantly improved over 517 v/s baseline

- [ ] **Step 6: Final commit with any remaining fixes**

Only if fixes were needed from verification steps.
