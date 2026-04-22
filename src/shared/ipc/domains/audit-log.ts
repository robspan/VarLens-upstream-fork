import type { AuditLogEntry, AuditActionType, AuditEntityType } from '../../types/database'
import type { IpcResult } from '../../types/errors'

export interface AuditLogQueryParams {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

export interface AuditLogQueryResult {
  data: AuditLogEntry[]
  total_count: number
}

export interface AuditLogDomainContract {
  getByEntity: (entityKey: string) => Promise<IpcResult<AuditLogEntry[]>>
  query: (params: AuditLogQueryParams) => Promise<IpcResult<AuditLogQueryResult>>
}
