/**
 * MainLogger - Singleton logger for main process
 * Logs to console/file via electron-log AND sends to renderer via IPC
 */

import log from 'electron-log/main'
import { BrowserWindow } from 'electron'
import type { LogMessage } from '../../shared/types/log'

// Configure electron-log
log.transports.file.level = 'info'
log.transports.console.level = 'debug'

/**
 * MainLogger class - wraps electron-log with IPC emission
 */
export class MainLogger {
  private static instance: MainLogger | null = null

  private constructor() {
    // Initialize electron-log for main process
    log.initialize()
  }

  static getInstance(): MainLogger {
    if (MainLogger.instance === null) {
      MainLogger.instance = new MainLogger()
    }
    return MainLogger.instance
  }

  private emit(level: LogMessage['level'], message: string, source: string): void {
    const logMessage: LogMessage = {
      timestamp: Date.now(),
      level,
      message,
      source
    }

    // Send to all renderer windows
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('logs:message', logMessage)
      }
    })
  }

  debug(message: string, source = 'main'): void {
    log.debug(`[${source}] ${message}`)
    this.emit('debug', message, source)
  }

  info(message: string, source = 'main'): void {
    log.info(`[${source}] ${message}`)
    this.emit('info', message, source)
  }

  warn(message: string, source = 'main'): void {
    log.warn(`[${source}] ${message}`)
    this.emit('warn', message, source)
  }

  error(message: string, source = 'main'): void {
    log.error(`[${source}] ${message}`)
    this.emit('error', message, source)
  }
}

// Export singleton instance for convenience
export const mainLogger = MainLogger.getInstance()
