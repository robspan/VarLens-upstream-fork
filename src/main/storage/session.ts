import type { DatabaseService } from '../database/DatabaseService'
import type { DbPool } from '../database/DbPool'
import type { Case } from '../../shared/types/database'
import type { StorageReadExecutor } from './read-executor'
import type { StorageCapabilities, StorageHealth, WorkspaceRef } from './types'

export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  listCases(): Promise<Case[]>
  getReadExecutor(): StorageReadExecutor
  getDatabaseService(): DatabaseService
  getDbPool(): DbPool | null
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  rekey(newPassword: string): void
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
