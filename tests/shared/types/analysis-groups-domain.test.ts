import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { AnalysisGroup, AnalysisGroupMember } from '../../../src/shared/types/api'

describe('analysisGroups preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all analysisGroups domain channels without unwrapping in createAnalysisGroupsApi', async () => {
    const mockGroup: AnalysisGroup = {
      id: 1,
      name: 'Test Group',
      group_type: 'cohort',
      description: 'A test analysis group',
      created_at: Date.now(),
      updated_at: Date.now()
    }

    const mockMember: AnalysisGroupMember = {
      id: 1,
      group_id: 1,
      case_id: 5,
      role: 'proband',
      affected_status: 'affected',
      individual_id: 'IND-001'
    }

    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        code: 'success',
        data: [mockGroup]
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: { ...mockGroup, members: [mockMember] }
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: mockGroup
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: mockGroup
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: undefined
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: mockMember
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: undefined
      })
      .mockResolvedValueOnce({
        code: 'success',
        data: mockGroup
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createAnalysisGroupsApi } = await import(
      '../../../src/preload/domains/analysis-groups'
    )
    const api = createAnalysisGroupsApi()

    // Test list
    await expect(api.list()).resolves.toEqual({
      code: 'success',
      data: [mockGroup]
    })

    // Test get
    await expect(api.get(1)).resolves.toEqual({
      code: 'success',
      data: { ...mockGroup, members: [mockMember] }
    })

    // Test create
    const createParams = { name: 'New Group', groupType: 'cohort', description: 'New' }
    await expect(api.create(createParams)).resolves.toEqual({
      code: 'success',
      data: mockGroup
    })

    // Test update
    const updateParams = { name: 'Updated Group' }
    await expect(api.update(1, updateParams)).resolves.toEqual({
      code: 'success',
      data: mockGroup
    })

    // Test delete
    await expect(api.delete(1)).resolves.toEqual({
      code: 'success',
      data: undefined
    })

    // Test addMember
    const memberParams = {
      groupId: 1,
      caseId: 5,
      role: 'proband',
      affectedStatus: 'affected',
      individualId: 'IND-001'
    }
    await expect(api.addMember(memberParams)).resolves.toEqual({
      code: 'success',
      data: mockMember
    })

    // Test removeMember
    await expect(api.removeMember(1, 5)).resolves.toEqual({
      code: 'success',
      data: undefined
    })

    // Test getForCase
    await expect(api.getForCase(5)).resolves.toEqual({
      code: 'success',
      data: mockGroup
    })

    // Verify all channels were invoked with correct parameters
    expect(invoke).toHaveBeenNthCalledWith(1, 'analysisGroups:list')
    expect(invoke).toHaveBeenNthCalledWith(2, 'analysisGroups:get', 1)
    expect(invoke).toHaveBeenNthCalledWith(3, 'analysisGroups:create', createParams)
    expect(invoke).toHaveBeenNthCalledWith(4, 'analysisGroups:update', 1, updateParams)
    expect(invoke).toHaveBeenNthCalledWith(5, 'analysisGroups:delete', 1)
    expect(invoke).toHaveBeenNthCalledWith(6, 'analysisGroups:addMember', memberParams)
    expect(invoke).toHaveBeenNthCalledWith(7, 'analysisGroups:removeMember', 1, 5)
    expect(invoke).toHaveBeenNthCalledWith(8, 'analysisGroups:getForCase', 5)
  })

  it('preload index preserves analysisGroups transport results when exposing window.api', async () => {
    const mockGroup: AnalysisGroup = {
      id: 1,
      name: 'Test Group',
      group_type: 'cohort',
      description: 'A test analysis group',
      created_at: Date.now(),
      updated_at: Date.now()
    }

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'analysisGroups:list') {
        return {
          code: ErrorCode.DB_ERROR,
          message: 'analysisGroups:list failed',
          userMessage: 'Could not list analysis groups'
        }
      }
      if (channel === 'analysisGroups:get') {
        return {
          code: 'success',
          data: { ...mockGroup, members: [] }
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

    await import('../../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      analysisGroups: {
        list: () => Promise<unknown>
        get: (id: number) => Promise<unknown>
      }
    }

    await expect(api.analysisGroups.list()).resolves.toMatchObject({
      code: ErrorCode.DB_ERROR,
      message: 'analysisGroups:list failed'
    })

    await expect(api.analysisGroups.get(1)).resolves.toMatchObject({
      code: 'success',
      data: { ...mockGroup, members: [] }
    })
  })
})
