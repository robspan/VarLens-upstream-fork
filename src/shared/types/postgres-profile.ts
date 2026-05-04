export type PostgresProfileSslMode = 'disable' | 'require-verify'

export interface PostgresConnectionProfilePublic {
  id: string
  name: string
  host: string
  port: number
  database: string
  username: string
  schema: string
  sslMode: PostgresProfileSslMode
  poolMax: number
  connectionTimeoutMillis: number
  statementTimeoutMs: number
  lockTimeoutMs: number
  idleInTransactionSessionTimeoutMs: number
  caCertificateConfigured: boolean
}

export interface PostgresConnectionProfileSecretInput {
  password: string
  caCertificatePem?: string
}

export interface PostgresConnectionProfileInput extends Omit<
  PostgresConnectionProfilePublic,
  'id' | 'caCertificateConfigured'
> {
  secrets: PostgresConnectionProfileSecretInput
}

export interface PostgresConnectionProfileSaveInput extends Omit<
  PostgresConnectionProfileInput,
  'secrets'
> {
  id?: string
  secrets?: PostgresConnectionProfileSecretInput
}

export interface PostgresConnectionTestResult {
  ok: boolean
  serverVersion?: string
  currentUser?: string
  database?: string
  schema: string
  currentMigration?: string | null
  message?: string
}

export interface PostgresHealthDiagnosticResult {
  ok: boolean
  serverVersion?: string
  currentUser?: string
  schema: string
  currentMigration?: string | null
  canReadSchema?: boolean
  canWriteSchema?: boolean
  message?: string
}
