import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorCode } from '../../../../src/shared/types/errors'

describe('audit-log preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    delete (process as typeof process & { contextIsolated?: boolean }).contextIsolated
  })

  it('forwards all audit-log domain channels without unwrapping in createAuditLogApi', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          timestamp: 1000,
          action_type: 'acmg_classify',
          entity_type: 'variant_annotation',
          entity_key: 'chr1:1000:A:T',
          old_value: null,
          new_value: 'P',
          user_name: 'test-user'
        }
      ])
      .mockResolvedValueOnce({
        data: [
          {
            id: 2,
            timestamp: 2000,
            action_type: 'comment_add',
            entity_type: 'case_variant_annotation',
            entity_key: 'case-1:chr1:2000:C:G',
            old_value: null,
            new_value: 'Test comment',
            user_name: 'test-user'
          }
        ],
        total_count: 1
      })

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createAuditLogApi } = await import('../../../../src/preload/domains/audit-log')
    const api = createAuditLogApi()

    await expect(api.getByEntity('chr1:1000:A:T')).resolves.toEqual([
      {
        id: 1,
        timestamp: 1000,
        action_type: 'acmg_classify',
        entity_type: 'variant_annotation',
        entity_key: 'chr1:1000:A:T',
        old_value: null,
        new_value: 'P',
        user_name: 'test-user'
      }
    ])

    await expect(
      api.query({
        action_type: 'comment_add',
        entity_type: 'case_variant_annotation',
        limit: 10,
        offset: 0
      })
    ).resolves.toEqual({
      data: [
        {
          id: 2,
          timestamp: 2000,
          action_type: 'comment_add',
          entity_type: 'case_variant_annotation',
          entity_key: 'case-1:chr1:2000:C:G',
          old_value: null,
          new_value: 'Test comment',
          user_name: 'test-user'
        }
      ],
      total_count: 1
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'audit:getByEntity', 'chr1:1000:A:T')
    expect(invoke).toHaveBeenNthCalledWith(2, 'audit:query', {
      action_type: 'comment_add',
      entity_type: 'case_variant_annotation',
      limit: 10,
      offset: 0
    })
  })
})
