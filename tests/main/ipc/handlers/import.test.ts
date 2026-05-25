import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

vi.mock('../../../../src/main/ipc/handlers/import-logic', () => ({
  startImport: vi.fn().mockResolvedValue({
    caseId: 1,
    variantCount: 0,
    skipped: 0,
    errors: [],
    elapsed: 0
  }),
  cancelImport: vi.fn(),
  getVcfPreview: vi.fn(),
  getVcfMultiPreview: vi.fn(),
  startMultiFileImport: vi.fn()
}))

import { registerImportHandlers } from '../../../../src/main/ipc/handlers/import'
import { startImport } from '../../../../src/main/ipc/handlers/import-logic'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return {
    handle: vi.fn()
  }
}

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: () => unknown
  getDbManager: () => unknown
} {
  const getDb = vi.fn()
  const getDbManager = vi.fn().mockReturnValue({
    getCurrentSession: vi.fn().mockReturnValue({
      capabilities: { backend: 'sqlite' },
      getImportExecutor: vi.fn()
    })
  })
  return { ipcMain, getDb, getDbManager }
}

function getHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string
): HandlerCallback {
  const call = ipcMain.handle.mock.calls.find(([c]) => c === channel) as
    | [string, HandlerCallback]
    | undefined
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1]
}

async function invokeHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = getHandler(ipcMain, channel)
  return handler({}, ...args)
}

function expectInvalidParametersResult(result: unknown): void {
  expect(isIpcError(result)).toBe(true)
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  expect((result as { code: ErrorCode }).code).toBe(ErrorCode.INVALID_PARAMETERS)
}

describe('import IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns INVALID_PARAMETERS when import:start receives an empty filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:start', '', 'Case A', undefined)

    expectInvalidParametersResult(result)
    expect(startImport).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMETERS when import:start receives an empty caseName', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:start', '/tmp/variants.vcf', '', undefined)

    expectInvalidParametersResult(result)
    expect(startImport).not.toHaveBeenCalled()
  })
})
