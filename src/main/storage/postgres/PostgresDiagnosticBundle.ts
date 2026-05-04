import type { StorageCapabilities } from '../types'
import type { PostgresHealthDiagnosticResult } from './PostgresHealthDiagnostics'

export interface PostgresDiagnosticBundleInput {
  appVersion: string
  connectionUrlRedacted: string
  schema: string
  capabilities: StorageCapabilities
  diagnostics: PostgresHealthDiagnosticResult
}

export function createPostgresDiagnosticBundle(
  input: PostgresDiagnosticBundleInput
): Record<string, unknown> {
  return {
    appVersion: input.appVersion,
    backend: 'postgres',
    connectionUrlRedacted: input.connectionUrlRedacted,
    schema: input.schema,
    capabilities: input.capabilities,
    diagnostics: input.diagnostics,
    generatedAt: new Date().toISOString()
  }
}
