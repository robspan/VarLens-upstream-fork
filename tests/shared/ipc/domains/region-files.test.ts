import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('region-files preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all region-files domain channels without unwrapping in createRegionFilesApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          name: 'Test Region File',
          description: 'A test region file',
          region_count: 5,
          total_bases: 10000,
          created_at: 1000000,
          updated_at: 1000000
        }
      ])
      .mockResolvedValueOnce({
        id: 2,
        name: 'New Region File',
        description: 'A new region file',
        region_count: 0,
        total_bases: 0,
        created_at: 1000001,
        updated_at: 1000001
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 2,
        name: 'New Region File',
        description: 'A new region file',
        region_count: 3,
        total_bases: 5000,
        created_at: 1000001,
        updated_at: 1000002
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createRegionFilesApi } = await import('../../../../src/preload/domains/region-files')
    const api = createRegionFilesApi()

    await expect(api.list()).resolves.toMatchObject([
      {
        id: 1,
        name: 'Test Region File',
        region_count: 5
      }
    ])

    await expect(api.create('New Region File', 'A new region file')).resolves.toMatchObject({
      id: 2,
      name: 'New Region File'
    })

    await expect(api.delete(1)).resolves.toBeUndefined()

    await expect(api.importBed(2, '/path/to/file.bed')).resolves.toMatchObject({
      id: 2,
      name: 'New Region File',
      region_count: 3
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'region-files:list')
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'region-files:create',
      'New Region File',
      'A new region file'
    )
    expect(invoke).toHaveBeenNthCalledWith(3, 'region-files:delete', 1)
    expect(invoke).toHaveBeenNthCalledWith(4, 'region-files:importBed', 2, '/path/to/file.bed')
  })

  it('preload index preserves region-files transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'region-files:list') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'region-files:delete') {
        return undefined
      }
      if (channel === 'region-files:create' || channel === 'region-files:importBed') {
        return {
          id: 1,
          name: 'Test',
          description: null,
          region_count: 0,
          total_bases: 0,
          created_at: 1000000,
          updated_at: 1000000
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
      regionFiles: {
        list: () => Promise<unknown>
        create: (name: string, description: string | null) => Promise<unknown>
        delete: (id: number) => Promise<unknown>
        importBed: (fileId: number, filePath: string) => Promise<unknown>
      }
    }

    await expect(api.regionFiles.list()).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'region-files:list failed'
    })

    await expect(api.regionFiles.create('Test', null)).resolves.toMatchObject({
      id: 1,
      name: 'Test'
    })

    await expect(api.regionFiles.delete(1)).resolves.toBeUndefined()

    await expect(api.regionFiles.importBed(1, '/path/to/file.bed')).resolves.toMatchObject({
      id: 1,
      name: 'Test'
    })

    expect(invoke).toHaveBeenCalledWith('region-files:list')
    expect(invoke).toHaveBeenCalledWith('region-files:create', 'Test', null)
    expect(invoke).toHaveBeenCalledWith('region-files:delete', 1)
    expect(invoke).toHaveBeenCalledWith('region-files:importBed', 1, '/path/to/file.bed')
  })
})
