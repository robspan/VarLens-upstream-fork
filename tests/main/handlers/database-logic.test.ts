/**
 * Database logic smoke tests plus domain registration coverage.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as logic from '../../../src/main/ipc/handlers/database-logic'

const ROOT = resolve(__dirname, '..', '..', '..')

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../../src/main/ipc/handlers/database')
  vi.doUnmock('../../../src/main/ipc/handlers/filter-presets')
  vi.doUnmock('../../../src/main/database')
  vi.doUnmock('../../../src/main/ipc/dbPoolManager')
})

describe('database-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.openDatabase).toBe('function')
    expect(typeof logic.createDatabase).toBe('function')
    expect(typeof logic.rekeyDatabase).toBe('function')
    expect(typeof logic.getDatabaseInfo).toBe('function')
    expect(typeof logic.getRecentDatabases).toBe('function')
    expect(typeof logic.getDatabaseOverview).toBe('function')
    expect(typeof logic.removeRecentDatabase).toBe('function')
    expect(typeof logic.deleteDbFile).toBe('function')
  })
})

describe('database lifecycle logic', () => {
  it('does not require handler-level pool initialization after opening a database', async () => {
    const initDbPool = vi.fn()
    const triggerStartupRebuild = vi.fn()
    const db = {}
    const manager = {
      openDetectEncryption: vi.fn().mockReturnValue({ needsPassword: false }),
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: false
      })
    }

    const callbacks = { initDbPool, triggerStartupRebuild }

    await expect(
      logic.openDatabase(
        { path: '/tmp/varlens.db' },
        () => db as never,
        () => manager as never,
        callbacks
      )
    ).resolves.toMatchObject({ success: true })

    expect(initDbPool).not.toHaveBeenCalled()
    expect(triggerStartupRebuild).toHaveBeenCalledWith(db)
  })

  it('does not require handler-level pool initialization after creating a database', async () => {
    const initDbPool = vi.fn()
    const manager = {
      createDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentInfo: vi.fn().mockReturnValue({
        path: '/tmp/varlens.db',
        name: 'varlens.db',
        encrypted: false
      })
    }

    await expect(
      logic.createDatabase({ path: '/tmp/varlens.db' }, () => manager as never)
    ).resolves.toMatchObject({ success: true })

    expect(initDbPool).not.toHaveBeenCalled()
  })
})

describe('database IPC domain registration', () => {
  it('delegates database domain registration to database handlers with injected dependencies', async () => {
    const registerDatabaseHandlers = vi.fn()
    const getDatabaseService = vi.fn()
    const getDatabaseManager = vi.fn()
    const getDbPool = vi.fn()
    const ipcMain = { handle: vi.fn() }

    vi.doMock('../../../src/main/ipc/handlers/database', () => ({
      registerDatabaseHandlers
    }))
    vi.doMock('../../../src/main/database', () => ({
      getDatabaseService,
      getDatabaseManager
    }))
    vi.doMock('../../../src/main/ipc/dbPoolManager', () => ({
      getDbPool
    }))

    const { registerDatabaseDomain } = await import('../../../src/main/ipc/domains/database')

    registerDatabaseDomain(ipcMain as never)

    expect(registerDatabaseHandlers).toHaveBeenCalledOnce()
    expect(registerDatabaseHandlers).toHaveBeenCalledWith({
      ipcMain,
      getDb: getDatabaseService,
      getDbManager: getDatabaseManager,
      getDbPool
    })
  })

  it('delegates filter presets domain registration to preset handlers with injected dependencies', async () => {
    const registerFilterPresetHandlers = vi.fn()
    const getDatabaseService = vi.fn()
    const getDatabaseManager = vi.fn()
    const getDbPool = vi.fn()
    const ipcMain = { handle: vi.fn() }

    vi.doMock('../../../src/main/ipc/handlers/filter-presets', () => ({
      registerFilterPresetHandlers
    }))
    vi.doMock('../../../src/main/database', () => ({
      getDatabaseService,
      getDatabaseManager
    }))
    vi.doMock('../../../src/main/ipc/dbPoolManager', () => ({
      getDbPool
    }))

    const { registerFilterPresetsDomain } =
      await import('../../../src/main/ipc/domains/filter-presets')

    registerFilterPresetsDomain(ipcMain as never)

    expect(registerFilterPresetHandlers).toHaveBeenCalledOnce()
    expect(registerFilterPresetHandlers).toHaveBeenCalledWith({
      ipcMain,
      getDb: getDatabaseService,
      getDbManager: getDatabaseManager,
      getDbPool
    })
  })

  it('main IPC index wires the database and filter presets domain modules', () => {
    const indexSource = readFileSync(resolve(ROOT, 'src/main/ipc/index.ts'), 'utf-8')

    expect(indexSource).toContain("import { registerDatabaseDomain } from './domains/database'")
    expect(indexSource).toContain(
      "import { registerFilterPresetsDomain } from './domains/filter-presets'"
    )
    expect(indexSource).toContain('registerDatabaseDomain(ipcMain)')
    expect(indexSource).toContain('registerFilterPresetsDomain(ipcMain)')
  })
})
