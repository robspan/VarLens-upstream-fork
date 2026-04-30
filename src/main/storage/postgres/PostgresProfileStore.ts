import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput
} from '../../../shared/types/postgres-profile'
import { PostgresConnectionProfileSaveInputSchema } from './postgres-profile-validation'

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
    input: PostgresConnectionProfileSaveInput
  ): Promise<PostgresConnectionProfilePublic> {
    const validatedInput = PostgresConnectionProfileSaveInputSchema.parse(input)
    const settings = await this.readSettings()
    const profiles = settings.postgresProfiles ?? []
    const isUpdate = validatedInput.id !== undefined
    const id = validatedInput.id ?? randomUUID()
    const existingProfile = profiles.find((candidate) => candidate.id === id)

    if (isUpdate && existingProfile === undefined) {
      throw new Error(`Cannot update missing PostgreSQL profile ${id}`)
    }

    if (validatedInput.secrets !== undefined) {
      await this.secrets.set(this.secretKey(id, 'password'), validatedInput.secrets.password)

      if (validatedInput.secrets.caCertificatePem !== undefined) {
        await this.secrets.set(this.secretKey(id, 'ca'), validatedInput.secrets.caCertificatePem)
      }
    }

    const caCertificateConfigured =
      validatedInput.sslMode === 'require-verify' &&
      (validatedInput.secrets?.caCertificatePem !== undefined ||
        existingProfile?.caCertificateConfigured === true)

    const profile: PostgresConnectionProfilePublic = {
      id,
      name: validatedInput.name,
      host: validatedInput.host,
      port: validatedInput.port,
      database: validatedInput.database,
      username: validatedInput.username,
      schema: validatedInput.schema,
      sslMode: validatedInput.sslMode,
      poolMax: validatedInput.poolMax,
      connectionTimeoutMillis: validatedInput.connectionTimeoutMillis,
      statementTimeoutMs: validatedInput.statementTimeoutMs,
      lockTimeoutMs: validatedInput.lockTimeoutMs,
      idleInTransactionSessionTimeoutMs: validatedInput.idleInTransactionSessionTimeoutMs,
      caCertificateConfigured
    }

    settings.postgresProfiles = isUpdate
      ? profiles.map((candidate) => (candidate.id === id ? profile : candidate))
      : [...profiles, profile]
    await this.writeSettings(settings)
    return profile
  }

  async removeProfile(profileId: string): Promise<void> {
    const settings = await this.readSettings()
    settings.postgresProfiles = (settings.postgresProfiles ?? []).filter(
      (candidate) => candidate.id !== profileId
    )
    // SecretStore intentionally has no delete API yet; removing profile secrets is future work.
    await this.writeSettings(settings)
  }

  async getProfileSecrets(
    profileId: string
  ): Promise<{ password: string; caCertificatePem?: string }> {
    const profile = (await this.listProfiles()).find((candidate) => candidate.id === profileId)
    if (profile === undefined) {
      throw new Error(`Missing PostgreSQL profile ${profileId}`)
    }

    const password = await this.secrets.get(this.secretKey(profileId, 'password'))
    if (password === null) {
      throw new Error(`Missing PostgreSQL password secret for profile ${profileId}`)
    }

    const caCertificatePem =
      profile.caCertificateConfigured === true
        ? await this.secrets.get(this.secretKey(profileId, 'ca'))
        : null
    if (profile.caCertificateConfigured === true && caCertificatePem === null) {
      throw new Error(`Missing PostgreSQL CA certificate secret for profile ${profileId}`)
    }

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
