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
 * + getLogFilePath) using nothing but `console.*` and is selected via
 * `resolve.alias` in `vite.web.config.ts`. Worker-thread fallback in the
 * desktop logger already uses console, so this is the same code path —
 * just always-on.
 *
 * `console.*` calls are intentional here. AGENTS.md "no console.*" rule
 * has documented exceptions for places without IPC; the web bundle is one.
 */

/* eslint-disable no-console */

class WebLogger {
  getLogFilePath(): string {
    return ''
  }

  debug(message: string, source = 'web'): void {
    console.debug(`[${source}] ${message}`)
  }

  info(message: string, source = 'web'): void {
    console.info(`[${source}] ${message}`)
  }

  warn(message: string, source = 'web'): void {
    console.warn(`[${source}] ${message}`)
  }

  error(message: string, source = 'web'): void {
    console.error(`[${source}] ${message}`)
  }
}

export const mainLogger = new WebLogger()
export { WebLogger as MainLogger }
