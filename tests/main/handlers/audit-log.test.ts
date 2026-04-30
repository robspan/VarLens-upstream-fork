import { describe, expect, it, vi } from 'vitest'

import { registerAuditLogHandlers } from '../../../src/main/ipc/handlers/audit-log'

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>

function setupHandlers() {
  const readExecute = vi.fn()
  const handlers = new Map<string, RegisteredHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: RegisteredHandler) => {
      handlers.set(channel, handler)
    })
  }

  registerAuditLogHandlers({
    ipcMain: ipcMain as never,
    getDb: (() => {
      throw new Error('getDb should not be called for postgres audit log')
    }) as never,
    getDbManager: (() => ({
      getCurrentSession: () => ({
        capabilities: { backend: 'postgres' },
        getReadExecutor: () => ({ execute: readExecute })
      })
    })) as never
  })

  return { handlers, readExecute }
}

describe('audit-log IPC routing', () => {
  it('routes postgres audit:getByEntity through the active storage read executor', async () => {
    const expected = [{ entity_key: 'case:1:variant:2' }]
    const { handlers, readExecute } = setupHandlers()
    readExecute.mockResolvedValue(expected)

    await expect(handlers.get('audit:getByEntity')!(undefined, 'case:1:variant:2')).resolves.toBe(
      expected
    )
    expect(readExecute).toHaveBeenCalledWith({
      type: 'audit:getByEntity',
      params: ['case:1:variant:2']
    })
  })

  it('routes postgres audit:query through the active storage read executor', async () => {
    const expected = { data: [], total_count: 0 }
    const { handlers, readExecute } = setupHandlers()
    readExecute.mockResolvedValue(expected)

    await expect(
      handlers.get('audit:query')!(undefined, { action_type: 'star', limit: 25 })
    ).resolves.toBe(expected)
    expect(readExecute).toHaveBeenCalledWith({
      type: 'audit:query',
      params: [expect.objectContaining({ action_type: 'star', limit: 25 })]
    })
  })
})
