import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { mainLogger } from './MainLogger'
import type { UpdateStatus } from '../../shared/types/api'

let initialized = false
let checkInterval: ReturnType<typeof setInterval> | null = null

/** Current update status — kept in-memory for late-joining windows */
let currentStatus: UpdateStatus = { state: 'idle' }

function broadcastStatus(status: UpdateStatus): void {
  currentStatus = status
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', status)
    }
  })
}

/**
 * Initialize the auto-updater. Safe to call multiple times (no-ops after first).
 * In dev mode, registers no-op handlers so the IPC layer doesn't break.
 */
export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  if (is.dev) {
    mainLogger.info('Auto-updater disabled in dev mode', 'updater')
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // We use our own logger

  autoUpdater.on('checking-for-update', () => {
    mainLogger.info('Checking for updates...', 'updater')
    broadcastStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    mainLogger.info(`Update available: v${info.version}`, 'updater')
    broadcastStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainLogger.info('No updates available', 'updater')
    broadcastStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcastStatus({
      state: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainLogger.info(`Update downloaded: v${info.version}`, 'updater')
    broadcastStatus({
      state: 'downloaded',
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    mainLogger.error(`Update error: ${err.message}`, 'updater')
    broadcastStatus({
      state: 'error',
      error: err.message
    })
  })

  mainLogger.info('Auto-updater initialized', 'updater')
}

/** Check for updates. Safe to call in dev mode (no-ops). */
export async function checkForUpdates(): Promise<void> {
  if (is.dev) return
  await autoUpdater.checkForUpdates()
}

/** Start downloading the available update. */
export async function downloadUpdate(): Promise<void> {
  if (is.dev) return
  await autoUpdater.downloadUpdate()
}

/** Quit the app and install the downloaded update. */
export function installUpdate(): void {
  if (is.dev) return
  autoUpdater.quitAndInstall()
}

/** Get the current status (for late-joining windows). */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/**
 * Schedule periodic update checks.
 * @param delayMs — initial delay before first check (default 30s)
 * @param intervalMs — interval between checks (default 4 hours)
 */
export function scheduleUpdateChecks(delayMs = 30_000, intervalMs = 4 * 60 * 60 * 1000): void {
  if (is.dev) return
  if (checkInterval !== null) return

  setTimeout(() => {
    checkForUpdates().catch((err) => {
      mainLogger.error(`Scheduled update check failed: ${err}`, 'updater')
    })
    checkInterval = setInterval(() => {
      checkForUpdates().catch((err) => {
        mainLogger.error(`Scheduled update check failed: ${err}`, 'updater')
      })
    }, intervalMs)
  }, delayMs)
}

/** Stop periodic update checks. */
export function stopUpdateChecks(): void {
  if (checkInterval !== null) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
