import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('tags preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all tags domain channels without unwrapping in createTagsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          name: 'Important',
          color: '#ff0000',
          created_at: 1000000
        }
      ])
      .mockResolvedValueOnce({
        id: 1,
        name: 'Important',
        color: '#ff0000',
        created_at: 1000000
      })
      .mockResolvedValueOnce({
        id: 1,
        name: 'Important Updated',
        color: '#ff0000',
        created_at: 1000000
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce([
        {
          id: 1,
          name: 'Important',
          color: '#ff0000',
          created_at: 1000000
        }
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createTagsApi } = await import('../../../../src/preload/domains/tags')
    const api = createTagsApi()

    await expect(api.list()).resolves.toMatchObject([
      {
        id: 1,
        name: 'Important',
        color: '#ff0000'
      }
    ])

    await expect(api.create('Important', '#ff0000')).resolves.toMatchObject({
      id: 1,
      name: 'Important',
      color: '#ff0000'
    })

    await expect(api.update(1, { name: 'Important Updated' })).resolves.toMatchObject({
      id: 1,
      name: 'Important Updated'
    })

    await expect(api.delete(1)).resolves.toBeUndefined()

    await expect(api.getUsageCount(1)).resolves.toBe(5)

    await expect(api.getVariantTags(1, 1)).resolves.toMatchObject([
      {
        id: 1,
        name: 'Important'
      }
    ])

    await expect(api.assignVariantTag(1, 1, 1)).resolves.toBeUndefined()

    await expect(api.removeVariantTag(1, 1, 1)).resolves.toBeUndefined()

    await expect(api.setVariantTags(1, 1, [1])).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'tags:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'tags:create', 'Important', '#ff0000')
    expect(invoke).toHaveBeenNthCalledWith(3, 'tags:update', 1, { name: 'Important Updated' })
    expect(invoke).toHaveBeenNthCalledWith(4, 'tags:delete', 1)
    expect(invoke).toHaveBeenNthCalledWith(5, 'tags:getUsageCount', 1)
    expect(invoke).toHaveBeenNthCalledWith(6, 'tags:getVariantTags', 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(7, 'tags:assignVariantTag', 1, 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(8, 'tags:removeVariantTag', 1, 1, 1)
    expect(invoke).toHaveBeenNthCalledWith(9, 'tags:setVariantTags', 1, 1, [1])
  })

  it('preload index preserves tags transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'tags:delete') {
        return undefined
      }
      if (channel === 'tags:getUsageCount') {
        return 5
      }
      if (
        channel === 'tags:assignVariantTag' ||
        channel === 'tags:removeVariantTag' ||
        channel === 'tags:setVariantTags'
      ) {
        return undefined
      }
      if (channel === 'tags:list' || channel === 'tags:getVariantTags') {
        return [
          {
            id: 1,
            name: 'Important',
            color: '#ff0000',
            created_at: 1000000
          }
        ]
      }
      return {
        id: 1,
        name: 'Important',
        color: '#ff0000',
        created_at: 1000000
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
      tags: {
        list: () => Promise<unknown>
        create: (name: string, color: string) => Promise<unknown>
        update: (id: number, updates: { name?: string; color?: string }) => Promise<unknown>
        delete: (id: number) => Promise<unknown>
        getUsageCount: (tagId: number) => Promise<unknown>
        getVariantTags: (caseId: number, variantId: number) => Promise<unknown>
        assignVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<unknown>
        removeVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<unknown>
        setVariantTags: (caseId: number, variantId: number, tagIds: number[]) => Promise<unknown>
      }
    }

    await expect(api.tags.list()).resolves.toMatchObject([{ id: 1, name: 'Important' }])
    await expect(api.tags.create('Important', '#ff0000')).resolves.toMatchObject({
      id: 1,
      name: 'Important'
    })
    await expect(api.tags.update(1, { name: 'Updated' })).resolves.toMatchObject({
      id: 1,
      name: 'Important'
    })
    await expect(api.tags.delete(1)).resolves.toBeUndefined()
    await expect(api.tags.getUsageCount(1)).resolves.toBe(5)
    await expect(api.tags.getVariantTags(1, 1)).resolves.toMatchObject([{ id: 1 }])
    await expect(api.tags.assignVariantTag(1, 1, 1)).resolves.toBeUndefined()
    await expect(api.tags.removeVariantTag(1, 1, 1)).resolves.toBeUndefined()
    await expect(api.tags.setVariantTags(1, 1, [1])).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('tags:list')
    expect(invoke).toHaveBeenCalledWith('tags:create', 'Important', '#ff0000')
    expect(invoke).toHaveBeenCalledWith('tags:update', 1, { name: 'Updated' })
    expect(invoke).toHaveBeenCalledWith('tags:delete', 1)
    expect(invoke).toHaveBeenCalledWith('tags:getUsageCount', 1)
    expect(invoke).toHaveBeenCalledWith('tags:getVariantTags', 1, 1)
    expect(invoke).toHaveBeenCalledWith('tags:assignVariantTag', 1, 1, 1)
    expect(invoke).toHaveBeenCalledWith('tags:removeVariantTag', 1, 1, 1)
    expect(invoke).toHaveBeenCalledWith('tags:setVariantTags', 1, 1, [1])
  })
})
