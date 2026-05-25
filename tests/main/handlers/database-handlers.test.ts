import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { mainLogger } from '../../../src/main/services/MainLogger'
import { ErrorCode } from '../../../src/shared/types/errors'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic
} from '../../../src/shared/types/postgres-profile'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => process.env.VARLENS_TEST_USER_DATA_PATH ?? tmpdir()),
    isPackaged: false
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => true)
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}))

const postgresInput = (
  overrides: Partial<PostgresConnectionProfileInput> = {}
): PostgresConnectionProfileInput => ({
  name: 'Lab PG',
  host: 'db.example.org',
  port: 5432,
  database: 'varlens',
  username: 'varlens_app',
  schema: 'workspace_a',
  sslMode: 'disable',
  poolMax: 4,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 10000,
  secrets: { password: 'super-secret' },
  ...overrides
})

const publicProfile = (
  overrides: Partial<PostgresConnectionProfilePublic> = {}
): PostgresConnectionProfilePublic => ({
  id: 'profile-1',
  name: 'Lab PG',
  host: 'db.example.org',
  port: 5432,
  database: 'varlens',
  username: 'varlens_app',
  schema: 'workspace_a',
  sslMode: 'disable',
  poolMax: 4,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 10000,
  caCertificateConfigured: false,
  ...overrides
})

const createHandlerMap = async (dependencies: Record<string, unknown> = {}) => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }

  const { registerDatabaseHandlers } = await import('../../../src/main/ipc/handlers/database')

  registerDatabaseHandlers({
    ipcMain: ipcMain as never,
    getDb: vi.fn() as never,
    getDbManager: vi.fn() as never,
    getDbPool: vi.fn() as never,
    ...dependencies
  })

  return { handlers, ipcMain }
}

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

  it('registers postgres profile list, save, and remove handlers through the injected profile store', async () => {
    const profile = publicProfile()
    const store = {
      listProfiles: vi.fn().mockResolvedValue([profile]),
      saveProfile: vi.fn().mockResolvedValue(profile),
      removeProfile: vi.fn().mockResolvedValue(undefined)
    }
    const { handlers } = await createHandlerMap({
      getPostgresProfileStore: () => store
    })

    await expect(handlers.get('database:postgresProfilesList')!()).resolves.toEqual([profile])
    await expect(
      handlers.get('database:postgresProfileSave')!(undefined, postgresInput())
    ).resolves.toEqual(profile)
    await expect(
      handlers.get('database:postgresProfileRemove')!(undefined, 'profile-1')
    ).resolves.toEqual({ success: true })

    expect(store.listProfiles).toHaveBeenCalledOnce()
    expect(store.saveProfile).toHaveBeenCalledWith(postgresInput())
    expect(store.removeProfile).toHaveBeenCalledWith('profile-1')
  })

  it('rejects invalid postgres profile save params at the IPC boundary without leaking secrets', async () => {
    const errorSpy = vi.spyOn(mainLogger, 'error').mockImplementation(() => undefined)
    const store = {
      saveProfile: vi.fn()
    }
    const { handlers } = await createHandlerMap({
      getPostgresProfileStore: () => store
    })

    const result = await handlers.get('database:postgresProfileSave')!(undefined, {
      ...postgresInput(),
      host: '',
      secrets: { password: 'super-secret' }
    })

    expect(result).toMatchObject({
      code: ErrorCode.UNKNOWN,
      message: 'Invalid PostgreSQL profile parameters'
    })
    expect(store.saveProfile).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain('super-secret')

    errorSpy.mockRestore()
  })

  it('tests postgres profiles without switching the active database', async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined), query: vi.fn() }
    const openPostgresSession = vi.fn()
    const { handlers } = await createHandlerMap({
      getDbManager: () => ({ openPostgresSession }),
      createPostgresPool: vi.fn().mockReturnValue(pool),
      collectPostgresDiagnostics: vi.fn().mockResolvedValue({
        ok: true,
        serverVersion: 'PostgreSQL 16',
        currentUser: 'varlens_app',
        schema: 'workspace_a',
        currentMigration: '006'
      })
    })

    const result = await handlers.get('database:postgresProfileTest')!(undefined, postgresInput())

    expect(result).toMatchObject({
      ok: true,
      database: 'varlens',
      schema: 'workspace_a'
    })
    expect(openPostgresSession).not.toHaveBeenCalled()
    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('opens a stored postgres profile through DatabaseManager.openPostgresSession', async () => {
    const profile = publicProfile()
    const expectedInfo = {
      path: 'postgresql://db.example.org:5432/varlens',
      name: 'PostgreSQL: db.example.org:5432/varlens (workspace_a)',
      encrypted: false
    }
    const pool = { end: vi.fn().mockResolvedValue(undefined), query: vi.fn() }
    const session = {
      close: vi.fn().mockResolvedValue(undefined),
      workspace: {
        kind: 'postgres',
        schema: 'workspace_a',
        connectionUrlRedacted: expectedInfo.path,
        connectionLabel: 'db.example.org:5432/varlens (workspace_a)'
      },
      capabilities: { backend: 'postgres' }
    }
    const openPostgresSession = vi.fn().mockResolvedValue(undefined)
    const { handlers } = await createHandlerMap({
      getDbManager: () => ({
        openPostgresSession,
        getCurrentInfo: vi.fn().mockReturnValue(expectedInfo)
      }),
      getPostgresProfileStore: () => ({
        listProfiles: vi.fn().mockResolvedValue([profile]),
        getProfileSecrets: vi.fn().mockResolvedValue({ password: 'super-secret' })
      }),
      createPostgresPool: vi.fn().mockReturnValue(pool),
      createPostgresSession: vi.fn().mockReturnValue(session),
      migratePostgres: vi.fn().mockResolvedValue(undefined),
      collectPostgresDiagnostics: vi.fn().mockResolvedValue({ ok: true, schema: 'workspace_a' })
    })

    await expect(
      handlers.get('database:postgresProfileOpen')!(undefined, 'profile-1')
    ).resolves.toEqual({
      success: true,
      info: expectedInfo
    })

    expect(openPostgresSession).toHaveBeenCalledWith(session)
  })

  it('warns once when the insecure postgres profile secret store is activated', async () => {
    const previousSecretStore = process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE
    const previousUserDataPath = process.env.VARLENS_TEST_USER_DATA_PATH
    const userDataPath = await mkdtemp(join(tmpdir(), 'varlens-profile-store-'))
    const warnSpy = vi.spyOn(mainLogger, 'warn').mockImplementation(() => undefined)

    process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE = 'insecure-local'
    process.env.VARLENS_TEST_USER_DATA_PATH = userDataPath

    try {
      const { handlers } = await createHandlerMap()

      await expect(handlers.get('database:postgresProfilesList')!()).resolves.toEqual([])
      await expect(handlers.get('database:postgresProfilesList')!()).resolves.toEqual([])

      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local is active. ' +
            'PostgreSQL profile credentials are stored in plaintext. ' +
            'Unset this env var or set it to a secure backend before any production-like workflow.'
        ),
        'database-handler'
      )
    } finally {
      if (previousSecretStore === undefined) {
        delete process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE
      } else {
        process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE = previousSecretStore
      }

      if (previousUserDataPath === undefined) {
        delete process.env.VARLENS_TEST_USER_DATA_PATH
      } else {
        process.env.VARLENS_TEST_USER_DATA_PATH = previousUserDataPath
      }

      warnSpy.mockRestore()
      await rm(userDataPath, { recursive: true, force: true })
      vi.resetModules()
    }
  })
})
