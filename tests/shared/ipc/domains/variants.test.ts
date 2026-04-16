import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('variants preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all variants domain channels without unwrapping in createVariantsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            case_id: 1,
            chr: 'chr22',
            pos: 1000,
            ref: 'A',
            alt: 'T',
            variant_type: 'SNV'
          }
        ],
        total_count: 1
      })
      .mockResolvedValueOnce({
        consequences: ['HIGH', 'MODERATE'],
        funcs: ['missense_variant'],
        clinvars: ['Pathogenic'],
        minCadd: 0,
        maxCadd: 50,
        minGnomadAf: 0,
        maxGnomadAf: 0.01,
        columnMeta: []
      })
      .mockResolvedValueOnce([
        {
          id: 1,
          case_id: 1,
          chr: 'chr22',
          pos: 1000,
          ref: 'A',
          alt: 'T',
          variant_type: 'SNV'
        }
      ])
      .mockResolvedValueOnce(['BRCA1', 'TP53'])
      .mockResolvedValueOnce({
        SNV: 100,
        indel: 10,
        SV: 2
      })
      .mockResolvedValueOnce({
        type: 'numeric',
        min: 0,
        max: 50
      })
      .mockResolvedValueOnce(['SNV', 'indel', 'SV'])

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createVariantsApi } = await import('../../../../src/preload/domains/variants')
    const api = createVariantsApi()

    await expect(
      api.query(1, {}, 0, 50, undefined, false, false)
    ).resolves.toMatchObject({
      data: [
        {
          id: 1,
          case_id: 1,
          chr: 'chr22'
        }
      ],
      total_count: 1
    })

    await expect(api.getFilterOptions(1)).resolves.toMatchObject({
      consequences: ['HIGH', 'MODERATE'],
      funcs: ['missense_variant']
    })

    await expect(api.search(1, 'test')).resolves.toMatchObject([
      {
        id: 1,
        case_id: 1,
        chr: 'chr22'
      }
    ])

    await expect(api.geneSymbols(1, 'BRC')).resolves.toEqual(['BRCA1', 'TP53'])

    await expect(api.typeCounts(1)).resolves.toEqual({
      SNV: 100,
      indel: 10,
      SV: 2
    })

    await expect(
      api.columnMeta({
        caseId: 1,
        columnKey: 'cadd'
      })
    ).resolves.toMatchObject({
      type: 'numeric'
    })

    await expect(
      api.typesPresent({
        caseId: 1
      })
    ).resolves.toEqual(['SNV', 'indel', 'SV'])

    expect(invoke).toHaveBeenNthCalledWith(1, 'variants:query', 1, {}, 0, 50, undefined, false, false)
    expect(invoke).toHaveBeenNthCalledWith(2, 'variants:filterOptions', 1)
    expect(invoke).toHaveBeenNthCalledWith(3, 'variants:search', 1, 'test', undefined)
    expect(invoke).toHaveBeenNthCalledWith(4, 'variants:geneSymbols', 1, 'BRC', undefined)
    expect(invoke).toHaveBeenNthCalledWith(5, 'variants:typeCounts', 1)
    expect(invoke).toHaveBeenNthCalledWith(6, 'variants:columnMeta', {
      caseId: 1,
      columnKey: 'cadd'
    })
    expect(invoke).toHaveBeenNthCalledWith(7, 'variants:typesPresent', {
      caseId: 1
    })
  })

  it('preload index preserves variants transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'variants:query' || channel === 'variants:filterOptions') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'variants:search') {
        return [
          {
            id: 1,
            case_id: 1,
            chr: 'chr22',
            pos: 1000,
            ref: 'A',
            alt: 'T',
            variant_type: 'SNV'
          }
        ]
      }
      return {}
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
      variants: {
        query: (caseId: number, filters: unknown) => Promise<unknown>
        getFilterOptions: (caseId: number) => Promise<unknown>
        search: (caseId: number, query: string) => Promise<unknown>
      }
    }

    await expect(api.variants.query(1, {})).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'variants:query failed'
    })
    await expect(api.variants.getFilterOptions(1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'variants:filterOptions failed'
    })
    await expect(api.variants.search(1, 'test')).resolves.toMatchObject([
      {
        id: 1,
        case_id: 1,
        chr: 'chr22'
      }
    ])

    expect(invoke).toHaveBeenCalledWith('variants:query', 1, {}, undefined, undefined, undefined, undefined, undefined)
    expect(invoke).toHaveBeenCalledWith('variants:filterOptions', 1)
    expect(invoke).toHaveBeenCalledWith('variants:search', 1, 'test', 20)
  })
})
