import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic
} from '../../../shared/types/postgres-profile'

export interface SecretStore {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
}

interface ProfileSettingsFile {
  postgresProfiles?: PostgresConnectionProfilePublic[]
}

export class PostgresProfileStore {
  constructor(
    private readonly settingsPath: string,
    private readonly secrets: SecretStore
  ) {}

  async listProfiles(): Promise<PostgresConnectionProfilePublic[]> {
    return (await this.readSettings()).postgresProfiles ?? []
  }

  async saveProfile(
    input: PostgresConnectionProfileInput
  ): Promise<PostgresConnectionProfilePublic> {
    const id = randomUUID()
    await this.secrets.set(this.secretKey(id, 'password'), input.secrets.password)

    const caCertificateConfigured = input.secrets.caCertificatePem !== undefined
    if (caCertificateConfigured) {
      await this.secrets.set(this.secretKey(id, 'ca'), input.secrets.caCertificatePem ?? '')
    }

    const profile: PostgresConnectionProfilePublic = {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      schema: input.schema,
      sslMode: input.sslMode,
      poolMax: input.poolMax,
      connectionTimeoutMillis: input.connectionTimeoutMillis,
      statementTimeoutMs: input.statementTimeoutMs,
      lockTimeoutMs: input.lockTimeoutMs,
      idleInTransactionSessionTimeoutMs: input.idleInTransactionSessionTimeoutMs,
      caCertificateConfigured
    }

    const settings = await this.readSettings()
    const profiles = settings.postgresProfiles ?? []
    settings.postgresProfiles = [...profiles.filter((candidate) => candidate.id !== id), profile]
    await this.writeSettings(settings)
    return profile
  }

  async getProfileSecrets(
    profileId: string
  ): Promise<{ password: string; caCertificatePem?: string }> {
    const password = await this.secrets.get(this.secretKey(profileId, 'password'))
    if (password === null) {
      throw new Error(`Missing PostgreSQL password secret for profile ${profileId}`)
    }

    const caCertificatePem = await this.secrets.get(this.secretKey(profileId, 'ca'))
    return {
      password,
      ...(caCertificatePem !== null ? { caCertificatePem } : {})
    }
  }

  private secretKey(profileId: string, secretName: 'password' | 'ca'): string {
    return `postgres:${profileId}:${secretName}`
  }

  private async readSettings(): Promise<ProfileSettingsFile> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as ProfileSettingsFile
      return {
        ...parsed,
        postgresProfiles: Array.isArray(parsed.postgresProfiles) ? parsed.postgresProfiles : []
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {}
      }
      throw error
    }
  }

  private async writeSettings(settings: ProfileSettingsFile): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true })
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }
}
