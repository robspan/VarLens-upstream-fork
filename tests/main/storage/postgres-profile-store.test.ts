import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { PostgresProfileStore } from '../../../src/main/storage/postgres/PostgresProfileStore'

describe('PostgresProfileStore', () => {
  it('stores public profile separately from secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'varlens-pg-profile-'))
    const settingsPath = join(dir, 'settings.json')
    const secrets = { set: vi.fn(), get: vi.fn() }
    const store = new PostgresProfileStore(settingsPath, secrets as never)

    const profile = await store.saveProfile({
      name: 'Lab PG',
      host: 'db.example.org',
      port: 5432,
      database: 'varlens',
      username: 'varlens_app',
      schema: 'workspace_a',
      sslMode: 'require-verify',
      poolMax: 4,
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      secrets: { password: 'secret', caCertificatePem: 'pem' }
    })

    expect(profile.caCertificateConfigured).toBe(true)
    expect(secrets.set).toHaveBeenCalledWith(expect.stringContaining(profile.id), 'secret')
    expect(secrets.set).toHaveBeenCalledWith(expect.stringContaining(profile.id), 'pem')

    const settings = await readFile(settingsPath, 'utf8')
    expect(settings).toContain('Lab PG')
    expect(settings).not.toContain('secret')
    expect(settings).not.toContain('pem')
    await expect(store.listProfiles()).resolves.toEqual([profile])
  })
})
