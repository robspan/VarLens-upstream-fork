import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}))

describe('database IPC handlers', () => {
  it('routes postgres database:overview through the active storage read executor', async () => {
    const expected = { summary: { total_cases: 1 }, cases: [] }
    const execute = vi.fn().mockResolvedValue(expected)
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }

    const { registerDatabaseHandlers } = await import('../../../src/main/ipc/handlers/database')

    registerDatabaseHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres database:overview')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute })
        })
      })) as never,
      getDbPool: (() => {
        throw new Error('getDbPool should not be called for postgres database:overview')
      }) as never
    })

    const handler = handlers.get('database:overview')
    expect(handler).toBeTypeOf('function')

    const result = await handler!()

    expect(result).toBe(expected)
    expect(execute).toHaveBeenCalledWith({ type: 'database:overview', params: [] })
  })
})
