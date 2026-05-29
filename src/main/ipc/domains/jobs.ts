import { ipcMain } from 'electron'
import { JOBS_CHANNELS } from '../../../shared/ipc/domains/jobs'
import type { JobKind, JobStatus } from '../../../shared/types/jobs'
import { jobRunner } from '../../services/jobs/runner'
import { wrapHandler } from '../errorHandler'

/**
 * Registers the read-only `jobs:` channels against the process-wide
 * {@link jobRunner}. No renderer consumes these in PR-4; the contract exists so
 * Sprint D's jobs drawer can wire up without further IPC plumbing.
 */
export function registerJobsHandlers(): void {
  ipcMain.handle(
    JOBS_CHANNELS.list,
    async (_event, filter?: { kind?: JobKind; status?: JobStatus }) =>
      wrapHandler(async () => jobRunner.list(filter))
  )

  ipcMain.handle(JOBS_CHANNELS.get, async (_event, jobId: string) =>
    wrapHandler(async () => jobRunner.get(jobId) ?? null)
  )

  ipcMain.handle(JOBS_CHANNELS.progress, async (_event, jobId: string) =>
    wrapHandler(async () => jobRunner.get(jobId)?.progress ?? null)
  )
}
