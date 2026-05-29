import { JobRunner } from './JobRunner'

/**
 * Process-wide single-flight {@link JobRunner}. Wire sites (import, cohort
 * rebuild, association, export) share this instance so per-kind single-flight
 * gating spans the whole main process. Sprint C makes the runner injectable.
 */
export const jobRunner = new JobRunner()
