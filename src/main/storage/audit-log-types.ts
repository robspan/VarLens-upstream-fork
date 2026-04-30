import type { AuditActionType, AuditEntityType, AuditLogEntry } from '../../shared/types/database'

export interface AuditQueryParams {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

export interface AuditQueryResult {
  data: AuditLogEntry[]
  total_count: number
}

export interface AuditAppendParams {
  action_type: AuditActionType
  entity_type: AuditEntityType
  entity_key: string
  old_value?: unknown
  new_value?: unknown
  user_name?: string | null
  metadata?: unknown
}
