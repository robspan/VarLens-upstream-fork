# IPC Handler Testability & Error Standardization -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract testable logic from 12 orchestration-heavy IPC handlers, centralize safeEmit, standardize renderer error handling, and fix GeneBurdenView bug -- raising handler coverage from ~5.7% to >30%.

**Architecture:** 4-wave execution: Wave 0 fixes the GeneBurdenView bug immediately. Wave 1 builds infrastructure (shared safeEmit, unwrapIpcResult helper, ESLint rule). Wave 2 extracts logic from 12 Tier 1 handlers into companion `-logic.ts` modules. Wave 3 standardizes ~8 renderer error check sites. Wave 4 adds tests for all extracted logic and configures coverage thresholds.

**Tech Stack:** TypeScript, Electron 40, Vitest, better-sqlite3-multiple-ciphers, Zod, ESLint

**Spec:** [2026-04-02-ipc-testability-error-standardization-design.md](../specs/2026-04-02-ipc-testability-error-standardization-design.md)

---

## Task 1 (Wave 0): Fix GeneBurdenView.vue bug

**Files:** `src/renderer/src/components/association/GeneBurdenView.vue`

The `'error' in result` check at line 197 never catches `SerializableError` objects (which have `code`, `message`, `userMessage` -- not `error`). This means IPC failures silently get treated as success data.

### Steps

- [ ] Read `src/renderer/src/components/association/GeneBurdenView.vue` lines 190-210
- [ ] Add import for `isIpcError` at the top of the `<script setup>` block:
  ```typescript
  import { isIpcError } from '../../../../shared/types/errors'
  ```
- [ ] Replace line 197:
  ```typescript
  // BEFORE (BUG: 'error' is not a property on SerializableError):
  if (result !== null && typeof result === 'object' && 'error' in result) {
    throw new Error(String((result as { error: unknown }).error))
  }

  // AFTER:
  if (isIpcError(result)) {
    throw new Error(result.userMessage)
  }
  ```
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run lint:check`
- [ ] Commit: `fix(renderer): use isIpcError() in GeneBurdenView instead of broken 'error' in check`

---

## Task 2 (Wave 1): Create shared safeEmit utility

**Files:** `src/main/ipc/utils/safeEmit.ts` (new)

Extract the duplicated `safeEmit` function into a shared utility. This will be imported by handler files in Wave 2.

### Steps

- [ ] Create directory `src/main/ipc/utils/` if it does not exist
- [ ] Create `src/main/ipc/utils/safeEmit.ts` with:
  ```typescript
  import { BrowserWindow } from 'electron'
  import { mainLogger } from '../../services/MainLogger'

  /**
   * Safely send a message to the first renderer window.
   * No-op if the window is closed or destroyed.
   */
  export function safeEmit(channel: string, data: unknown): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined || win.isDestroyed()) {
      mainLogger.warn(`Window closed, skipping ${channel}`, 'ipc')
      return
    }
    win.webContents.send(channel, data)
  }
  ```
- [ ] Create `src/main/ipc/utils/index.ts` barrel:
  ```typescript
  export { safeEmit } from './safeEmit'
  ```
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `refactor(main): create shared safeEmit utility in src/main/ipc/utils/`

---

## Task 3 (Wave 1): Create unwrapIpcResult renderer helper

**Files:** `src/renderer/src/utils/ipc-result.ts` (new)

### Steps

- [ ] Create `src/renderer/src/utils/ipc-result.ts` with:
  ```typescript
  import { isIpcError, type SerializableError } from '../../../shared/types/errors'
  import { logService } from '../services/LogService'

  /**
   * Unwrap an IPC result, logging and returning null on error.
   * Use for wrapHandler-backed channels only.
   *
   * @param result - The raw IPC return value (T | SerializableError)
   * @param context - A label for log messages (e.g., 'CohortFilterBar.savePreset')
   * @returns The unwrapped value T, or null if the result was a SerializableError
   */
  export function unwrapIpcResult<T>(
    result: T | SerializableError,
    context: string
  ): T | null {
    if (isIpcError(result)) {
      logService.error(`${context}: ${result.userMessage}`, context)
      return null
    }
    return result
  }
  ```
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `feat(renderer): add unwrapIpcResult helper for standardized IPC error handling`

---

## Task 4 (Wave 1): Add ESLint rule banning ad-hoc error checks

**Files:** `eslint.config.js`

Add a `no-restricted-syntax` rule as a secondary safety net to catch new ad-hoc error patterns in renderer code.

### Steps

- [ ] Read `eslint.config.js` fully
- [ ] In the existing `no-restricted-syntax` block for renderer files (the one banning `window.api`), add additional selectors. The block currently targets `src/renderer/**/*.{ts,tsx,vue}`. Add a NEW config object after the existing `window.api` ban block (around line 104), before the closing `]`:
  ```javascript
  // Ban ad-hoc IPC error checks in renderer (use isIpcError or unwrapIpcResult)
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    ignores: ['src/renderer/src/utils/ipc-result.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "BinaryExpression[operator='in'][left.value='code'][right.type='Identifier']",
          message:
            "Use isIpcError(result) or unwrapIpcResult() instead of 'code' in result. See src/renderer/src/utils/ipc-result.ts."
        },
        {
          selector: "BinaryExpression[operator='in'][left.value='userMessage'][right.type='Identifier']",
          message:
            "Use isIpcError(result) or unwrapIpcResult() instead of 'userMessage' in result."
        }
      ]
    }
  }
  ```
  **Note:** This must be a separate config object from the existing `window.api` ban block because ESLint flat config merges `no-restricted-syntax` by replacement (last wins), not by appending. If we add selectors to the existing block, the `window.api` ban would be lost.
- [ ] Run `npx eslint --no-fix src/renderer/src/components/association/GeneBurdenView.vue` -- should pass (already fixed in Task 1)
- [ ] Run `npx eslint --no-fix src/renderer/src/components/cohort/CohortFilterBar.vue` -- should show warnings for lines 277 and 420 (confirming the rule catches existing violations)
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `chore(lint): add ESLint rule warning on ad-hoc IPC error checks in renderer`

---

## Task 5 (Wave 2): Extract cases-logic.ts -- THE PATTERN TASK

**Files:**
- `src/main/ipc/handlers/cases-logic.ts` (new)
- `src/main/ipc/handlers/cases.ts` (modify)

This is the pattern-setting task. All subsequent handler extractions follow this structure.

### Steps

- [ ] Read `src/main/ipc/handlers/cases.ts` fully
- [ ] Create `src/main/ipc/handlers/cases-logic.ts`:

```typescript
/**
 * Pure business logic for cases IPC handlers.
 * No Electron/IPC imports -- testable with plain DatabaseService.
 */
