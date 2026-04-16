import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('gene-lists preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all gene-lists domain channels without unwrapping in createGeneListsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          name: 'Test List',
          description: 'A test gene list',
          gene_count: 10,
          created_at: 1000000,
          updated_at: 1000000
        }
      ])
      .mockResolvedValueOnce({
        id: 2,
        name: 'New List',
        description: 'A new gene list',
        created_at: 1000001,
        updated_at: 1000001
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(['BRCA1', 'BRCA2', 'TP53'])
      .mockResolvedValueOnce(['EGFR', 'KRAS', 'MYC', 'ALK'])

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createGeneListsApi } = await import('../../../../src/preload/domains/gene-lists')
    const api = createGeneListsApi()

    await expect(api.list()).resolves.toMatchObject([
      {
        id: 1,
        name: 'Test List',
        gene_count: 10
      }
    ])

    await expect(api.create('New List', 'A new gene list')).resolves.toMatchObject({
      id: 2,
      name: 'New List'
    })

    await expect(api.delete(1)).resolves.toBeUndefined()

    await expect(api.getGenes(1)).resolves.toEqual(['BRCA1', 'BRCA2', 'TP53'])

    await expect(api.setGenes(2, ['EGFR', 'KRAS', 'MYC', 'ALK'])).resolves.toEqual([
      'EGFR',
      'KRAS',
      'MYC',
      'ALK'
    ])

    expect(invoke).toHaveBeenNthCalledWith(1, 'gene-lists:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'gene-lists:create', 'New List', 'A new gene list')
    expect(invoke).toHaveBeenNthCalledWith(3, 'gene-lists:delete', 1)
    expect(invoke).toHaveBeenNthCalledWith(4, 'gene-lists:getGenes', 1)
    expect(invoke).toHaveBeenNthCalledWith(5, 'gene-lists:setGenes', 2, [
      'EGFR',
      'KRAS',
      'MYC',
      'ALK'
    ])
  })

  it('preload index preserves gene-lists transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'gene-lists:list' || channel === 'gene-lists:getGenes') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'gene-lists:delete') {
        return undefined
      }
      if (channel === 'gene-lists:create') {
        return {
          id: 1,
          name: 'Test',
          description: null,
          created_at: 1000000,
          updated_at: 1000000
        }
      }
      if (channel === 'gene-lists:setGenes') {
        return ['GENE1', 'GENE2']
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
      geneLists: {
        list: () => Promise<unknown>
        create: (name: string, description?: string | null) => Promise<unknown>
        delete: (id: number) => Promise<unknown>
        getGenes: (listId: number) => Promise<unknown>
      }
    }

    await expect(api.geneLists.list()).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'gene-lists:list failed'
    })

    await expect(api.geneLists.create('Test')).resolves.toMatchObject({
      id: 1,
      name: 'Test'
    })

    await expect(api.geneLists.delete(1)).resolves.toBeUndefined()

    await expect(api.geneLists.getGenes(1)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'gene-lists:getGenes failed'
    })

    expect(invoke).toHaveBeenCalledWith('gene-lists:list')
    expect(invoke).toHaveBeenCalledWith('gene-lists:create', 'Test', undefined)
    expect(invoke).toHaveBeenCalledWith('gene-lists:delete', 1)
    expect(invoke).toHaveBeenCalledWith('gene-lists:getGenes', 1)
  })
})
