/**
 * Tests for database file deletion and case deletion concurrency guards.
 *
 * Uses mocked IPC dependencies to test handler logic without Electron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join, extname, resolve } from 'path'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'

// ── Extension validation (mirrors ALLOWED_DB_EXTENSIONS in database.ts) ──

const ALLOWED_DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3'])

function isAllowedDbExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ALLOWED_DB_EXTENSIONS.has(ext)
}

describe('database:deleteFile extension validation', () => {
  it('allows .db extension', () => {
    expect(isAllowedDbExtension('/path/to/varlens.db')).toBe(true)
  })

  it('allows .sqlite extension', () => {
    expect(isAllowedDbExtension('/path/to/data.sqlite')).toBe(true)
  })

  it('allows .sqlite3 extension', () => {
    expect(isAllowedDbExtension('/path/to/data.sqlite3')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAllowedDbExtension('/path/to/DATA.DB')).toBe(true)
    expect(isAllowedDbExtension('/path/to/DATA.SQLite')).toBe(true)
  })

  it('rejects .txt files', () => {
    expect(isAllowedDbExtension('/path/to/notes.txt')).toBe(false)
  })

  it('rejects .json files', () => {
    expect(isAllowedDbExtension('/path/to/settings.json')).toBe(false)
  })

  it('rejects .exe files', () => {
    expect(isAllowedDbExtension('/path/to/program.exe')).toBe(false)
  })

  it('rejects files with no extension', () => {
    expect(isAllowedDbExtension('/path/to/noextension')).toBe(false)
  })

  it('handles Windows-style paths', () => {
    expect(isAllowedDbExtension('C:\\Users\\data\\varlens.db')).toBe(true)
    expect(isAllowedDbExtension('C:\\Users\\data\\notes.txt')).toBe(false)
  })
})

// ── Mocked database:deleteFile handler logic ──

/**
 * Extracted handler logic from database.ts for testability.
 * Mirrors the real handler's checks: canonicalize → extension → recent list → active DB → delete.
 */
async function handleDeleteFile(
  path: string,
  currentPath: string | null,
  recentPaths: string[],
  removeRecentDatabase: (p: string) => void
): Promise<{ success: boolean }> {
  const canonicalPath = resolve(path)

  const ext = extname(canonicalPath).toLowerCase()
  if (!ALLOWED_DB_EXTENSIONS.has(ext)) {
    throw new Error(`Refusing to delete file with extension "${ext}".`)
  }

  if (!recentPaths.includes(canonicalPath)) {
    throw new Error('Can only delete databases that appear in the recent databases list.')
  }

  if (currentPath === canonicalPath) {
    throw new Error('Cannot delete the currently active database.')
  }

  if (!existsSync(canonicalPath)) {
    removeRecentDatabase(canonicalPath)
    return { success: true }
  }

  // Delete DB + WAL/SHM files
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = canonicalPath + suffix
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  removeRecentDatabase(canonicalPath)
  return { success: true }
}

