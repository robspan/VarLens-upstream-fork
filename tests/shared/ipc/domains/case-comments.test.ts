import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('case-comments preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all case-comments domain channels without unwrapping in createCaseCommentsApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          case_id: 5,
          category: 'Clinical Note',
          content: 'Patient presents with symptoms',
          created_at: 1000000,
          updated_at: null
        },
        {
          id: 2,
          case_id: 5,
          category: 'Lab Result',
          content: 'Lab result completed',
          created_at: 1000001,
          updated_at: 1000002
        }
      ])
      .mockResolvedValueOnce({
        id: 3,
        case_id: 5,
        category: 'Interpretation',
        content: 'New interpretation',
        created_at: 1000003,
        updated_at: null
      })
      .mockResolvedValueOnce({
        id: 2,
        case_id: 5,
        category: 'Lab Result',
        content: 'Lab result updated',
        created_at: 1000001,
        updated_at: 1000010
      })
      .mockResolvedValueOnce(undefined)

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createCaseCommentsApi } = await import('../../../../src/preload/domains/case-comments')
    const api = createCaseCommentsApi()

    await expect(api.list(5)).resolves.toEqual([
      {
        id: 1,
        case_id: 5,
        category: 'Clinical Note',
        content: 'Patient presents with symptoms',
        created_at: 1000000,
        updated_at: null
      },
      {
        id: 2,
        case_id: 5,
        category: 'Lab Result',
        content: 'Lab result completed',
        created_at: 1000001,
        updated_at: 1000002
      }
    ])

    await expect(api.create(5, 'Interpretation', 'New interpretation')).resolves.toEqual({
      id: 3,
      case_id: 5,
      category: 'Interpretation',
      content: 'New interpretation',
      created_at: 1000003,
      updated_at: null
    })

    await expect(api.update(2, 'Lab result updated')).resolves.toEqual({
      id: 2,
      case_id: 5,
      category: 'Lab Result',
      content: 'Lab result updated',
      created_at: 1000001,
      updated_at: 1000010
    })

    await expect(api.delete(2)).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'case-comments:list', 5)
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'case-comments:create',
      5,
      'Interpretation',
      'New interpretation'
    )
    expect(invoke).toHaveBeenNthCalledWith(3, 'case-comments:update', 2, 'Lab result updated')
    expect(invoke).toHaveBeenNthCalledWith(4, 'case-comments:delete', 2)
  })

  it('preload index preserves case-comments transport results when exposing window.api', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'case-comments:list') {
        return {
          code: ErrorCode.DB_ERROR,
          message: `${channel} failed`,
          userMessage: `Could not run ${channel}`
        }
      }
      if (channel === 'case-comments:delete') {
        return undefined
      }
      return {
        id: 1,
        case_id: 5,
        category: 'Clinical Note',
        content: 'Test comment',
        created_at: 1000000,
        updated_at: null
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
      caseComments: {
        list: (caseId: number) => Promise<unknown>
        create: (caseId: number, category: string, content: string) => Promise<unknown>
        delete: (commentId: number) => Promise<unknown>
      }
    }

    await expect(api.caseComments.list(5)).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'case-comments:list failed'
    })
    await expect(
      api.caseComments.create(5, 'Clinical Note', 'Test comment')
    ).resolves.toMatchObject({
      id: 1,
      case_id: 5,
      category: 'Clinical Note'
    })
    await expect(api.caseComments.delete(1)).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('case-comments:list', 5)
    expect(invoke).toHaveBeenCalledWith('case-comments:create', 5, 'Clinical Note', 'Test comment')
    expect(invoke).toHaveBeenCalledWith('case-comments:delete', 1)
  })
})
