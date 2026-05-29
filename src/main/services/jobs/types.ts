/**
 * Job lifecycle types now live in `src/shared/types/jobs.ts` so the renderer can
 * reference them through the `jobs:` IPC contract without importing from
 * `src/main/…`. This module re-exports them for main-side call sites.
 */
export type { Job, JobKind, JobStatus } from '../../../shared/types/jobs'
