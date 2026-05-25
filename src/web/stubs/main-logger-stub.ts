/**
 * Web-build stub for `src/main/services/MainLogger`.
 *
 * The desktop MainLogger requires `electron` and `electron-log/main` at
 * module top level (Rollup hoists those calls even though they live inside
 * a try/catch in source). Both are devDependencies — absent from the
 * post-prune production tree the web container ships. Loading the
 * desktop module under that tree produces MODULE_NOT_FOUND at boot.
 *
 * This stub matches the public surface of `mainLogger` (info/warn/error/debug
 * + getLogFilePath) and writes JSON log lines so web container logs stay
 * machine-readable even when aliased desktop logic logs through mainLogger.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
}

function writeLog(level: LogLevel, message: string, source: string): void {
  const line =
    JSON.stringify({
      level: LOG_LEVEL_VALUE[level],
      time: Date.now(),
      source,
      msg: message
    }) + '\n'
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout
  stream.write(line)
}

class WebLogger {
  getLogFilePath(): string {
    return ''
  }

  debug(message: string, source = 'web'): void {
    writeLog('debug', message, source)
  }

  info(message: string, source = 'web'): void {
    writeLog('info', message, source)
  }

  warn(message: string, source = 'web'): void {
    writeLog('warn', message, source)
  }

  error(message: string, source = 'web'): void {
    writeLog('error', message, source)
  }
}

export const mainLogger = new WebLogger()
export { WebLogger as MainLogger }
