import { ipcRenderer } from 'electron'
import { DEBUG_CHANNELS, type DebugApi } from '../../shared/ipc/domains/debug'

export function createDebugApi(): DebugApi {
  return {
    queryCountersGet: () => ipcRenderer.invoke(DEBUG_CHANNELS.queryCountersGet),
    queryCountersReset: () => ipcRenderer.invoke(DEBUG_CHANNELS.queryCountersReset)
  }
}
