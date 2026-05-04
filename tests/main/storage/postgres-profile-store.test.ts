import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { PostgresProfileStore } from '../../../src/main/storage/postgres/PostgresProfileStore'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfileSaveInput
} from '../../../src/shared/types/postgres-profile'

const profileInput = (
  overrides: Partial<PostgresConnectionProfileInput> = {}
): PostgresConnectionProfileInput => ({
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
  secrets: { password: 'secret', caCertificatePem: 'pem' },
  ...overrides
})

const profileSaveInput = (
  overrides: Partial<PostgresConnectionProfileSaveInput> = {}
): PostgresConnectionProfileSaveInput => ({
  ...profileInput(),
  ...overrides
})

const createStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'varlens-pg-profile-'))
  const settingsPath = join(dir, 'settings.json')
  const secretValues = new Map<string, string>()
  const secrets = {
    set: vi.fn(async (key: string, value: string) => {
      secretValues.set(key, value)
    }),
    get: vi.fn(async (key: string) => secretValues.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      secretValues.delete(key)
    })
  }

  return {
    settingsPath,
    secretValues,
    secrets,
    store: new PostgresProfileStore(settingsPath, secrets)
  }
}

describe('PostgresProfileStore', () => {
  it('stores public profile separately from secrets', async () => {
    const { settingsPath, secrets, store } = await createStore()

    const profile = await store.saveProfile(profileInput())

    expect(profile.caCertificateConfigured).toBe(true)
    expect(secrets.set).toHaveBeenCalledWith(expect.stringContaining(profile.id), 'secret')
    expect(secrets.set).toHaveBeenCalledWith(expect.stringContaining(profile.id), 'pem')

    const settings = await readFile(settingsPath, 'utf8')
    expect(settings).toContain('Lab PG')
    expect(settings).not.toContain('secret')
    expect(settings).not.toContain('pem')
    await expect(store.listProfiles()).resolves.toEqual([profile])
  })

  it('updates an existing profile without adding a second public entry', async () => {
    const { store } = await createStore()
    const profile = await store.saveProfile(profileInput())

    const updated = await store.saveProfile({
      ...profileInput({
        name: 'Updated Lab PG',
        host: 'updated.example.org',
        secrets: { password: 'updated-secret', caCertificatePem: 'updated-pem' }
      }),
      id: profile.id
    })

    await expect(store.listProfiles()).resolves.toEqual([updated])
    expect(updated.id).toBe(profile.id)
    expect(updated.name).toBe('Updated Lab PG')
    expect(updated.host).toBe('updated.example.org')
  })

  it('replaces password and CA secrets when updating a profile', async () => {
    const { store } = await createStore()
    const profile = await store.saveProfile(profileInput())

    await store.saveProfile({
      ...profileInput({
        secrets: { password: 'updated-secret', caCertificatePem: 'updated-pem' }
      }),
      id: profile.id
    })

    await expect(store.getProfileSecrets(profile.id)).resolves.toEqual({
      password: 'updated-secret',
      caCertificatePem: 'updated-pem'
    })
  })

  it('preserves existing secrets when updating public profile fields without secrets', async () => {
    const { secrets, store } = await createStore()
    const profile = await store.saveProfile(profileInput())
    secrets.set.mockClear()

    const updated = await store.saveProfile(
      profileSaveInput({
        id: profile.id,
        name: 'Renamed Lab PG',
        secrets: undefined
      })
    )

    expect(updated.id).toBe(profile.id)
    expect(updated.name).toBe('Renamed Lab PG')
    expect(updated.caCertificateConfigured).toBe(true)
    expect(secrets.set).not.toHaveBeenCalled()
    await expect(store.getProfileSecrets(profile.id)).resolves.toEqual({
      password: 'secret',
      caCertificatePem: 'pem'
    })
  })

  it('preserves configured CA when replacing password without a new CA', async () => {
    const { store } = await createStore()
    const profile = await store.saveProfile(profileInput())

    const updated = await store.saveProfile(
      profileSaveInput({
        id: profile.id,
        secrets: { password: 'replacement-secret' }
      })
    )

    expect(updated.caCertificateConfigured).toBe(true)
    await expect(store.getProfileSecrets(profile.id)).resolves.toEqual({
      password: 'replacement-secret',
      caCertificatePem: 'pem'
    })
  })

  it('fails closed when a configured CA secret is missing', async () => {
    const { secretValues, store } = await createStore()
    const profile = await store.saveProfile(profileInput())
    for (const key of secretValues.keys()) {
      if (key.endsWith(':ca')) {
        secretValues.delete(key)
      }
    }

    await expect(store.getProfileSecrets(profile.id)).rejects.toThrow(
      `Missing PostgreSQL CA certificate secret for profile ${profile.id}`
    )
  })

  it('removes a profile from settings', async () => {
    const { store } = await createStore()
    const first = await store.saveProfile(profileInput({ name: 'First' }))
    const second = await store.saveProfile(profileInput({ name: 'Second' }))

    await store.removeProfile(first.id)

    await expect(store.listProfiles()).resolves.toEqual([second])
  })

  it('removes profile secrets when deleting a profile', async () => {
    const { secretValues, secrets, store } = await createStore()
    const profile = await store.saveProfile(profileInput())

    expect(secretValues.get(`postgres:${profile.id}:password`)).toBe('secret')
    expect(secretValues.get(`postgres:${profile.id}:ca`)).toBe('pem')

    await store.removeProfile(profile.id)

    expect(secrets.delete).toHaveBeenCalledWith(`postgres:${profile.id}:password`)
    expect(secrets.delete).toHaveBeenCalledWith(`postgres:${profile.id}:ca`)
    expect(secretValues.has(`postgres:${profile.id}:password`)).toBe(false)
    expect(secretValues.has(`postgres:${profile.id}:ca`)).toBe(false)
  })

  it('does not return leftover secrets after a profile is removed', async () => {
    const { store } = await createStore()
    const profile = await store.saveProfile(profileInput())

    await store.removeProfile(profile.id)

    await expect(store.getProfileSecrets(profile.id)).rejects.toThrow(
      `Missing PostgreSQL profile ${profile.id}`
    )
  })

  it('keeps credentials and CA bodies out of settings after updates and removes', async () => {
    const { settingsPath, store } = await createStore()
    const profile = await store.saveProfile(
      profileInput({ secrets: { password: 'secret-one', caCertificatePem: 'pem-one' } })
    )

    await store.saveProfile({
      ...profileInput({
        secrets: { password: 'secret-two', caCertificatePem: 'pem-two' }
      }),
      id: profile.id
    })
    await store.removeProfile(profile.id)

    const settings = await readFile(settingsPath, 'utf8')
    expect(settings).not.toContain('secret-one')
    expect(settings).not.toContain('pem-one')
    expect(settings).not.toContain('secret-two')
    expect(settings).not.toContain('pem-two')
  })

  it('does not persist CA secrets when SSL verification is disabled', async () => {
    const { secretValues, secrets, store } = await createStore()

    const profile = await store.saveProfile(
      profileInput({
        sslMode: 'disable',
        secrets: { password: 'secret', caCertificatePem: 'unused-pem' }
      })
    )

    expect(profile.caCertificateConfigured).toBe(false)
    expect(secrets.set).not.toHaveBeenCalledWith(`postgres:${profile.id}:ca`, 'unused-pem')
    expect(secretValues.has(`postgres:${profile.id}:ca`)).toBe(false)
  })
})
