import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BatchResult } from '../../../src/shared/types/api'
import { useShellLifecycle } from '../../../src/renderer/src/composables/useShellLifecycle'

describe('useShellLifecycle', () => {
  it('bumps data generation and refreshes cases on batch import completion', async () => {
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn().mockResolvedValue(undefined)

    const lifecycle = useShellLifecycle({
      api: undefined,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({
        refreshCases,
        selectCase: vi.fn()
      }),
      dialogHostRef: ref(null),
      importStore: {
        importComplete: vi.fn()
      } as never
    })

    await lifecycle.handleBatchImportComplete()

    expect(incrementDataGeneration).toHaveBeenCalledTimes(1)
    expect(refreshCases).toHaveBeenCalledTimes(1)
  })

  it('wires batch import completion through the lifecycle listener', () => {
    const onComplete = vi.fn()
    const incrementDataGeneration = vi.fn()
    const refreshCases = vi.fn().mockResolvedValue(undefined)
    const importComplete = vi.fn()

    const lifecycle = useShellLifecycle({
      api: {
        batchImport: {
          onComplete
        }
      } as never,
      currentDatabasePath: ref(null),
      currentDatabaseName: ref('VarLens'),
      incrementDataGeneration,
      resetForDatabaseSwitch: vi.fn(),
      clearMetadataCache: vi.fn(),
      selectCase: vi.fn(),
      caseListRef: ref({
        refreshCases,
        selectCase: vi.fn()
      }),
      dialogHostRef: ref(null),
      importStore: {
        importComplete
      } as never
    })

    const cleanup = vi.fn()
    onComplete.mockImplementation((callback: (result: BatchResult) => void) => {
      callback({
        totalImported: 1,
        details: [{ fileName: 'case-a', status: 'success' }]
      })
      return cleanup
    })

    const registeredCleanup = lifecycle.setupBatchImportCompletionListener()

    expect(importComplete).toHaveBeenCalledWith({
      totalImported: 1,
      details: [{ fileName: 'case-a', caseName: 'case-a', status: 'success' }]
    })
    expect(incrementDataGeneration).toHaveBeenCalledTimes(1)
    expect(refreshCases).toHaveBeenCalledTimes(1)
    expect(registeredCleanup).toBe(cleanup)
  })
})
