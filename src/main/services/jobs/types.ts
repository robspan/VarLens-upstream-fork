import type { SerializableError } from '../../../shared/types/errors'

export type JobKind = 'import_single' | 'import_batch' | 'cohort_rebuild' | 'association' | 'export'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Job<P = unknown> {
  id: string // ULID, chronologically sortable
  kind: JobKind
  status: JobStatus
  params: P
  progress: { current: number; total: number; message?: string } | null
  error: SerializableError | null
  createdAt: number // epoch ms
  startedAt: number | null
  finishedAt: number | null
}
