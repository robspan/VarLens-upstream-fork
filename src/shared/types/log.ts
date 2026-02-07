/**
 * Log message for IPC transport from main to renderer
 */
export interface LogMessage {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source: string
}