import { resolve } from 'node:path'
import { Worker } from 'worker_threads'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { DeleteWorkerRequest, DeleteWorkerResponse } from '../../workers/delete-worker'

/** Logger interface for dependency injection (testable without MainLogger) */
export interface LogFunctions {
  info: (msg: string, source: string) => void
  warn: (msg: string, source: string) => void
  error: (msg: string, source: string) => void
}

/** Callbacks for progress/notification events */
export interface CaseCallbacks {
  onCohortStale: (stale: boolean) => void
  onCasesDeleted: (deleted: number) => void
}

// Guard against concurrent delete operations.
// SQLite is single-writer -- overlapping deletes cause "database is locked".
let deleteInProgress = false

/**
 * Reset the delete-in-progress flag. Exposed for test cleanup only.
 */
export function resetDeleteLock(): void {
  deleteInProgress = false
}

/**
 * List all cases.
 */
export async function listCases(
  db: DatabaseService,
  pool: DbPool | null
): Promise<ReturnType<DatabaseService['cases']['getAllCases']>> {
  if (pool) {
    return await pool.run({ type: 'cases:list', params: [] })
  }
  return db.cases.getAllCases()
}

/**
 * Query cases with search/pagination.
 */
export async function queryCases(
  db: DatabaseService,
  pool: DbPool | null,
  params: Parameters<DatabaseService['cases']['queryCases']>[0]
): Promise<ReturnType<DatabaseService['cases']['queryCases']>> {
  if (pool) {
    return await pool.run({ type: 'cases:query', params: [params] })
  }
  return db.cases.queryCases(params)
}

/**
 * Run a delete operation in a worker thread to avoid blocking the main process.
 */
export function runDeleteWorker(
  request: DeleteWorkerRequest,
  logger: LogFunctions
): Promise<number> {
  return new Promise((res, rej) => {
    const workerPath = resolve(__dirname, 'delete-worker.js')
    const worker = new Worker(workerPath)
    let settled = false

    const settle = (fn: typeof res | typeof rej, value: unknown): void => {
      if (settled) return
      settled = true
      fn(value as number)
      worker.terminate().catch((e) => {
        logger.warn(`Delete worker termination failed: ${e}`, 'cases')
      })
    }

    worker.on('message', (msg: DeleteWorkerResponse) => {
      if (msg.type === 'complete') {
        settle(res, msg.deleted ?? 0)
      } else {
        settle(rej, new Error(msg.error ?? 'Delete worker failed'))
      }
    })

    worker.on('error', (err: Error) => {
      logger.error(`Delete worker error: ${err.message}`, 'cases')
      settle(rej, err)
    })

    worker.on('exit', (code) => {
      settle(rej, new Error(`Delete worker exited unexpectedly with code ${code}`))
    })

    worker.postMessage(request)
  })
}

/**
 * Delete a single case by ID.
 */
