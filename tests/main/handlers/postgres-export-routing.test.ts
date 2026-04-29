import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  exportPostgresVariants: vi.fn(),
  prepareVariantExport: vi.fn(),
  exportVariants: vi.fn(),
  exportCohort: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false }]
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog
  }
}))

vi.mock('../../../src/main/ipc/handlers/export-logic', () => ({
  prepareVariantExport: mocks.prepareVariantExport,
  exportVariants: mocks.exportVariants,
  exportCohort: mocks.exportCohort,
  exportPostgresVariants: mocks.exportPostgresVariants
}))

describe('postgres export IPC routing', () => {
  it('streams postgres variant exports through the active storage read executor', async () => {
    const rows = (async function* () {
      yield { id: 1 }
    })()
    const execute = vi.fn().mockResolvedValue(rows)
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/pg-export.csv' })
    mocks.exportPostgresVariants.mockResolvedValue({
      success: true,
      filePath: '/tmp/pg-export.csv'
    })

    const { registerExportHandlers } = await import('../../../src/main/ipc/handlers/export')

    registerExportHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres export:variants')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute })
        })
      })) as never,
      getDbPool: (() => null) as never
    })

    const handler = handlers.get('export:variants')
    expect(handler).toBeTypeOf('function')

    const result = await handler!(undefined, 5, { gene_symbol: 'BRCA1' }, 'Postgres Case')

    expect(result).toEqual({ success: true, filePath: '/tmp/pg-export.csv' })
    expect(mocks.prepareVariantExport).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'export:variants',
      params: [{ gene_symbol: 'BRCA1', case_id: 5 }]
    })
    expect(mocks.exportPostgresVariants).toHaveBeenCalledWith(
      rows,
      '/tmp/pg-export.csv',
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Export Variants to CSV',
        defaultPath: 'Postgres_Case_variants.csv',
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    )
  })
})