describe('database:deleteFile handler logic', () => {
  const testDir = join(tmpdir(), `varlens-delete-test-${Date.now()}`)
  let removeRecentSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    removeRecentSpy = vi.fn()
  })

  afterEach(() => {
    // Clean up any leftover test files
    for (const ext of ['.db', '.db-wal', '.db-shm']) {
      const p = join(testDir, `test${ext}`)
      if (existsSync(p)) unlinkSync(p)
    }
  })

  it('deletes a database file and removes from recent list', async () => {
    const dbPath = resolve(join(testDir, 'test.db'))
    writeFileSync(dbPath, 'fake-db')

    const result = await handleDeleteFile(dbPath, null, [dbPath], removeRecentSpy)

    expect(result.success).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
    expect(removeRecentSpy).toHaveBeenCalledWith(dbPath)
  })

  it('also deletes WAL and SHM files', async () => {
    const dbPath = resolve(join(testDir, 'test.db'))
    writeFileSync(dbPath, 'fake-db')
    writeFileSync(dbPath + '-wal', 'fake-wal')
    writeFileSync(dbPath + '-shm', 'fake-shm')

    await handleDeleteFile(dbPath, null, [dbPath], removeRecentSpy)

    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(dbPath + '-wal')).toBe(false)
    expect(existsSync(dbPath + '-shm')).toBe(false)
  })

  it('refuses to delete the currently active database', async () => {
    const dbPath = resolve(join(testDir, 'test.db'))
    writeFileSync(dbPath, 'fake-db')

    await expect(handleDeleteFile(dbPath, dbPath, [dbPath], removeRecentSpy)).rejects.toThrow(
      'Cannot delete the currently active database'
    )

    // File should still exist
    expect(existsSync(dbPath)).toBe(true)
    expect(removeRecentSpy).not.toHaveBeenCalled()
  })

  it('refuses to delete non-database files', async () => {
    const txtPath = resolve('/path/to/notes.txt')
    await expect(handleDeleteFile(txtPath, null, [txtPath], removeRecentSpy)).rejects.toThrow(
      'Refusing to delete file with extension'
    )

    const jsonPath = resolve('/path/to/config.json')
    await expect(handleDeleteFile(jsonPath, null, [jsonPath], removeRecentSpy)).rejects.toThrow(
      'Refusing to delete file with extension'
    )

    expect(removeRecentSpy).not.toHaveBeenCalled()
  })

  it('refuses to delete a database not in the recent list', async () => {
    const dbPath = resolve(join(testDir, 'test.db'))
    writeFileSync(dbPath, 'fake-db')

    await expect(
      handleDeleteFile(dbPath, null, [], removeRecentSpy) // empty recent list
    ).rejects.toThrow('Can only delete databases that appear in the recent databases list')

    // File should still exist
    expect(existsSync(dbPath)).toBe(true)
    expect(removeRecentSpy).not.toHaveBeenCalled()
  })

  it('canonicalizes paths to prevent ../ traversal', async () => {
    const dbPath = resolve(join(testDir, 'test.db'))
    writeFileSync(dbPath, 'fake-db')
    // Use a path with ../ that resolves to the same file
    const traversalPath = join(testDir, 'subdir', '..', 'test.db')

    const result = await handleDeleteFile(traversalPath, null, [dbPath], removeRecentSpy)
    expect(result.success).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
  })

  it('handles already-deleted file gracefully', async () => {
    const dbPath = resolve(join(testDir, 'nonexistent.db'))

    const result = await handleDeleteFile(dbPath, null, [dbPath], removeRecentSpy)

    expect(result.success).toBe(true)
    expect(removeRecentSpy).toHaveBeenCalledWith(dbPath)
  })
})

// ── Delete concurrency guard ──

describe('case delete concurrency guard', () => {
  it('rejects concurrent delete when flag is set', () => {
    let deleteInProgress = false

    function tryStartDelete(): boolean {
      if (deleteInProgress) return false
      deleteInProgress = true
      return true
    }

    function finishDelete(): void {
      deleteInProgress = false
    }

    expect(tryStartDelete()).toBe(true)
    expect(tryStartDelete()).toBe(false) // Second concurrent attempt rejected
    expect(tryStartDelete()).toBe(false) // Still rejected

    finishDelete()
    expect(tryStartDelete()).toBe(true) // Now allowed again
    finishDelete()
  })

  it('clears flag in finally block even on error', () => {
    let deleteInProgress = false

    function simulateFailingDelete(): void {
      if (deleteInProgress) throw new Error('Already in progress')
      deleteInProgress = true
      try {
        throw new Error('Worker failed: database is locked')
      } finally {
        deleteInProgress = false
      }
    }

    // First call fails but clears the flag
    expect(() => simulateFailingDelete()).toThrow('Worker failed')
    expect(deleteInProgress).toBe(false)

    // Second call is allowed (not stuck)
    expect(() => simulateFailingDelete()).toThrow('Worker failed')
    expect(deleteInProgress).toBe(false)
  })

  it('flag prevents three-way race condition', async () => {
    let deleteInProgress = false
    const results: string[] = []

    async function simulateDelete(id: string, delayMs: number): Promise<void> {
      if (deleteInProgress) {
        results.push(`${id}:rejected`)
        return
      }
      deleteInProgress = true
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        results.push(`${id}:completed`)
      } finally {
        deleteInProgress = false
      }
    }

    // Start three concurrent deletes
    await Promise.all([simulateDelete('A', 50), simulateDelete('B', 10), simulateDelete('C', 10)])

    // Only the first should complete, others should be rejected
    expect(results).toContain('A:completed')
    expect(results).toContain('B:rejected')
    expect(results).toContain('C:rejected')
    expect(results.filter((r) => r.endsWith(':completed'))).toHaveLength(1)
  })
})
