import { describe, it, expect } from 'vitest'
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
