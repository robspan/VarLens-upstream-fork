import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult
} from '../../../src/main/storage/import-executor'

describe('StorageImportExecutor contract', () => {
  it('defines single-file import params and result shape', async () => {
    const params = {
      filePath: '/tmp/import.json',
      caseName: 'PG JSON import',
      vcfOptions: { genomeBuild: 'GRCh38' },
      throttleMs: 100,
      onProgress: vi.fn()
    } satisfies StorageImportSingleFileParams

    const executor: StorageImportExecutor = {
      importSingleFile: vi.fn(async () => ({
        caseId: 4,
        variantCount: 3,
        skipped: 0,
        errors: [],
        elapsed: 12
      })),
      cancel: vi.fn()
    }

    await expect(executor.importSingleFile(params)).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 12
    })
    expectTypeOf<StorageImportSingleFileResult>().toMatchTypeOf<{
      caseId: number
      variantCount: number
      skipped: number
      errors: string[]
      elapsed: number
    }>()
  })
})
