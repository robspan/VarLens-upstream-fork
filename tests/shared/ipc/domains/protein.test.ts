import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('protein preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all protein domain channels without unwrapping in createProteinApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        uniprotAccession: 'P12345',
        geneName: 'TP53',
        proteinName: 'Cellular tumor antigen p53'
      })
      .mockResolvedValueOnce({
        domains: [
          {
            accession: 'IPR036236',
            name: 'p53-like TF domain',
            startPosition: 102,
            endPosition: 292
          }
        ]
      })
      .mockResolvedValueOnce({
        alphafoldId: 'AF-P12345-F1',
        pLddt: 85.5,
        modelUrl: 'https://alphafold.ebi.ac.uk/AF-P12345-F1-model_v4.pdb'
      })
      .mockResolvedValueOnce({
        exons: [
          {
            startPosition: 7571720,
            endPosition: 7571896,
            strand: '-'
          }
        ],
        totalLength: 20000
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createProteinApi } = await import('../../../../src/preload/domains/protein')
    const api = createProteinApi()

    await expect(api.getMapping('TP53')).resolves.toMatchObject({
      uniprotAccession: 'P12345',
      geneName: 'TP53'
    })

    await expect(api.getDomains('P12345')).resolves.toMatchObject({
      domains: expect.any(Array)
    })

    await expect(api.getStructure('P12345')).resolves.toMatchObject({
      alphafoldId: 'AF-P12345-F1'
    })

    await expect(api.getGeneStructure('TP53')).resolves.toMatchObject({
      exons: expect.any(Array),
      totalLength: 20000
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'protein:mapping', 'TP53')
    expect(invoke).toHaveBeenNthCalledWith(2, 'protein:domains', 'P12345')
    expect(invoke).toHaveBeenNthCalledWith(3, 'protein:structure', 'P12345')
    expect(invoke).toHaveBeenNthCalledWith(4, 'protein:gene-structure', 'TP53')
  })

  it('preload index preserves protein transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'protein:mapping') {
        return {
          uniprotAccession: 'P12345',
          geneName: 'TP53',
          proteinName: 'Cellular tumor antigen p53'
        }
      }
      if (channel === 'protein:domains') {
        return {
          domains: [
            {
              accession: 'IPR036236',
              name: 'p53-like TF domain',
              startPosition: 102,
              endPosition: 292
            }
          ]
        }
      }
      if (channel === 'protein:structure') {
        return {
          alphafoldId: 'AF-P12345-F1',
          pLddt: 85.5,
          modelUrl: 'https://alphafold.ebi.ac.uk/AF-P12345-F1-model_v4.pdb'
        }
      }
      if (channel === 'protein:gene-structure') {
        return {
          exons: [
            {
              startPosition: 7571720,
              endPosition: 7571896,
              strand: '-'
            }
          ],
          totalLength: 20000
        }
      }
      return null
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
      protein: {
        getMapping: (geneSymbol: string) => Promise<unknown>
        getDomains: (uniprotAccession: string) => Promise<unknown>
        getStructure: (uniprotAccession: string) => Promise<unknown>
        getGeneStructure: (geneSymbol: string) => Promise<unknown>
      }
    }

    await expect(api.protein.getMapping('TP53')).resolves.toMatchObject({
      geneName: 'TP53'
    })
    await expect(api.protein.getDomains('P12345')).resolves.toMatchObject({
      domains: expect.any(Array)
    })
    await expect(api.protein.getStructure('P12345')).resolves.toMatchObject({
      alphafoldId: 'AF-P12345-F1'
    })
    await expect(api.protein.getGeneStructure('TP53')).resolves.toMatchObject({
      totalLength: 20000
    })

    expect(invoke).toHaveBeenCalledWith('protein:mapping', 'TP53')
    expect(invoke).toHaveBeenCalledWith('protein:domains', 'P12345')
    expect(invoke).toHaveBeenCalledWith('protein:structure', 'P12345')
    expect(invoke).toHaveBeenCalledWith('protein:gene-structure', 'TP53')
  })
})
