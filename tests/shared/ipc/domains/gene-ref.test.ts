import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('gene-ref preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all gene-ref domain channels without unwrapping in createGeneRefApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        version: '2024.01',
        geneCount: 19000,
        builtAt: 1704067200
      })
      .mockResolvedValueOnce([
        {
          name: 'GRCh38',
          ucscId: 'hg38'
        },
        {
          name: 'GRCh37',
          ucscId: 'hg19'
        }
      ])
      .mockResolvedValueOnce({
        currentBuiltAt: 1704067200,
        daysSinceBuilt: 45,
        needsUpdate: false
      })
      .mockResolvedValueOnce({
        success: true,
        message: 'Updated successfully. 19000 genes loaded.'
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createGeneRefApi } = await import('../../../../src/preload/domains/gene-ref')
    const api = createGeneRefApi()

    await expect(api.info()).resolves.toMatchObject({
      version: '2024.01',
      geneCount: 19000
    })

    await expect(api.assemblies()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'GRCh38'
        })
      ])
    )

    await expect(api.checkUpdates()).resolves.toMatchObject({
      currentBuiltAt: 1704067200,
      needsUpdate: false
    })

    await expect(api.update()).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'gene-ref:info')
    expect(invoke).toHaveBeenNthCalledWith(2, 'gene-ref:assemblies')
    expect(invoke).toHaveBeenNthCalledWith(3, 'gene-ref:check-updates')
    expect(invoke).toHaveBeenNthCalledWith(4, 'gene-ref:update')
  })

  it('preload index preserves gene-ref transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'gene-ref:info') {
        return {
          version: '2024.01',
          geneCount: 19000,
          builtAt: 1704067200
        }
      }
      if (channel === 'gene-ref:check-updates') {
        return {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'gene-ref:check-updates failed',
          userMessage: 'Could not check for updates'
        }
      }
      if (channel === 'gene-ref:assemblies') {
        return [
          {
            name: 'GRCh38',
            ucscId: 'hg38'
          }
        ]
      }
      return {
        success: false,
        message: 'Update not available'
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
      geneRef: {
        info: () => Promise<unknown>
        checkUpdates: () => Promise<unknown>
        assemblies: () => Promise<unknown>
        update: () => Promise<unknown>
      }
    }

    await expect(api.geneRef.info()).resolves.toMatchObject({
      version: '2024.01',
      geneCount: 19000
    })

    await expect(api.geneRef.checkUpdates()).resolves.toMatchObject({
      code: ErrorCode.UNKNOWN_ERROR,
      message: 'gene-ref:check-updates failed'
    })

    await expect(api.geneRef.assemblies()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'GRCh38'
        })
      ])
    )

    await expect(api.geneRef.update()).resolves.toMatchObject({
      success: false
    })

    expect(invoke).toHaveBeenCalledWith('gene-ref:info')
    expect(invoke).toHaveBeenCalledWith('gene-ref:check-updates')
    expect(invoke).toHaveBeenCalledWith('gene-ref:assemblies')
    expect(invoke).toHaveBeenCalledWith('gene-ref:update')
  })
})