export async function deleteCase(
  db: DatabaseService,
  caseId: number,
  logger: LogFunctions,
  callbacks: CaseCallbacks
): Promise<undefined> {
  if (deleteInProgress) {
    logger.warn(`Delete already in progress, rejecting delete for case ${caseId}`, 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  deleteInProgress = true
  logger.info(`Starting single-case delete worker (id: ${caseId})`, 'cases')
  callbacks.onCohortStale(true)

  try {
    // Decrement frequencies BEFORE worker delete -- needs variant data still present.
    try {
      db.variants.decrementFrequencies(caseId)
    } catch (freqError) {
      logger.warn(`Failed to decrement variant frequencies: ${freqError}`, 'cases')
    }

    await runDeleteWorker(
      {
        type: 'deleteBatch',
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey(),
        ids: [caseId]
      },
      logger
    )

    callbacks.onCasesDeleted(1)
    callbacks.onCohortStale(false)
    return undefined
  } catch (error) {
    logger.error(
      `Single-case delete worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    // Recovery: frequencies were decremented before the worker ran.
    try {
      db.variants.recomputeAllFrequencies()
    } catch (e) {
      logger.warn(
        'Failed to recompute frequencies after delete failure: ' +
          (e instanceof Error ? e.message : String(e)),
        'cases'
      )
    }
    throw error
  } finally {
    deleteInProgress = false
  }
}

/**
 * Delete ALL cases.
 */
export async function deleteAllCases(
  db: DatabaseService,
  logger: LogFunctions,
  callbacks: CaseCallbacks
): Promise<number> {
  if (deleteInProgress) {
    logger.warn('Delete already in progress, rejecting deleteAll', 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  deleteInProgress = true
  logger.info(`Starting deleteAll worker (db: ${db.getPath()})`, 'cases')
  callbacks.onCohortStale(true)

  try {
    const deleted = await runDeleteWorker(
      {
        type: 'deleteAll',
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey()
      },
      logger
    )
    logger.info(`deleteAll completed: ${deleted} cases deleted`, 'cases')

    try {
      db.variants.recomputeAllFrequencies()
    } catch (freqError) {
      logger.warn(`Failed to recompute variant frequencies: ${freqError}`, 'cases')
    }

    callbacks.onCasesDeleted(deleted)
    callbacks.onCohortStale(false)
    return deleted
  } catch (error) {
    logger.error(
      `deleteAll worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    throw error
  } finally {
    deleteInProgress = false
  }
}

/**
 * Delete a batch of cases by IDs.
 */
export async function deleteBatchCases(
  db: DatabaseService,
  ids: number[],
  logger: LogFunctions,
  callbacks: CaseCallbacks
): Promise<number> {
  if (deleteInProgress) {
    logger.warn('Delete already in progress, rejecting deleteBatch', 'cases')
    throw new Error('A delete operation is already in progress. Please wait for it to finish.')
  }

  deleteInProgress = true
  callbacks.onCohortStale(true)

  try {
    const deleted = await runDeleteWorker(
      {
        type: 'deleteBatch',
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey(),
        ids
      },
      logger
    )

    try {
      db.variants.recomputeAllFrequencies()
    } catch (freqError) {
      logger.warn(`Failed to recompute variant frequencies: ${freqError}`, 'cases')
    }

    callbacks.onCasesDeleted(deleted)
    callbacks.onCohortStale(false)
    return deleted
  } catch (error) {
    logger.error(
      `deleteBatch worker failed: ${error instanceof Error ? error.message : error}`,
      'cases'
    )
    throw error
  } finally {
    deleteInProgress = false
  }
}
```

- [ ] Rewrite `src/main/ipc/handlers/cases.ts` as thin wrapper:

```typescript
import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema, CaseSearchParamsSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
import { safeEmit } from '../utils/safeEmit'
import * as casesLogic from './cases-logic'

// Schema for batch delete IDs array
const CaseIdArraySchema = z.array(z.number().int().positive()).min(1)

const logger: casesLogic.LogFunctions = mainLogger
const callbacks: casesLogic.CaseCallbacks = {
  onCohortStale: (stale) => safeEmit('cohort:summaryRebuilt', { is_stale: stale }),
  onCasesDeleted: (deleted) => safeEmit('cases:deleted', { deleted })
}

/**
 * Cases IPC handlers
 * Channels: cases:list, cases:delete, cases:deleteAll, cases:deleteBatch
 */
export function registerCaseHandlers({ ipcMain, getDb, getDbPool }: HandlerDependencies): void {
  ipcMain.handle('cases:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.() ?? null
      return casesLogic.listCases(getDb(), pool)
    })
  })

  ipcMain.handle('cases:query', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseSearchParamsSchema.safeParse(params)
      if (validated.success !== true) {
        mainLogger.error(`Invalid cases:query params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      const pool = getDbPool?.() ?? null
      return casesLogic.queryCases(getDb(), pool, validated.data)
    })
  })

  ipcMain.handle('cases:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      return casesLogic.deleteCase(getDb(), validated.data, logger, callbacks)
    })
  })

  ipcMain.handle('cases:deleteAll', async () => {
    return wrapHandler(async () => {
      return casesLogic.deleteAllCases(getDb(), logger, callbacks)
    })
  })

  ipcMain.handle('cases:deleteBatch', async (_event, ids: unknown) => {
    return wrapHandler(async () => {
      const validated = CaseIdArraySchema.safeParse(ids)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:deleteBatch params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }
      return casesLogic.deleteBatchCases(getDb(), validated.data, logger, callbacks)
    })
  })
}
```

- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/cases-handlers.test.ts` (existing tests still pass)
- [ ] Commit: `refactor(main): extract cases-logic.ts from cases.ts handler`

---

## Task 6 (Wave 2): Extract variants-logic.ts

**Files:**
- `src/main/ipc/handlers/variants-logic.ts` (new)
- `src/main/ipc/handlers/variants.ts` (modify)

### Functions to extract

```typescript
// variants-logic.ts
export function queryVariants(
  db: DatabaseService,
  pool: DbPool | null,
  caseId: number,
  filters: Partial<VariantFilter>,
  offset: number,
  limit: number,
  sortBy?: SortItem[],
  skipCount?: boolean,
  includeUnfilteredCount?: boolean
): Promise<...>

export function getFilterOptions(
  db: DatabaseService,
  pool: DbPool | null,
  caseId: number
): Promise<...>

export function searchVariants(
  db: DatabaseService,
  pool: DbPool | null,
  caseId: number,
  query: string,
  limit: number
): Promise<...>

export function getGeneSymbols(
  db: DatabaseService,
  pool: DbPool | null,
  caseId: number,
  query: string,
  limit: number
): Promise<...>
```

### Steps

- [ ] Read `src/main/ipc/handlers/variants.ts` fully
- [ ] Create `src/main/ipc/handlers/variants-logic.ts` extracting the 4 functions above. Move the panel interval computation logic (`computePanelIntervals` call + genome_build resolution) into `queryVariants`. The function takes `getDb` as well to look up `caseData.genome_build`
- [ ] Rewrite `variants.ts` as thin wrapper: Zod validation stays in the handler, validated params are passed to logic functions. Keep `clearPanelIntervalCache` re-export
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/variants-handlers.test.ts`
- [ ] Commit: `refactor(main): extract variants-logic.ts from variants.ts handler`

---

## Task 7 (Wave 2): Extract cohort-logic.ts

**Files:**
- `src/main/ipc/handlers/cohort-logic.ts` (new)
- `src/main/ipc/handlers/cohort.ts` (modify)

### Functions to extract

```typescript
// cohort-logic.ts
export function getCohortVariants(db: DatabaseService, pool: DbPool | null, params: CohortSearchParams): Promise<...>
export function getColumnMeta(db: DatabaseService, pool: DbPool | null): Promise<...>
export function getCohortSummary(db: DatabaseService, pool: DbPool | null): Promise<...>
export function getCarriers(db: DatabaseService, pool: DbPool | null, chr: string, pos: number, ref: string, alt: string): Promise<...>
export function getGeneBurden(db: DatabaseService, pool: DbPool | null): Promise<...>
export function runGeneBurdenCompare(db: DatabaseService, pool: DbPool | null, config: AssociationConfig, onProgress: (completed: number, total: number) => void): Promise<...>
export function cancelGeneBurdenCompare(): void
export function getSummaryStatus(db: DatabaseService, pool: DbPool | null): Promise<...>
export function rebuildSummary(db: DatabaseService, callbacks: { onStale: (stale: boolean) => void }): Promise<void>
export function spawnRebuildWorker(dbPath: string, encryptionKey?: string): Promise<void>
export function triggerStartupRebuildIfNeeded(db: DatabaseService, callbacks: { onStale: (stale: boolean) => void }, logger: LogFunctions): void
```

### Steps

- [ ] Read `src/main/ipc/handlers/cohort.ts` fully
- [ ] Create `cohort-logic.ts` with functions above. Move `activeEngine` state, `spawnRebuildWorker`, `triggerStartupRebuildIfNeeded` into the logic module. `triggerStartupRebuildIfNeeded` takes a callbacks parameter instead of calling `safeEmit` directly
- [ ] Rewrite `cohort.ts` as thin wrapper. Replace local `safeEmit` with shared import. Export `triggerStartupRebuildIfNeeded` that wraps the logic version with safeEmit callbacks
- [ ] Update `src/main/ipc/handlers/database.ts` import of `triggerStartupRebuildIfNeeded` if the export signature changed
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/cohort-handlers.test.ts`
- [ ] Commit: `refactor(main): extract cohort-logic.ts from cohort.ts handler`

---

## Task 8 (Wave 2): Extract import-logic.ts

**Files:**
- `src/main/ipc/handlers/import-logic.ts` (new)
- `src/main/ipc/handlers/import.ts` (modify)

### Functions to extract

```typescript
// import-logic.ts
export function startImport(
  db: DatabaseService,
  filePath: string,
  caseName: string,
  vcfOptions: { selectedSample?: string; genomeBuild?: string } | undefined,
  callbacks: {
    onProgress: (data: { phase: string; count: number; elapsed: number; skipped: number }) => void
  },
  logger: LogFunctions
): Promise<ImportResult>

export function cancelImport(): void

export async function getVcfPreview(filePath: string): Promise<...>
```

**Note:** `import:selectFile` stays in handler (uses `dialog.showOpenDialog` -- Electron API). `import:start` logic (worker orchestration, frequency update, result mapping) is extracted. `workerClient` state moves to logic module.

### Steps

- [ ] Read `src/main/ipc/handlers/import.ts` fully
- [ ] Create `import-logic.ts` extracting worker orchestration and import result handling
- [ ] Rewrite `import.ts` as thin wrapper. Replace local `safeEmit` with shared import. `selectFile` handler stays mostly as-is (Electron dialog)
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `refactor(main): extract import-logic.ts from import.ts handler`

---

## Task 9 (Wave 2): Extract batch-import-logic.ts

**Files:**
- `src/main/ipc/handlers/batch-import-logic.ts` (new)
- `src/main/ipc/handlers/batch-import.ts` (modify)

### Functions to extract

```typescript
// batch-import-logic.ts
export function checkDuplicatesForBatch(db: DatabaseService, filePaths: string[], stripText?: string): DuplicateCheckResult
export function startBatchImport(
  db: DatabaseService,
  filePaths: string[],
  duplicateStrategy: DuplicateChoice,
  stripText: string | undefined,
  callbacks: {
    onProgress: (data: BatchProgressData) => void
    onComplete: (result: BatchResult) => void
    onCohortStale: (stale: boolean) => void
  },
  logger: LogFunctions
): Promise<BatchResult>
export function cancelBatchImport(): void
export function selectZipFile(zipExtractor: ZipExtractor, filePath: string): { filePath: string; isEncrypted: boolean } | null
export function testZipPassword(zipExtractor: ZipExtractor, zipPath: string, password: string): { success: boolean }
export function extractZip(zipExtractor: ZipExtractor, zipPath: string, password?: string): Promise<{ files: string[]; errors: string[] }>
export function cleanupZipTemp(): void
```

**Note:** `selectFiles`, `selectFolder` stay in handler (Electron dialog). ZIP operations and batch import orchestration are extracted.

### Steps

- [ ] Read `src/main/ipc/handlers/batch-import.ts` fully
- [ ] Create `batch-import-logic.ts` extracting worker orchestration, duplicate checking, and ZIP operations
- [ ] Rewrite `batch-import.ts` as thin wrapper. Replace local `safeEmit` with shared import
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `refactor(main): extract batch-import-logic.ts from batch-import.ts handler`

---

## Task 10 (Wave 2): Extract export-logic.ts

**Files:**
- `src/main/ipc/handlers/export-logic.ts` (new)
- `src/main/ipc/handlers/export.ts` (modify)

### Functions to extract

```typescript
// export-logic.ts
export const EXPORT_HARD_LIMIT = 100_000
export const COHORT_EXPORT_COLUMNS = [...]

export function prepareVariantExport(
  db: DatabaseService,
  caseId: number,
  filters: Partial<VariantFilter>,
  caseName: string
): { count: number; compiled: { sql: string; parameters: unknown[] }; filterSummary: ExportFilterSummary; defaultFileName: string } | { error: string }

export function buildCohortExportWorkbook(
  db: DatabaseService,
  params: CohortSearchParams
): { buffer: Buffer; defaultFileName: string } | { error: string }
```

**Note:** Dialog interactions and worker spawning stay in handler. The data preparation logic (filter summary building, count checking, workbook generation) is extracted.

### Steps

- [ ] Read `src/main/ipc/handlers/export.ts` fully
- [ ] Create `export-logic.ts` extracting data preparation and workbook building logic
- [ ] Rewrite `export.ts` as thin wrapper. Replace direct `webContents.send` with shared `safeEmit` import for `export:progress` events
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/export-handlers.test.ts`
- [ ] Commit: `refactor(main): extract export-logic.ts from export.ts handler`

---

## Task 11 (Wave 2): Extract annotations-logic.ts

**Files:**
- `src/main/ipc/handlers/annotations-logic.ts` (new)
- `src/main/ipc/handlers/annotations.ts` (modify)

### Functions to extract

```typescript
// annotations-logic.ts
export function getGlobalAnnotation(db: DatabaseService, pool: DbPool | null, chr: string, pos: number, ref: string, alt: string): Promise<...>
export function upsertGlobalAnnotation(db: DatabaseService, coords: VariantCoords, updates: GlobalAnnotationUpdates, userName?: string): AnnotationResult
export function deleteGlobalAnnotation(db: DatabaseService, chr: string, pos: number, ref: string, alt: string): void
export function getPerCaseAnnotation(db: DatabaseService, pool: DbPool | null, caseId: number, variantId: number): Promise<...>
export function upsertPerCaseAnnotation(db: DatabaseService, caseId: number, variantId: number, updates: PerCaseAnnotationUpdates, userName?: string): AnnotationResult
export function deletePerCaseAnnotation(db: DatabaseService, caseId: number, variantId: number): void
export function getAnnotationsForVariant(db: DatabaseService, pool: DbPool | null, caseId: number, chr: string, pos: number, ref: string, alt: string): Promise<...>
export function batchGetAnnotations(db: DatabaseService, pool: DbPool | null, caseId: number | null, variantKeys: VariantKey[]): Promise<...>
```

The key complexity is in `upsertGlobalAnnotation` and `upsertPerCaseAnnotation` which contain the audit logging logic -- this is the high-value extraction target.

### Steps

- [ ] Read `src/main/ipc/handlers/annotations.ts` fully
- [ ] Create `annotations-logic.ts` extracting all 8 functions. The upsert functions include the audit trail logic (reading old state, building dbUpdates, calling appendEntry)
- [ ] Rewrite `annotations.ts` as thin wrapper (Zod validation stays)
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/annotations-handlers.test.ts`
- [ ] Commit: `refactor(main): extract annotations-logic.ts from annotations.ts handler`

---

## Task 12 (Wave 2): Extract case-metadata-logic.ts

**Files:**
- `src/main/ipc/handlers/case-metadata-logic.ts` (new)
- `src/main/ipc/handlers/case-metadata.ts` (modify)

### Functions to extract

This is a large file (642 lines, 19 handlers) but all are thin CRUD. Extract as pass-through functions:

```typescript
// case-metadata-logic.ts
// Case metadata
export function getCaseMetadata(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>
export function upsertCaseMetadata(db: DatabaseService, caseId: number, updates: MetadataUpdates): ...

// Cohort groups
export function listCohortGroups(db: DatabaseService, pool: DbPool | null): Promise<...>
export function createCohortGroup(db: DatabaseService, name: string, description?: string | null): ...
export function updateCohortGroup(db: DatabaseService, cohortId: number, updates: CohortUpdates): ...
export function deleteCohortGroup(db: DatabaseService, cohortId: number): void
export function getCohortGroupByName(db: DatabaseService, pool: DbPool | null, name: string): Promise<...>

// Case-Cohort links
export function getCaseCohorts(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>
export function assignCohort(db: DatabaseService, caseId: number, cohortId: number): ...
export function removeCohort(db: DatabaseService, caseId: number, cohortId: number): void
export function setCohorts(db: DatabaseService, caseId: number, cohortIds: number[]): ...

// HPO Terms
export function getHpoTerms(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>
export function assignHpoTerm(db: DatabaseService, caseId: number, hpoId: string, hpoLabel: string): ...
export function removeHpoTerm(db: DatabaseService, caseId: number, hpoId: string): void

// Data Info
export function getDataInfo(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>
export function upsertDataInfo(db: DatabaseService, caseId: number, updates: DataInfoUpdates): ...

// External IDs
export function upsertExternalId(db: DatabaseService, caseId: number, idType: string, idValue: string): ...
export function deleteExternalId(db: DatabaseService, caseId: number, idType: string): void
export function getExternalIds(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>

// Full metadata
export function getFullMetadata(db: DatabaseService, pool: DbPool | null, caseId: number): Promise<...>
```

### Steps

- [ ] Read `src/main/ipc/handlers/case-metadata.ts` fully
- [ ] Create `case-metadata-logic.ts` with all functions above. Each function takes `db` and `pool` (where applicable) as explicit params. Pool-aware functions try pool first, fall back to direct db call
- [ ] Rewrite `case-metadata.ts` as thin wrapper. Keep Zod schemas and validation in handler
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/case-metadata-handlers.test.ts`
- [ ] Commit: `refactor(main): extract case-metadata-logic.ts from case-metadata.ts handler`

---

## Task 13 (Wave 2): Extract panels-logic.ts

**Files:**
- `src/main/ipc/handlers/panels-logic.ts` (new)
- `src/main/ipc/handlers/panels.ts` (modify)

### Functions to extract

```typescript
// panels-logic.ts
// Panel CRUD
export function listPanels(db: DatabaseService): ...
export function getPanel(db: DatabaseService, id: number): ...
export function createPanel(db: DatabaseService, params: PanelCreateParams): ...
export function updatePanel(db: DatabaseService, id: number, updates: PanelUpdateParams): ...
export function deletePanel(db: DatabaseService, id: number): ...
export function duplicatePanel(db: DatabaseService, id: number, newName: string): ...

// Panel genes
export function setGenes(db: DatabaseService, panelId: number, genes: PanelGene[]): ...
export function getGenes(db: DatabaseService, panelId: number): ...

// Activation
export function activatePanel(db: DatabaseService, caseId: number, panelId: number, paddingBp?: number): ...
export function deactivatePanel(db: DatabaseService, caseId: number, panelId: number): ...
export function getActivePanelsForCase(db: DatabaseService, caseId: number): ...

// Gene reference
export function validateSymbols(symbols: string[]): ...
export function autocomplete(query: string, limit?: number): ...

// PanelApp import (complex -- high-value extraction)
export function importFromPanelApp(db: DatabaseService, params: PanelAppImportParams): Promise<PanelWithGenes>
export function generateFromStringDb(db: DatabaseService, params: StringDbParams): Promise<PanelWithGenes>

// BED export (data prep only, dialog stays in handler)
export function buildBedContent(db: DatabaseService, panelId: number, assembly: string, paddingBp: number): string
```

### Steps

- [ ] Read `src/main/ipc/handlers/panels.ts` fully
- [ ] Create `panels-logic.ts`. The PanelApp import and StringDB generation functions contain the most valuable logic (gene validation, confidence filtering, resolved gene building)
- [ ] Rewrite `panels.ts` as thin wrapper. Keep `clearPanelIntervalCache` calls in handler (side effect coordination). Dialog interactions (`export-bed` save dialog) stay in handler
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `refactor(main): extract panels-logic.ts from panels.ts handler`

---

## Task 14 (Wave 2): Extract database-logic.ts

**Files:**
- `src/main/ipc/handlers/database-logic.ts` (new)
- `src/main/ipc/handlers/database.ts` (modify)

### Functions to extract

```typescript
// database-logic.ts
export const ALLOWED_DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3'])

export function openDatabase(
  manager: DatabaseManager,
  path: string,
  password?: string,
  postOpen?: { initPool: (path: string, password?: string) => Promise<void>; triggerRebuild: (db: DatabaseService) => void }
): Promise<{ success: boolean; needsPassword?: boolean; error?: string; info?: DatabaseInfo }>

export function createDatabase(
  manager: DatabaseManager,
  path: string,
  password?: string,
  postCreate?: { initPool: (path: string, password?: string) => Promise<void> }
): Promise<{ success: boolean; info?: DatabaseInfo }>

export function rekeyDatabase(manager: DatabaseManager, newPassword?: string): { success: boolean }

export function getDatabaseInfo(manager: DatabaseManager): DatabaseInfo | null
export function getRecentDatabases(manager: DatabaseManager): RecentDatabase[]
export function getDatabaseOverview(db: DatabaseService, pool: DbPool | null): Promise<...>

export function removeRecentDatabase(manager: DatabaseManager, path: string): { success: boolean }
export function validateAndDeleteDatabase(manager: DatabaseManager, canonicalPath: string): Promise<{ success: boolean }>
```

**Note:** `selectFile` and `selectSaveLocation` stay in handler (Electron dialog). The open/create/rekey/delete logic with its error handling is the extraction target.

### Steps

- [ ] Read `src/main/ipc/handlers/database.ts` fully
- [ ] Create `database-logic.ts` extracting the database lifecycle logic
- [ ] Rewrite `database.ts` as thin wrapper. Keep dialog interactions in handler
- [ ] Verify: `npm run typecheck`
- [ ] Commit: `refactor(main): extract database-logic.ts from database.ts handler`

---

## Task 15 (Wave 2): Extract auth-logic.ts

**Files:**
- `src/main/ipc/handlers/auth-logic.ts` (new)
- `src/main/ipc/handlers/auth.ts` (modify)

### Functions to extract

```typescript
// auth-logic.ts
export function login(db: DatabaseService, username: string, password: string): Promise<AuthResult>
export function logout(db: DatabaseService): void
export function getCurrentUser(db: DatabaseService): User | null
export function isAccountsEnabled(db: DatabaseService): boolean
export function createUser(db: DatabaseService, username: string, displayName: string, tempPassword: string): Promise<...>
export function listUsers(db: DatabaseService): Promise<...>
export function deactivateUser(db: DatabaseService, username: string): Promise<void>
export function resetPassword(db: DatabaseService, username: string, newPassword: string): Promise<void>
export function changePassword(db: DatabaseService, username: string, oldPassword: string, newPassword: string): Promise<void>
```

The admin check logic (`currentUser.role !== 'admin'`) moves into the logic functions.

### Steps

- [ ] Read `src/main/ipc/handlers/auth.ts` fully
- [ ] Create `auth-logic.ts` extracting all 9 functions. Admin checks move into logic functions
- [ ] Rewrite `auth.ts` as thin wrapper
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/auth-handlers.test.ts`
- [ ] Commit: `refactor(main): extract auth-logic.ts from auth.ts handler`

---

## Task 16 (Wave 2): Extract tags-logic.ts

**Files:**
- `src/main/ipc/handlers/tags-logic.ts` (new)
- `src/main/ipc/handlers/tags.ts` (modify)

### Functions to extract

```typescript
// tags-logic.ts
export function listTags(db: DatabaseService, pool: DbPool | null): Promise<...>
export function createTag(db: DatabaseService, name: string, color: string): ...
export function updateTag(db: DatabaseService, id: number, updates: TagUpdates): ...
export function deleteTag(db: DatabaseService, id: number): void
export function getTagUsageCount(db: DatabaseService, pool: DbPool | null, tagId: number): Promise<...>
export function getVariantTags(db: DatabaseService, pool: DbPool | null, caseId: number, variantId: number): Promise<...>
export function assignVariantTag(db: DatabaseService, caseId: number, variantId: number, tagId: number): void
export function removeVariantTag(db: DatabaseService, caseId: number, variantId: number, tagId: number): void
export function setVariantTags(db: DatabaseService, caseId: number, variantId: number, tagIds: number[]): void
```

### Steps

- [ ] Read `src/main/ipc/handlers/tags.ts` fully
- [ ] Create `tags-logic.ts` extracting all 9 functions. Pool-aware functions try pool first
- [ ] Rewrite `tags.ts` as thin wrapper
- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run test -- --run tests/main/handlers/tags-handlers.test.ts`
- [ ] Commit: `refactor(main): extract tags-logic.ts from tags.ts handler`

---

## Task 17 (Wave 3): Standardize renderer error checks

**Files:**
- `src/renderer/src/components/cohort/CohortFilterBar.vue`
- `src/renderer/src/composables/useFilterExport.ts`
- `src/renderer/src/components/CohortTable.vue`
- `src/renderer/src/components/FilterToolbar.vue`
- `src/renderer/src/components/import/ImportWizard.vue`

Replace all ad-hoc error patterns with `isIpcError()` (or `unwrapIpcResult()` where it simplifies the code).

### Steps

- [ ] **CohortFilterBar.vue line 277** -- replace `'code' in result` with `isIpcError(result)`:
  ```typescript
  // Add import at top of <script setup>:
  import { isIpcError } from '../../../../shared/types/errors'

  // Line 277 - BEFORE:
  if (result !== null && typeof result === 'object' && 'code' in result) {
  // AFTER:
  if (isIpcError(result)) {
  ```

- [ ] **CohortFilterBar.vue line 420** -- replace `'code' in result`:
  ```typescript
  // Line 420 - BEFORE:
  if (result !== null && result !== undefined && 'code' in result) {
  // AFTER:
  if (isIpcError(result)) {
  ```

- [ ] **useFilterExport.ts line 33** -- replace `'code' in result`:
  ```typescript
  // Add import at top:
  import { isIpcError } from '../../../../shared/types/errors'

  // Line 33 - BEFORE:
  if (result !== null && result !== undefined && 'code' in result) {
    return {
      success: false,
      error: result.message ?? result.userMessage ?? 'Unknown error'
    }
  }
  // AFTER:
  if (isIpcError(result)) {
    return {
      success: false,
      error: result.userMessage
    }
  }
  ```

- [ ] **CohortTable.vue line 300** -- replace `'code' in result`:
  ```typescript
  // Add import at top of <script setup>:
  import { isIpcError } from '../../../shared/types/errors'

  // Line 300 - BEFORE:
  if (result !== null && result !== undefined && 'code' in result) {
    snackbar.value = {
      visible: true,
      message: `Export failed: ${result.message ?? result.userMessage ?? 'Unknown error'}`,
  // AFTER:
  if (isIpcError(result)) {
    snackbar.value = {
      visible: true,
      message: `Export failed: ${result.userMessage}`,
  ```

- [ ] **FilterToolbar.vue line 382** -- replace `'code' in result`:
  ```typescript
  // Add import at top of <script setup>:
  import { isIpcError } from '../../../shared/types/errors'

  // Line 382 - BEFORE:
  if (result !== null && typeof result === 'object' && 'code' in result) {
  // AFTER:
  if (isIpcError(result)) {
  ```

- [ ] **ImportWizard.vue line 478** -- replace `'userMessage' in resultObj`:
  ```typescript
  // Add import at top of <script setup>:
  import { isIpcError } from '../../../../shared/types/errors'

  // Lines 476-478 - BEFORE:
  const resultObj = result as unknown as Record<string, unknown>
  if ('userMessage' in resultObj) {
  // AFTER:
  if (isIpcError(result)) {
  ```
  And update the error message extraction on line 485:
  ```typescript
  // BEFORE:
  error: String(resultObj.userMessage)
  // AFTER:
  error: (result as { userMessage: string }).userMessage
  ```

- [ ] **ImportWizard.vue line ~563-565** -- replace `'userMessage' in (result as ...)`:
  ```typescript
  // Lines 563-565 - BEFORE:
  if (!Array.isArray((result as unknown as Record<string, unknown>).details)) {
    const errorMsg =
      'userMessage' in (result as unknown as Record<string, unknown>)
        ? (result as unknown as { userMessage: string }).userMessage
        : 'Import failed unexpectedly'
  // AFTER:
  if (isIpcError(result)) {
    const errorMsg = result.userMessage
  ```

- [ ] Verify: `npm run typecheck`
- [ ] Verify: `npm run lint:check` -- the ESLint warnings from Task 4 should now be resolved
- [ ] Commit: `refactor(renderer): replace all ad-hoc IPC error checks with isIpcError()`

---

## Task 18 (Wave 4): Write tests for cases-logic.ts -- THE TEST PATTERN TASK

**Files:** `tests/main/handlers/cases-logic.test.ts` (new)

Establish the test pattern for all logic modules: real in-memory SQLite, no Electron mocks.

### Steps

- [ ] Create `tests/main/handlers/cases-logic.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import * as casesLogic from '../../../src/main/ipc/handlers/cases-logic'
import type { LogFunctions, CaseCallbacks } from '../../../src/main/ipc/handlers/cases-logic'

describe('cases-logic', () => {
  let db: DatabaseService
  let logger: LogFunctions
  let callbacks: CaseCallbacks

  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, 5, Date.now())
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
    callbacks = {
      onCohortStale: vi.fn(),
      onCasesDeleted: vi.fn()
    }
    casesLogic.resetDeleteLock()
  })

  afterEach(() => {
    db.close()
  })

  describe('listCases', () => {
    it('returns all cases with no pool', async () => {
      insertCase('Alpha')
      insertCase('Beta')

      const result = await casesLogic.listCases(db, null)
      expect(result).toHaveLength(2)
    })

    it('returns empty array for empty database', async () => {
      const result = await casesLogic.listCases(db, null)
      expect(result).toHaveLength(0)
    })
  })

  describe('queryCases', () => {
    it('returns paginated results', async () => {
      insertCase('Case A')
      insertCase('Case B')
      insertCase('Case C')

      const result = await casesLogic.queryCases(db, null, {
        limit: 2,
        offset: 0
      })
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(3)
    })

    it('applies search filter', async () => {
      insertCase('Alpha')
      insertCase('Beta')
      insertCase('Alpha Two')

      const result = await casesLogic.queryCases(db, null, {
        search_term: 'Alpha',
        limit: 50,
        offset: 0
      })
      expect(result.data).toHaveLength(2)
    })
  })

  describe('deleteCase', () => {
    it('rejects concurrent deletes', async () => {
      const id = insertCase('Test')

      // Start a delete that we won't await (it will fail because no worker file exists,
      // but the lock is set synchronously)
      const firstDelete = casesLogic
        .deleteCase(db, id, logger, callbacks)
        .catch(() => {})

      // Second delete should fail with concurrent error
      await expect(
        casesLogic.deleteCase(db, id + 1, logger, callbacks)
      ).rejects.toThrow('already in progress')

      await firstDelete
    })
  })
})
```

- [ ] Run: `npm run rebuild:node` (if not already rebuilt for Node.js)
- [ ] Verify: `npm run test -- --run tests/main/handlers/cases-logic.test.ts`
- [ ] Commit: `test(main): add cases-logic.ts unit tests (pattern task)`

---

## Task 19 (Wave 4): Write tests for remaining 11 logic modules

For each module, create a test file in `tests/main/handlers/` following the pattern from Task 18. One commit per test file.

### 19a: variants-logic.test.ts

**Test cases:**
- `getFilterOptions` returns distinct values for a case
- `searchVariants` returns matching gene symbols
- `getGeneSymbols` returns autocomplete results
- `queryVariants` returns paginated variants with filters applied

```typescript
// Key test: queryVariants applies gene_symbol filter
it('filters variants by gene symbol', async () => {
  const caseId = insertCaseWithVariants('TestCase', [
    { gene_symbol: 'BRCA1', chr: 'chr17', pos: 43044295 },
    { gene_symbol: 'TP53', chr: 'chr17', pos: 7687490 }
  ])
  const result = await variantsLogic.queryVariants(
    db, null, caseId,
    { gene_symbol: 'BRCA1' },
    0, 50
  )
  expect(result.data).toHaveLength(1)
  expect(result.data[0].gene_symbol).toBe('BRCA1')
})
```

- [ ] Create `tests/main/handlers/variants-logic.test.ts` with 3-5 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/variants-logic.test.ts`
- [ ] Commit: `test(main): add variants-logic.ts unit tests`

### 19b: cohort-logic.test.ts

**Test cases:**
- `getCohortSummary` returns summary data when cases exist
- `getCarriers` returns carrier info for a specific variant
- `runGeneBurdenCompare` rejects overlapping groups

```typescript
// Key test: overlapping groups rejected
it('rejects overlapping group IDs', async () => {
  await expect(
    cohortLogic.runGeneBurdenCompare(db, null, {
      groupA_ids: [1, 2],
      groupB_ids: [2, 3],
      test_type: 'fisher'
    }, vi.fn())
  ).rejects.toThrow('Groups overlap')
})
```

- [ ] Create `tests/main/handlers/cohort-logic.test.ts` with 3-5 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/cohort-logic.test.ts`
- [ ] Commit: `test(main): add cohort-logic.ts unit tests`

### 19c: annotations-logic.test.ts

**Test cases:**
- `upsertGlobalAnnotation` creates annotation and generates audit entry
- `upsertGlobalAnnotation` updates existing annotation (audit shows old+new)
- `deleteGlobalAnnotation` removes annotation
- `upsertPerCaseAnnotation` with starred flag generates star/unstar audit entry
- `batchGetAnnotations` returns annotations for multiple variants

```typescript
// Key test: audit trail on ACMG classify
it('generates audit entry for ACMG classification', () => {
  insertVariant('chr1', 100, 'A', 'T')
  annotationsLogic.upsertGlobalAnnotation(db, 
    { chr: 'chr1', pos: 100, ref: 'A', alt: 'T' },
    { acmg_classification: 'pathogenic' },
    'testuser'
  )
  const entries = db.auditLog.getEntries({ entity_type: 'variant_annotation' })
  expect(entries).toHaveLength(1)
  expect(entries[0].action_type).toBe('acmg_classify')
})
```

- [ ] Create `tests/main/handlers/annotations-logic.test.ts` with 4-6 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/annotations-logic.test.ts`
- [ ] Commit: `test(main): add annotations-logic.ts unit tests`

### 19d: case-metadata-logic.test.ts

**Test cases:**
- CRUD: create/read/update/delete cohort group
- Assign and remove case from cohort
- HPO term assignment and removal
- External ID upsert and delete

- [ ] Create `tests/main/handlers/case-metadata-logic.test.ts` with 4-6 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/case-metadata-logic.test.ts`
- [ ] Commit: `test(main): add case-metadata-logic.ts unit tests`

### 19e: panels-logic.test.ts

**Test cases:**
- Panel CRUD: create, list, get, update, delete, duplicate
- Gene validation: `validateSymbols` returns correct statuses
- `importFromPanelApp` filters by confidence threshold (mock PanelAppClient)
- `buildBedContent` produces correct BED format with padding

- [ ] Create `tests/main/handlers/panels-logic.test.ts` with 4-6 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/panels-logic.test.ts`
- [ ] Commit: `test(main): add panels-logic.ts unit tests`

### 19f: database-logic.test.ts

**Test cases:**
- `openDatabase` detects encryption and returns `needsPassword`
- `openDatabase` with wrong password returns `WRONG_PASSWORD` error
- `validateAndDeleteDatabase` refuses non-DB extensions
- `validateAndDeleteDatabase` refuses active database

- [ ] Create `tests/main/handlers/database-logic.test.ts` with 3-4 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/database-logic.test.ts`
- [ ] Commit: `test(main): add database-logic.ts unit tests`

### 19g: auth-logic.test.ts

**Test cases:**
- `login` authenticates valid credentials
- `createUser` rejects non-admin callers
- `deactivateUser` prevents self-deactivation
- `changePassword` rejects wrong current password

```typescript
// Key test: admin check
it('rejects createUser from non-admin', async () => {
  // Set current user as non-admin
  db.setCurrentUser({ id: 1, username: 'viewer', role: 'viewer' })
  await expect(
    authLogic.createUser(db, 'newuser', 'New User', 'temp123')
  ).rejects.toThrow('Only admins')
})
```

- [ ] Create `tests/main/handlers/auth-logic.test.ts` with 3-4 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/auth-logic.test.ts`
- [ ] Commit: `test(main): add auth-logic.ts unit tests`

### 19h: tags-logic.test.ts

**Test cases:**
- Tag CRUD: create, list, update, delete
- `assignVariantTag` and `removeVariantTag`
- `setVariantTags` replaces all tags for a case-variant pair
- `getTagUsageCount` returns correct count

- [ ] Create `tests/main/handlers/tags-logic.test.ts` with 3-4 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/tags-logic.test.ts`
- [ ] Commit: `test(main): add tags-logic.ts unit tests`

### 19i: export-logic.test.ts

**Test cases:**
- `prepareVariantExport` rejects when count exceeds EXPORT_HARD_LIMIT
- `prepareVariantExport` returns compiled query and filter summary
- `buildCohortExportWorkbook` produces a valid XLSX buffer

- [ ] Create `tests/main/handlers/export-logic.test.ts` with 2-3 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/export-logic.test.ts`
- [ ] Commit: `test(main): add export-logic.ts unit tests`

### 19j: import-logic.test.ts

**Test cases:**
- `cancelImport` is safe to call when no import is running
- `getVcfPreview` returns sample/header info for a VCF file (use test-data)

- [ ] Create `tests/main/handlers/import-logic.test.ts` with 2-3 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/import-logic.test.ts`
- [ ] Commit: `test(main): add import-logic.ts unit tests`

### 19k: batch-import-logic.test.ts

**Test cases:**
- `checkDuplicatesForBatch` identifies existing case names
- `cancelBatchImport` is safe to call when no import is running

- [ ] Create `tests/main/handlers/batch-import-logic.test.ts` with 2-3 tests
- [ ] Verify: `npm run test -- --run tests/main/handlers/batch-import-logic.test.ts`
- [ ] Commit: `test(main): add batch-import-logic.ts unit tests`

---

## Task 20 (Wave 4): Add coverage thresholds and run final verification

**Files:** `vitest.config.ts`

### Steps

- [ ] Read `vitest.config.ts`
- [ ] Add per-glob coverage threshold for `*-logic.ts` files inside the `thresholds` block. The Vitest `thresholds` object supports glob keys:
  ```typescript
  thresholds: {
    autoUpdate: true,
    lines: 32,
    functions: 20,
    branches: 26,
    statements: 31,
    // Per-glob thresholds for extracted handler logic
    'src/main/ipc/handlers/*-logic.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70
    }
  }
  ```
- [ ] Run full verification:
  ```bash
  npm run lint:check && npm run typecheck && npm run test -- --run --coverage
  ```
- [ ] Verify coverage report shows handler logic files above thresholds
- [ ] Verify no ESLint warnings for ad-hoc error checks remain
- [ ] Commit: `chore(test): add per-glob coverage thresholds for handler logic modules`

---

## Verification Checklist

After all tasks are complete, the following must be true:

- [ ] `npm run lint:check` passes with zero errors (warnings OK for existing code)
- [ ] `npm run typecheck` passes
- [ ] `npm run test -- --run` passes (all existing + new tests)
- [ ] Zero duplicate `safeEmit` definitions (only `src/main/ipc/utils/safeEmit.ts`)
- [ ] Zero ad-hoc `'error' in result`, `'code' in result`, `'userMessage' in result` checks in renderer
- [ ] All 12 Tier 1 handlers have companion `-logic.ts` files
- [ ] All 12 `-logic.ts` files have test files
- [ ] Handler coverage is above 30% (run `npm run test -- --run --coverage` and check)
- [ ] GeneBurdenView bug is fixed (isIpcError used)
