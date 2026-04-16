import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('gnomad preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all gnomad domain channels without unwrapping in createGnomadApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        variants: [
          {
            id: 'gnomAD_r4_AC',
            geneSymbol: 'BRCA1',
            frequency: 0.001,
            consequence: 'missense_variant'
          }
        ],
        geneId: 'ENSG00000012048',
        dataset: 'gnomad_r4',
        cacheInfo: { cached: false }
      })
      .mockResolvedValueOnce({
        success: true,
        variants: [
          {
            id: 'ClinVar123',
            geneSymbol: 'BRCA1',
            consequence: 'stop_gained',
            clinvarId: 'RCV000000123'
          }
        ],
        cacheInfo: { cached: true, cachedAt: 1704067200 }
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createGnomadApi } = await import('../../../../src/preload/domains/gnomad')
    const api = createGnomadApi()

    await expect(api.getVariants('BRCA1')).resolves.toMatchObject({
      success: true,
      variants: expect.arrayContaining([
        expect.objectContaining({
          geneSymbol: 'BRCA1'
        })
      ])
    })

    await expect(api.getClinVarVariants('BRCA1')).resolves.toMatchObject({
      success: true,
      variants: expect.arrayContaining([
        expect.objectContaining({
          geneSymbol: 'BRCA1'
        })
      ])
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'gnomad:variants', 'BRCA1', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'gnomad:clinvar', 'BRCA1', undefined)
  })

  it('forwards gnomad domain channels with dataset parameter', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        variants: [],
        geneId: 'ENSG00000012048',
        dataset: 'gnomad_r3',
        cacheInfo: { cached: false }
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createGnomadApi } = await import('../../../../src/preload/domains/gnomad')
    const api = createGnomadApi()

    await expect(api.getVariants('BRCA1', 'gnomad_r3')).resolves.toMatchObject({
      success: true,
      dataset: 'gnomad_r3'
    })

    expect(invoke).toHaveBeenCalledWith('gnomad:variants', 'BRCA1', 'gnomad_r3')
  })

  it('preload index preserves gnomad transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'gnomad:variants') {
        return {
          success: true,
          variants: [
            {
              id: 'gnomAD_r4_AC',
              geneSymbol: 'BRCA1',
              frequency: 0.001
            }
          ],
          geneId: 'ENSG00000012048',
          dataset: 'gnomad_r4',
          cacheInfo: { cached: false }
        }
      }
      if (channel === 'gnomad:clinvar') {
        return {
          success: false,
          error: 'No network connection and no cached ClinVar data available',
          offline: true
        }
      }
      return undefined
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
      gnomad: {
        getVariants: (geneSymbol: string, dataset?: string) => Promise<unknown>
        getClinVarVariants: (geneSymbol: string, dataset?: string) => Promise<unknown>
      }
    }

    await expect(api.gnomad.getVariants('BRCA1')).resolves.toMatchObject({
      success: true,
      geneId: 'ENSG00000012048'
    })

    await expect(api.gnomad.getClinVarVariants('BRCA1')).resolves.toMatchObject({
      success: false,
      offline: true
    })

    expect(invoke).toHaveBeenCalledWith('gnomad:variants', 'BRCA1', undefined)
    expect(invoke).toHaveBeenCalledWith('gnomad:clinvar', 'BRCA1', undefined)
  })
})
