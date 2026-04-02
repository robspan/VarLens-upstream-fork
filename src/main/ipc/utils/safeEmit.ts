import { BrowserWindow } from 'electron'
import { mainLogger } from '../../services/MainLogger'

/**
 * Send a message to the renderer process safely.
 * No-ops if no window exists or window is destroyed.
 * Used by handler files for progress/state events.
 */
export function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) {
    mainLogger.debug(`safeEmit: no window for channel ${channel}`, 'ipc')
    return
  }
  win.webContents.send(channel, data)
}
