import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('vep preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all vep domain channels without unwrapping in createVepApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          colocated_variants: [],
          frequencies: {},
          sift: null,
          polyphen: null,
          clinvar: []
        }
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ cached: 0, totalSize: 0 })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createVepApi } = await import('../../../../src/preload/domains/vep')
    const api = createVepApi()

    await expect(api.fetch('chr22', 1000, 'A', 'T')).resolves.toMatchObject({
      success: true,
      data: {
        colocated_variants: []
      }
    })

    await expect(api.cancel()).resolves.toBeUndefined()

    await expect(api.clearCache()).resolves.toMatchObject({
      success: true
    })

    await expect(api.getCacheStats()).resolves.toMatchObject({
      cached: 0,
      totalSize: 0
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'vep:fetch', 'chr22', 1000, 'A', 'T')
    expect(invoke).toHaveBeenNthCalledWith(2, 'vep:cancel')
    expect(invoke).toHaveBeenNthCalledWith(3, 'vep:clearCache')
    expect(invoke).toHaveBeenNthCalledWith(4, 'vep:getCacheStats')
  })

  it('preload index preserves vep transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'vep:cancel') {
        return undefined
      }
      if (channel === 'vep:clearCache') {
        return { success: true }
      }
      if (channel === 'vep:getCacheStats') {
        return { cached: 0, totalSize: 0 }
      }
      // vep:fetch
      return {
        success: true,
        data: {
          colocated_variants: [],
          frequencies: {},
          sift: null,
          polyphen: null,
          clinvar: []
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
      vep: {
        fetch: (
          chr: string,
          pos: number,
          ref: string,
          alt: string
        ) => Promise<unknown>
        cancel: () => Promise<unknown>
        clearCache: () => Promise<unknown>
        getCacheStats: () => Promise<unknown>
      }
    }

    await expect(api.vep.fetch('chr22', 1000, 'A', 'T')).resolves.toMatchObject({
      success: true,
      data: {
        colocated_variants: []
      }
    })
    await expect(api.vep.cancel()).resolves.toBeUndefined()
    await expect(api.vep.clearCache()).resolves.toMatchObject({
      success: true
    })
    await expect(api.vep.getCacheStats()).resolves.toMatchObject({
      cached: 0,
      totalSize: 0
    })

    expect(invoke).toHaveBeenCalledWith('vep:fetch', 'chr22', 1000, 'A', 'T')
    expect(invoke).toHaveBeenCalledWith('vep:cancel')
    expect(invoke).toHaveBeenCalledWith('vep:clearCache')
    expect(invoke).toHaveBeenCalledWith('vep:getCacheStats')
  })
})
