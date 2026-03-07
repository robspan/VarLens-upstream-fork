import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UpdateStatus } from '../../../src/shared/types/api'

describe('UpdateStatus type', () => {
  it('accepts valid idle status', () => {
    const status: UpdateStatus = { state: 'idle' }
    expect(status.state).toBe('idle')
  })

  it('accepts valid available status with version', () => {
    const status: UpdateStatus = {
      state: 'available',
      version: '1.2.0',
      releaseNotes: 'Bug fixes'
    }
    expect(status.version).toBe('1.2.0')
  })

  it('accepts valid downloading status with progress', () => {
    const status: UpdateStatus = {
      state: 'downloading',
      progress: { percent: 45, bytesPerSecond: 1024, transferred: 512, total: 1024 }
    }
    expect(status.progress?.percent).toBe(45)
  })

  it('accepts valid error status', () => {
    const status: UpdateStatus = { state: 'error', error: 'Network failed' }
    expect(status.error).toBe('Network failed')
  })
})

// Mock electron-updater before importing the service
const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn()
}

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// Mock MainLogger
vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

describe('AutoUpdater service', () => {
  let autoUpdaterService: typeof import('../../../src/main/services/AutoUpdater')

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset module registry to get fresh instance
    vi.resetModules()
    // Re-mock after reset
    vi.doMock('electron-updater', () => ({
      autoUpdater: mockAutoUpdater
    }))
    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: vi.fn(() => [])
      }
    }))
    vi.doMock('../../../src/main/services/MainLogger', () => ({
      mainLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@electron-toolkit/utils', () => ({
      is: { dev: false }
    }))
    autoUpdaterService = await import('../../../src/main/services/AutoUpdater')
  })

  it('configures autoUpdater on init', () => {
    autoUpdaterService.initAutoUpdater()
    expect(mockAutoUpdater.autoDownload).toBe(false)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(mockAutoUpdater.on).toHaveBeenCalled()
  })

  it('registers event listeners for all update events', () => {
    autoUpdaterService.initAutoUpdater()
    const eventNames = mockAutoUpdater.on.mock.calls.map((call: [string, ...unknown[]]) => call[0])
    expect(eventNames).toContain('checking-for-update')
    expect(eventNames).toContain('update-available')
    expect(eventNames).toContain('update-not-available')
    expect(eventNames).toContain('download-progress')
    expect(eventNames).toContain('update-downloaded')
    expect(eventNames).toContain('error')
  })

  it('checkForUpdates calls autoUpdater.checkForUpdates', async () => {
    autoUpdaterService.initAutoUpdater()
    await autoUpdaterService.checkForUpdates()
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('downloadUpdate calls autoUpdater.downloadUpdate', async () => {
    autoUpdaterService.initAutoUpdater()
    await autoUpdaterService.downloadUpdate()
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled()
  })

  it('installUpdate calls autoUpdater.quitAndInstall', () => {
    autoUpdaterService.initAutoUpdater()
    autoUpdaterService.installUpdate()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled()
  })
})
