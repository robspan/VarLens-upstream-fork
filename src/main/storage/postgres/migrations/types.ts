import type { PoolClient } from 'pg'

export interface PostgresMigration {
  version: string
  name: string
  sql: string
  checksum: string
  afterApply?: (client: Pick<PoolClient, 'query'>, schema: string) => Promise<void>
}

export interface PostgresMigrationResult {
  beforeVersion: string | null
  applied: string[]
  currentVersion: string | null
  schema: string
}
