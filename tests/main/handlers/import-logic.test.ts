/**
 * Import logic routing tests.
 *
 * Phase 8 routes `startImport` through the active storage session's
 * `StorageImportExecutor`. These tests pin the routing and cancellation
 * behavior without invoking the real worker pipeline.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  startImport,
  cancelImport,
  startMultiFileImport
} from '../../../src/main/ipc/handlers/import-logic'

describe('import-logic exports', () => {
  it('exports expected functions', async () => {
    const logic = await import('../../../src/main/ipc/handlers/import-logic')
    expect(typeof logic.startImport).toBe('function')
    expect(typeof logic.cancelImport).toBe('function')
    expect(typeof logic.startMultiFileImport).toBe('function')
    expect(typeof logic.getVcfPreview).toBe('function')
  })
})

describe('startImport', () => {
  it('uses the active storage session import executor', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    }))
    const executor = { importSingleFile, cancel: vi.fn() }
    const session = { getImportExecutor: () => executor }
    const getSession = (): never => session as never

    await expect(
      startImport('/tmp/input.json', 'Imported', undefined, getSession, {})
    ).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    })

    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/input.json',
        caseName: 'Imported'
      })
    )
  })

  it('forwards onProgress callback to the executor', async () => {
    const onProgress = vi.fn()
    const importSingleFile = vi.fn(async (params: { onProgress?: (data: unknown) => void }) => {
      params.onProgress?.({ phase: 'parsing', count: 0, elapsed: 0, skipped: 0 })
      return { caseId: 1, variantCount: 0, skipped: 0, errors: [], elapsed: 0 }
    })
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, { onProgress })
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'parsing' }))
  })

  it('forwards throttleMs using API_CONFIG.PROGRESS_THROTTLE_MS', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 2,
      variantCount: 1,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: expect.any(Number)
      })
    )
  })

  it('forwards vcfOptions to the executor', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 1,
      variantCount: 0,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport(
      '/tmp/x.vcf',
      'n',
      { selectedSample: 'HG002', genomeBuild: 'GRCh38' },
      () => session as never,
      {}
    )
    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        vcfOptions: { selectedSample: 'HG002', genomeBuild: 'GRCh38' }
      })
    )
  })

  it('cancelImport cancels the active storage import executor', async () => {
    const cancel = vi.fn()
    let resolveStart!: (v: unknown) => void
    const importSingleFile = vi.fn(
      () =>
        new Promise((r) => {
          resolveStart = r
        })
    )
    const session = { getImportExecutor: () => ({ importSingleFile, cancel }) }
    const promise = startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    cancelImport()
    expect(cancel).toHaveBeenCalled()
    resolveStart({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 0
    })
    await promise
  })

  it('clears the active executor reference after completion', async () => {
    const cancel = vi.fn()
    const importSingleFile = vi.fn(async () => ({
      caseId: 1,
      variantCount: 1,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    // After a completed import, cancelImport should not invoke the stale executor.
    cancelImport()
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('startMultiFileImport PostgreSQL guard', () => {
  it('rejects multi-file import on non-sqlite backend', async () => {
    const session = {
      capabilities: { backend: 'postgres' as const },
      getImportExecutor: () => ({ importSingleFile: vi.fn(), cancel: vi.fn() })
    }

    await expect(
      startMultiFileImport(
        'c',
        [
          {
            filePath: '/tmp/a.vcf',
            variantType: 'snv',
            caller: null,
            annotationFormat: null
          }
        ],
        undefined,
        () => session as never,
        (() => ({})) as never,
        {}
      )
    ).rejects.toThrow(/PostgreSQL multi-file import is not supported in Phase 8/)
  })
})
