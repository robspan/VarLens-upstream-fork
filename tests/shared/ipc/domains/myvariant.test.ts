import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('myvariant preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all myvariant domain channels without unwrapping in createMyvariantApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        scores: {
          revel_score: 0.5,
          cadd_phred: 25.3,
          sift_score: null,
          sift_pred: null,
          polyphen_score: null,
          polyphen_pred: null,
          alphamissense_score: null,
          alphamissense_pred: null
        },
        cacheInfo: {
          cached: false,
          cachedAt: null
        }
      })
      .mockResolvedValueOnce({
        success: true
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createMyvariantApi } = await import(
      '../../../../src/preload/domains/myvariant'
    )
    const api = createMyvariantApi()

    await expect(api.fetch('chr1', 1000, 'A', 'T')).resolves.toMatchObject({
      success: true,
      scores: {
        revel_score: 0.5,
        cadd_phred: 25.3
      }
    })

    await expect(api.clearCache()).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'myvariant:fetch', 'chr1', 1000, 'A', 'T')
    expect(invoke).toHaveBeenNthCalledWith(2, 'myvariant:clearCache')
  })

  it('preload index preserves myvariant transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'myvariant:fetch') {
        return {
          success: true,
          scores: {
            revel_score: 0.5,
            cadd_phred: 25.3,
            sift_score: null,
            sift_pred: null,
            polyphen_score: null,
            polyphen_pred: null,
            alphamissense_score: null,
            alphamissense_pred: null
          },
          cacheInfo: {
            cached: false,
            cachedAt: null
          }
        }
      }
      if (channel === 'myvariant:clearCache') {
        return {
          success: true
        }
      }
    })
    const exposeInMainWorld = vi.fn()

    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn()
      }
    }))
    ;(process as typeof process & { contextIsolated?: boolean }).contextIsolated = true

    await import('../../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      myvariant: {
        fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<unknown>
        clearCache: () => Promise<unknown>
      }
    }

    await expect(api.myvariant.fetch('chr1', 1000, 'A', 'T')).resolves.toMatchObject({
      success: true,
      scores: {
        revel_score: 0.5,
        cadd_phred: 25.3
      }
    })
    await expect(api.myvariant.clearCache()).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenCalledWith('myvariant:fetch', 'chr1', 1000, 'A', 'T')
    expect(invoke).toHaveBeenCalledWith('myvariant:clearCache')
  })
})
