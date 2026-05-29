import { describe, expect, it, vi } from 'vitest'

import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import { jobRunner } from '../../../src/main/services/jobs/runner'
import type { PostgresImportWorkerCallbacks } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type {
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../../src/shared/types/postgres-import-worker'

// ---------------------------------------------------------------------------
// Gate 12 four-dimension coverage for D3 wire site (i):
//   PostgresImportExecutor.importSingleFile is routed through the shared
//   module-singleton JobRunner (`import_single` kind). These tests assert the
//   four invariants the wiring must preserve:
//     (a) return payload unchanged
//     (b) single-flight conflict message preserved
//     (c) cancellation routed through worker.postMessage({type:'cancel'})
//     (d) import:progress phase/count/skipped mapping is unchanged
//
// Note on (d): PR4-3 does not touch runWorker's progress-mapping path, so the
// phase/count/skipped fields are demonstrably identical to pre-PR-4. The
// expectation below is therefore an equivalent inline assertion of that
// mapping rather than a byte-for-byte diff against a captured main-branch
// fixture. The wall-clock `elapsed` field is non-deterministic and excluded.
// ---------------------------------------------------------------------------

const TEST_CLIENT_CONFIG: PostgresClientConfig = {
  connectionString: 'postgres://test:secret@localhost:5432/testdb',
  application_name: 'varlens-test',
  ssl: { mode: 'disable' }
}

function makeExecutor(fakeClient: { start: unknown; cancel: unknown }) {
  return new PostgresImportExecutor({
    schema: 'public',
    clientConfig: TEST_CLIENT_CONFIG,
    workerClientFactory: () => fakeClient as never
  })
}

describe('PostgresImportExecutor.importSingleFile — Sprint A D3 (i) / Gate 12', () => {
  it('(a) return payload: returns StorageImportSingleFileResult unchanged', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'single-file',
              result: { caseId: 42, variantCount: 300, skipped: 2, errors: ['warn1'], elapsed: 88 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const result = await executor.importSingleFile({
      filePath: '/tmp/a.json',
      caseName: 'CaseA',
      throttleMs: 0
    })

    // Exact shape + values are preserved through the JobRunner wiring.
    expect(result).toEqual({
      caseId: 42,
      variantCount: 300,
      skipped: 2,
      errors: ['warn1'],
      elapsed: 88
    })
  })

  it('(b) conflict: second concurrent call rejects with "An import is already in progress"', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — keep the import_single slot occupied.
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const first = executor.importSingleFile({
      filePath: '/tmp/one.json',
      caseName: 'C1',
      throttleMs: 0
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/two.json', caseName: 'C2', throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    // Unblock the first import so the import_single slot frees for later tests.
    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 1, variantCount: 1, skipped: 0, errors: [], elapsed: 1 }
    })
    const result = await first
    expect(result.errors).toEqual([])
  })

  it('(c) cancellation: jobRunner.cancel triggers worker.postMessage({type:"cancel"}) via client.cancel', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — let the test drive cancellation.
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const importPromise = executor.importSingleFile({
      filePath: '/tmp/z.json',
      caseName: 'CZ',
      throttleMs: 0
    })

    // Let enqueue + start run.
    await new Promise((r) => queueMicrotask(r as () => void))

    // Locate the in-flight import_single job and cancel it through the runner.
    const running = jobRunner.list({ kind: 'import_single', status: 'running' })
    expect(running.length).toBe(1)
    await jobRunner.cancel(running[0].id)

    // The registered cancel callback routes to client.cancel(), which posts
    // { type: 'cancel' } to the worker (NOT terminate()).
    expect(fakeClient.cancel).toHaveBeenCalledTimes(1)

    // Resolve so the promise settles and the slot frees.
    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: {
        caseId: 0,
        variantCount: 0,
        skipped: 0,
        errors: ['Import cancelled by user'],
        elapsed: 0
      }
    })
    await importPromise
  })

  it('(d) progress mapping: phase/count/skipped emissions are unchanged from pre-PR-4', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onProgress({ type: 'progress', phase: 'parsing', rowsProcessed: 0 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 50 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 100 })
            callbacks.onComplete({
              type: 'complete',
              mode: 'single-file',
              result: { caseId: 1, variantCount: 100, skipped: 0, errors: [], elapsed: 10 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const recorded: Array<{ phase: string; count: number; skipped: number }> = []
    await executor.importSingleFile({
      filePath: '/tmp/p.json',
      caseName: 'CP',
      throttleMs: 0,
      onProgress: (data) => {
        recorded.push({ phase: data.phase, count: data.count, skipped: data.skipped })
      }
    })

    // runWorker maps phase + count + skipped identically to pre-PR-4 (the
    // mapping path is untouched by PR4-3); elapsed is wall-clock and excluded.
    expect(recorded).toEqual([
      { phase: 'parsing', count: 0, skipped: 0 },
      { phase: 'inserting', count: 50, skipped: 0 },
      { phase: 'inserting', count: 100, skipped: 0 }
    ])
  })
})

