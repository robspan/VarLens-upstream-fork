import { ipcRenderer } from 'electron'
import { JOBS_CHANNELS, type JobsApi } from '../../shared/ipc/domains/jobs'

export function createJobsApi(): JobsApi {
  return {
    list: (filter) => ipcRenderer.invoke(JOBS_CHANNELS.list, filter),
    get: (jobId) => ipcRenderer.invoke(JOBS_CHANNELS.get, jobId),
    progress: (jobId) => ipcRenderer.invoke(JOBS_CHANNELS.progress, jobId)
  }
}
