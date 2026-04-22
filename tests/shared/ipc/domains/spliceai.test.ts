import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('spliceai preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all spliceai domain channels without unwrapping in createSpliceaiApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        scores: {
          max_delta: 0.5,
          ds_ag: 0.1,
          ds_al: 0.2,
          ds_dg: 0.5,
          ds_dl: 0.3,
          gene: 'BRCA1',
          transcript: 'ENST00000007392'
        },
        cacheInfo: {
          cached: false,
          cachedAt: null
        }
      })
      .mockResolvedValueOnce({ success: true })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createSpliceaiApi } = await import('../../../../src/preload/domains/spliceai')
    const api = createSpliceaiApi()

    await expect(api.fetch('chr17', 41197313, 'T', 'G')).resolves.toMatchObject({
      success: true,
      scores: {
        max_delta: 0.5,
        gene: 'BRCA1'
      }
    })

    await expect(api.clearCache()).resolves.toMatchObject({ success: true })

    expect(invoke).toHaveBeenNthCalledWith(1, 'spliceai:fetch', 'chr17', 41197313, 'T', 'G')
    expect(invoke).toHaveBeenNthCalledWith(2, 'spliceai:clearCache')
  })

  it('preload index preserves spliceai transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'spliceai:fetch') {
        return {
          success: true,
          scores: {
            max_delta: 0.5,
            ds_ag: 0.1,
            ds_al: 0.2,
            ds_dg: 0.5,
            ds_dl: 0.3,
            gene: 'BRCA1',
            transcript: 'ENST00000007392'
          },
          cacheInfo: {
            cached: false,
            cachedAt: null
          }
        }
      }
      if (channel === 'spliceai:clearCache') {
        return { success: true }
      }
      throw new Error(`Unknown channel: ${channel}`)
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
      spliceai: {
        fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<unknown>
        clearCache: () => Promise<unknown>
      }
    }

    await expect(api.spliceai.fetch('chr17', 41197313, 'T', 'G')).resolves.toMatchObject({
      success: true,
      scores: {
        max_delta: 0.5,
        gene: 'BRCA1'
      }
    })
    await expect(api.spliceai.clearCache()).resolves.toMatchObject({ success: true })

    expect(invoke).toHaveBeenCalledWith('spliceai:fetch', 'chr17', 41197313, 'T', 'G')
    expect(invoke).toHaveBeenCalledWith('spliceai:clearCache')
  })
})
