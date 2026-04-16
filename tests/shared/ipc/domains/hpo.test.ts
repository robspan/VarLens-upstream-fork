import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('hpo preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all hpo domain channels without unwrapping in createHpoApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        terms: [
          { id: 'HP:0000001', name: 'All' },
          { id: 'HP:0000118', name: 'Phenotypic abnormality' }
        ]
      })
      .mockResolvedValueOnce({ success: true })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createHpoApi } = await import('../../../../src/preload/domains/hpo')
    const api = createHpoApi()

    await expect(api.search('phenotypic')).resolves.toMatchObject({
      success: true,
      terms: expect.arrayContaining([
        expect.objectContaining({
          id: 'HP:0000001',
          name: 'All'
        })
      ])
    })

    await expect(api.clearCache()).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'hpo:search', 'phenotypic', undefined)
    expect(invoke).toHaveBeenNthCalledWith(2, 'hpo:clearCache')
  })

  it('handles hpo:search with maxResults parameter', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      success: true,
      terms: [{ id: 'HP:0000001', name: 'All' }]
    })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createHpoApi } = await import('../../../../src/preload/domains/hpo')
    const api = createHpoApi()

    await expect(api.search('phenotypic', 10)).resolves.toMatchObject({
      success: true,
      terms: expect.any(Array)
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'hpo:search', 'phenotypic', 10)
  })

  it('handles offline error response from hpo:search', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      success: false,
      error: 'No network connection and no cached data available',
      offline: true
    })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createHpoApi } = await import('../../../../src/preload/domains/hpo')
    const api = createHpoApi()

    await expect(api.search('phenotypic')).resolves.toMatchObject({
      success: false,
      offline: true
    })

    expect(invoke).toHaveBeenCalledWith('hpo:search', 'phenotypic', undefined)
  })

  it('preload index preserves hpo transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'hpo:search') {
        return {
          success: true,
          terms: [{ id: 'HP:0000001', name: 'All' }]
        }
      }
      if (channel === 'hpo:clearCache') {
        return { success: true }
      }
      return {
        code: ErrorCode.DB_ERROR,
        message: `${channel} failed`,
        userMessage: `Could not run ${channel}`
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
      hpo: {
        search: (query: string, maxResults?: number) => Promise<unknown>
        clearCache: () => Promise<unknown>
      }
    }

    await expect(api.hpo.search('phenotypic')).resolves.toMatchObject({
      success: true,
      terms: expect.any(Array)
    })
    await expect(api.hpo.clearCache()).resolves.toMatchObject({
      success: true
    })

    expect(invoke).toHaveBeenCalledWith('hpo:search', 'phenotypic', undefined)
    expect(invoke).toHaveBeenCalledWith('hpo:clearCache')
  })
})