// ---------------------------------------------------------------------------
// Gate 12 four-dimension coverage for D3 wire site (ii):
//   PostgresImportExecutor.importMultiFile is routed through the SAME
//   module-singleton JobRunner kind ('import_single') as importSingleFile
//   (Pass-9 #9 — the pre-PR-4 `inProgress` flag gated BOTH paths). These tests
//   assert the four invariants the wiring must preserve:
//     (a) return payload (StorageImportMultiFileResult) unchanged
//     (b) single-flight conflict message preserved — including the cross-path
//         case where a single-file import blocks a multi-file import (and vice
//         versa) because both share the 'import_single' kind
//     (c) cancellation routed through worker client.cancel() (posts
//         {type:'cancel'}, NOT terminate())
//     (d) import:progress phase/count/skipped + onFileComplete mapping unchanged
// ---------------------------------------------------------------------------

const MULTI_FILES = [
  { filePath: '/tmp/a.vcf', variantType: 'small', caller: null, annotationFormat: null }
]

describe('PostgresImportExecutor.importMultiFile — Sprint A D3 (ii) / Gate 12', () => {
  it('(a) return payload: returns StorageImportMultiFileResult unchanged', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: {
                caseId: 7,
                variantCount: 500,
                files: [{ filePath: '/tmp/a.vcf', variantType: 'small', variantCount: 500 }],
                skipped: 3,
                errors: ['warnM'],
                elapsed: 99
              }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const result = await executor.importMultiFile({
      caseName: 'MultiA',
      files: MULTI_FILES,
      throttleMs: 0
    })

    expect(result).toEqual({
      caseId: 7,
      variantCount: 500,
      files: [{ filePath: '/tmp/a.vcf', variantType: 'small', variantCount: 500 }],
      skipped: 3,
      errors: ['warnM'],
      elapsed: 99
    })
  })

  it('(a) return payload: missing worker files coerce to empty array', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: { caseId: 8, variantCount: 0, skipped: 0, errors: [], elapsed: 1 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const result = await executor.importMultiFile({
      caseName: 'MultiEmpty',
      files: MULTI_FILES,
      throttleMs: 0
    })

    expect(result.files).toEqual([])
  })

  it('(b) conflict: second concurrent multi-file call rejects with "An import is already in progress"', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — keep the import_single slot occupied.
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const first = executor.importMultiFile({
      caseName: 'M1',
      files: MULTI_FILES,
      throttleMs: 0
    })

    await expect(
      executor.importMultiFile({ caseName: 'M2', files: MULTI_FILES, throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'multi-file',
      result: { caseId: 1, variantCount: 1, files: [], skipped: 0, errors: [], elapsed: 1 }
    })
    const result = await first
    expect(result.errors).toEqual([])
  })

  it('(b) conflict cross-path: an in-flight single-file import blocks importMultiFile (shared import_single kind)', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const single = executor.importSingleFile({
      filePath: '/tmp/single.json',
      caseName: 'S1',
      throttleMs: 0
    })

    await expect(
      executor.importMultiFile({ caseName: 'MX', files: MULTI_FILES, throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 1, variantCount: 1, skipped: 0, errors: [], elapsed: 1 }
    })
    await single
  })

  it('(b) conflict cross-path: an in-flight multi-file import blocks importSingleFile (shared import_single kind)', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const multi = executor.importMultiFile({
      caseName: 'MB',
      files: MULTI_FILES,
      throttleMs: 0
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/blocked.json', caseName: 'SB', throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'multi-file',
      result: { caseId: 1, variantCount: 1, files: [], skipped: 0, errors: [], elapsed: 1 }
    })
    await multi
  })

  it('(c) cancellation: jobRunner.cancel triggers worker client.cancel() (posts {type:"cancel"})', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const importPromise = executor.importMultiFile({
      caseName: 'MZ',
      files: MULTI_FILES,
      throttleMs: 0
    })

    await new Promise((r) => queueMicrotask(r as () => void))

    const running = jobRunner.list({ kind: 'import_single', status: 'running' })
    expect(running.length).toBe(1)
    await jobRunner.cancel(running[0].id)

    expect(fakeClient.cancel).toHaveBeenCalledTimes(1)

    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'multi-file',
      result: {
        caseId: 0,
        variantCount: 0,
        files: [],
        skipped: 0,
        errors: ['Import cancelled by user'],
        elapsed: 0
      }
    })
    await importPromise
  })

  it('(d) progress mapping: phase/count/skipped emissions are unchanged from pre-PR-4', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onProgress({ type: 'progress', phase: 'parsing', rowsProcessed: 0 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 250 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 500 })
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: {
                caseId: 1,
                variantCount: 500,
                files: [],
                skipped: 0,
                errors: [],
                elapsed: 10
              }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const recorded: Array<{ phase: string; count: number; skipped: number }> = []
    await executor.importMultiFile({
      caseName: 'MP',
      files: MULTI_FILES,
      throttleMs: 0,
      onProgress: (data) => {
        recorded.push({ phase: data.phase, count: data.count, skipped: data.skipped })
      }
    })

    expect(recorded).toEqual([
      { phase: 'parsing', count: 0, skipped: 0 },
      { phase: 'inserting', count: 250, skipped: 0 },
      { phase: 'inserting', count: 500, skipped: 0 }
    ])
  })

  it('(d) onFileComplete mapping: per-file completion events forwarded unchanged', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onFileComplete({
              type: 'file-complete',
              filePath: '/tmp/a.vcf',
              caseId: 11,
              variantCount: 120
            })
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: {
                caseId: 11,
                variantCount: 120,
                files: [{ filePath: '/tmp/a.vcf', variantType: 'small', variantCount: 120 }],
                skipped: 0,
                errors: [],
                elapsed: 5
              }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const files: Array<{ filePath: string; caseId: number; variantCount: number }> = []
    await executor.importMultiFile({
      caseName: 'MFC',
      files: MULTI_FILES,
      throttleMs: 0,
      onFileComplete: (event) => {
        files.push({
          filePath: event.filePath,
          caseId: event.caseId,
          variantCount: event.variantCount
        })
      }
    })

    expect(files).toEqual([{ filePath: '/tmp/a.vcf', caseId: 11, variantCount: 120 }])
  })

  it('(d) error propagation: worker onError rejects with the worker message', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onError({ type: 'error', message: 'multi import boom' })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    await expect(
      executor.importMultiFile({ caseName: 'ME', files: MULTI_FILES, throttleMs: 0 })
    ).rejects.toThrow('multi import boom')
  })

  it('(d) start message: forwards multi-file mode, files and filters to the worker', async () => {
    let captured!: PostgresImportWorkerStartMessage
    const fakeClient = {
      start: vi.fn(
        (msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          captured = msg
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: { caseId: 1, variantCount: 0, files: [], skipped: 0, errors: [], elapsed: 1 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    await executor.importMultiFile({
      caseName: 'MStart',
      files: MULTI_FILES,
      throttleMs: 0,
      filters: {
        bedFilePath: '/tmp/regions.bed',
        bedPadding: 10,
        passOnly: true,
        minQual: 20,
        minGq: 30,
        minDp: 8
      }
    })

    expect(captured.mode).toBe('multi-file')
    expect(captured.caseName).toBe('MStart')
    expect(captured.files).toEqual(MULTI_FILES)
    expect(captured.filters).toEqual({
      bedFilePath: '/tmp/regions.bed',
      bedPadding: 10,
      passOnly: true,
      minQual: 20,
      minGq: 30,
      minDp: 8
    })
  })

  it('(d) start message: omits filters when none provided', async () => {
    let captured!: PostgresImportWorkerStartMessage
    const fakeClient = {
      start: vi.fn(
        (msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          captured = msg
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: { caseId: 1, variantCount: 0, files: [], skipped: 0, errors: [], elapsed: 1 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    await executor.importMultiFile({
      caseName: 'MNoFilter',
      files: MULTI_FILES,
      throttleMs: 0
    })

    expect(captured.filters).toBeUndefined()
  })

  it('(a) return payload: top-level worker errors surface in StorageImportMultiFileResult.errors', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'multi-file',
              result: {
                caseId: 0,
                variantCount: 0,
                files: [
                  {
                    filePath: '/tmp/a.vcf',
                    variantType: 'small',
                    variantCount: 0,
                    error: 'bad row'
                  }
                ],
                skipped: 0,
                errors: ['session failed'],
                elapsed: 2
              }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const result = await executor.importMultiFile({
      caseName: 'MErr',
      files: MULTI_FILES,
      throttleMs: 0
    })

    expect(result.errors).toEqual(['session failed'])
    expect(result.files[0].error).toBe('bad row')
  })
})
