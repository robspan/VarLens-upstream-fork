export interface PostgresMigration {
  version: string
  name: string
  sql: string
  checksum: string
}

export interface PostgresMigrationResult {
  applied: string[]
  currentVersion: string | null
}
