/**
 * Canonical DTOs for database entities used across process boundaries.
 *
 * These are the "shared truth" -- main process implements/extends them,
 * renderer consumes them. Never import from main/database/types in renderer.
 */

export interface Tag {
  id: number
  name: string
  color: string
  created_at?: number
}

export interface VariantAnnotation {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
  global_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export interface CaseVariantAnnotation {
  id: number
  case_id: number
  variant_id: number
  per_case_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

export type AuditActionType = 'import' | 'delete' | 'export' | 'update' | 'create'

export interface AuditLogEntry {
  id: number
  action_type: AuditActionType
  entity_type: string
  entity_key: string
  details: string | null
  user_name: string | null
  timestamp: number
}
