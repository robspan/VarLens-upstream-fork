import type { IpcResult } from '../../types/errors'
import type { Job, JobKind, JobStatus } from '../../types/jobs'

/**
 * Read-only `jobs:` IPC surface. Registered in PR-4 against the process-wide
 * {@link Job} tracker but NOT consumed by any renderer yet — Sprint D's global
 * jobs drawer ships against this contract.
 */
export interface JobsApi {
  /** `jobs:list` — all tracked jobs, optionally filtered by kind/status. */
  list: (filter?: { kind?: JobKind; status?: JobStatus }) => Promise<IpcResult<Job[]>>
  /** `jobs:get` — a single tracked job by id, or null when unknown. */
  get: (jobId: string) => Promise<IpcResult<Job | null>>
  /** `jobs:progress` — the current progress snapshot for a job (null if none). */
  progress: (jobId: string) => Promise<IpcResult<Job['progress']>>
}

export const JOBS_CHANNELS = {
  list: 'jobs:list',
  get: 'jobs:get',
  progress: 'jobs:progress'
} as const
