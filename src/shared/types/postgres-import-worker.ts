import type { ClientConfig } from 'pg'
import type { MultiFileImportSpec } from './api'

/**
 * pg.Client config plumbed from main to worker. Mirrors the connection-relevant
 * fields of buildPostgresPoolConfig minus pool-only fields. SSL is serialized
 * as a discriminated descriptor since `tls.SecureContextOptions` does not
 * round-trip through structuredClone.
 */
export interface PostgresClientConfig {
  connectionString: string
  application_name?: string
  connectionTimeoutMillis?: number
  statement_timeout?: number
  query_timeout?: number
  lock_timeout?: number
  idle_in_transaction_session_timeout?: number
  keepAlive?: boolean
  ssl?:
    | { mode: 'disable' }
    | { mode: 'require'; rejectUnauthorized: boolean }
}

export interface PostgresImportWorkerStartMessage {
  type: 'start'
  client: PostgresClientConfig
  schema: string
  mode: 'single-file' | 'multi-file'
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  // Single-file:
  filePath?: string
  format?: 'json' | 'vcf'
  // Multi-file:
  files?: MultiFileImportSpec[]
  filters?: {
    bedFilePath?: string | null
    bedPadding?: number
    passOnly?: boolean
    minQual?: number | null
    minGq?: number | null
    minDp?: number | null
  }
  batchSize?: number
  throttleMs?: number
}

export interface PostgresImportWorkerCancelMessage {
  type: 'cancel'
}

export type PostgresImportWorkerInboundMessage =
  | PostgresImportWorkerStartMessage
  | PostgresImportWorkerCancelMessage

export interface PostgresImportWorkerProgressMessage {
  type: 'progress'
  phase: 'parsing' | 'inserting' | 'finalizing'
  rowsProcessed: number
  rowsTotal?: number
  filePath?: string
}

export interface PostgresImportWorkerFileCompleteMessage {
  type: 'file-complete'
  filePath: string
  caseId: number
  variantCount: number
}

export interface PostgresImportWorkerCompleteMessage {
  type: 'complete'
  // Discriminated by the start mode.
  mode: 'single-file' | 'multi-file'
  result: {
    caseId: number
    variantCount: number
    files?: Array<{
      filePath: string
      variantType: string
      variantCount: number
      error?: string
    }>
    skipped: number
    errors: string[]
    elapsed: number
  }
}

export interface PostgresImportWorkerErrorMessage {
  type: 'error'
  message: string
  cause?: string
}

export type PostgresImportWorkerOutboundMessage =
  | PostgresImportWorkerProgressMessage
  | PostgresImportWorkerFileCompleteMessage
  | PostgresImportWorkerCompleteMessage
  | PostgresImportWorkerErrorMessage

/**
 * Helper to convert the runtime `ClientConfig` produced by `buildPostgresClientConfig`
 * into the structured-clone-safe `PostgresClientConfig` for the start message.
 */
export function toPostgresClientConfigMessage(
  client: ClientConfig & { connectionString: string }
): PostgresClientConfig {
  let ssl: PostgresClientConfig['ssl']
  if (client.ssl === undefined) {
    ssl = { mode: 'disable' }
  } else if (typeof client.ssl === 'object' && 'rejectUnauthorized' in client.ssl) {
    ssl = { mode: 'require', rejectUnauthorized: Boolean(client.ssl.rejectUnauthorized) }
  } else {
    ssl = { mode: 'disable' }
  }
  return {
    connectionString: client.connectionString,
    application_name: client.application_name,
    connectionTimeoutMillis: client.connectionTimeoutMillis,
    statement_timeout:
      typeof client.statement_timeout === 'number' ? client.statement_timeout : undefined,
    query_timeout: typeof client.query_timeout === 'number' ? client.query_timeout : undefined,
    lock_timeout: typeof client.lock_timeout === 'number' ? client.lock_timeout : undefined,
    idle_in_transaction_session_timeout:
      typeof client.idle_in_transaction_session_timeout === 'number'
        ? client.idle_in_transaction_session_timeout
        : undefined,
    keepAlive: client.keepAlive,
    ssl
  }
}
