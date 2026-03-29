/**
 * Tests for DatabaseManager - lifecycle, switching, rollback, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync, writeFileSync } from 'fs'
import { DatabaseManager } from '../../../src/main/services/DatabaseManager'
import { RecentDatabasesService } from '../../../src/main/services/RecentDatabasesService'
import { DatabaseError, WrongPasswordError } from '../../../src/main/database/errors'

// Helper to create a unique temp file path
function tempDbPath(suffix = ''): string {
  return join(
    tmpdir(),
    `varlens-test-dbmgr-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}.db`
  )
}

// Helper to clean up temp files including WAL/SHM
function cleanupDb(dbPath: string): void {
  for (const ext of ['', '-wal', '-shm']) {
    const p = dbPath + ext
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        // Best effort
      }
    }
  }
}

describe('DatabaseManager', () => {
  let settingsPath: string
  let recentService: RecentDatabasesService
  let manager: DatabaseManager

  beforeEach(() => {
    settingsPath = join(
      tmpdir(),
      `varlens-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
    recentService = new RecentDatabasesService(settingsPath)
    manager = new DatabaseManager(recentService)
  })

  afterEach(() => {
    manager.close()
    if (existsSync(settingsPath)) {
      try {
        unlinkSync(settingsPath)
      } catch {
        // Best effort
      }
    }
  })

  describe('open()', () => {
    it('opens a new database file', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)
        expect(manager.getCurrent()).toBeDefined()
        expect(manager.getCurrentInfo()).toEqual({
          path: dbPath,
          name: expect.stringContaining('.db'),
          encrypted: false
        })
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })

    it('closes previous database when opening a new one', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        manager.open(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('adds to recent databases list', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(dbPath)
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for invalid path', () => {
      expect(() => {
        manager.open('/nonexistent/directory/that/does/not/exist/test.db')
      }).toThrow(DatabaseError)
    })

    it('throws DatabaseError when trying to open a non-database file', () => {
      const fakePath = tempDbPath('-fake')
      writeFileSync(fakePath, 'this is not a database')
      try {
        expect(() => {
          manager.open(fakePath)
        }).toThrow(DatabaseError)
      } finally {
        cleanupDb(fakePath)
      }
    })
  })

  describe('createDatabase()', () => {
    it('creates a new database file', () => {
      const dbPath = tempDbPath()
      try {
        manager.createDatabase(dbPath)
        expect(existsSync(dbPath)).toBe(true)
        expect(manager.getCurrentPath()).toBe(dbPath)
        expect(manager.getCurrent()).toBeDefined()
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })

    it('closes previous database before creating new one', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        manager.createDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('adds to recent databases list', () => {
      const dbPath = tempDbPath()
      try {
        manager.createDatabase(dbPath)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(dbPath)
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for invalid path', () => {
      expect(() => {
        manager.createDatabase('/nonexistent/directory/that/does/not/exist/test.db')
      }).toThrow(DatabaseError)
    })
  })

  describe('switchDatabase()', () => {
    it('switches from one database to another', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        // Create db2 file first so it exists
        manager.createDatabase(db2)
        manager.close()

        // Now open db1 and switch to db2
        manager.open(db1)
        manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('rolls back to previous database on failure', () => {
      const db1 = tempDbPath('-1')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        // Try to switch to a non-existent path - should fail and rollback
        expect(() => {
          manager.switchDatabase('/nonexistent/directory/that/does/not/exist/bad.db')
        }).toThrow(DatabaseError)

        // Should still have db1 open after rollback
        expect(manager.getCurrentPath()).toBe(db1)
        expect(manager.getCurrent()).toBeDefined()
        // Verify the rolled-back connection works
        const result = manager.getCurrent().database.prepare('SELECT 1 as test').get() as {
          test: number
        }
        expect(result.test).toBe(1)
      } finally {
        manager.close()
        cleanupDb(db1)
      }
    })

    it('rolls back to previous database when opening corrupted file', () => {
      const db1 = tempDbPath('-1')
      const badDb = tempDbPath('-bad')
      writeFileSync(badDb, 'this is not a database file')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        expect(() => {
          manager.switchDatabase(badDb)
        }).toThrow(DatabaseError)

        // Previous database should be restored
        expect(manager.getCurrentPath()).toBe(db1)
        expect(manager.getCurrent()).toBeDefined()
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(badDb)
      }
    })

    it('works when switching from no database (null state)', () => {
      const dbPath = tempDbPath()
      try {
        // Manager starts with no database
        expect(manager.getCurrentPath()).toBeNull()

        manager.switchDatabase(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })

    it('restores null state on failure when no previous database', () => {
      // Manager starts with no database
      expect(manager.getCurrentPath()).toBeNull()

      expect(() => {
        manager.switchDatabase('/nonexistent/directory/bad.db')
      }).toThrow(DatabaseError)

      // Should be back to null state
      expect(manager.getCurrentPath()).toBeNull()
    })

    it('updates recent databases list on successful switch', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)
        manager.switchDatabase(db2)
        const recent = manager.getRecentDatabases()
        expect(recent.length).toBeGreaterThanOrEqual(2)
        expect(recent[0].path).toBe(db2) // Most recent first
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('does not update recent databases on failed switch', () => {
      const db1 = tempDbPath('-1')
      try {
        manager.open(db1)
        const recentBefore = manager.getRecentDatabases()

        expect(() => {
          manager.switchDatabase('/nonexistent/bad.db')
        }).toThrow(DatabaseError)

        const recentAfter = manager.getRecentDatabases()
        expect(recentAfter).toEqual(recentBefore)
      } finally {
        manager.close()
        cleanupDb(db1)
      }
    })
  })

  describe('openDetectEncryption()', () => {
    it('detects plaintext database', () => {
      const dbPath = tempDbPath()
      try {
        manager.createDatabase(dbPath)
        manager.close()

        const result = manager.openDetectEncryption(dbPath)
        expect(result.needsPassword).toBe(false)
      } finally {
        cleanupDb(dbPath)
      }
    })

    it('throws DatabaseError for non-existent file', () => {
      expect(() => {
        manager.openDetectEncryption('/nonexistent/bad.db')
      }).toThrow(DatabaseError)
    })

    it('throws DatabaseError for corrupted file', () => {
      const badPath = tempDbPath('-bad')
      writeFileSync(badPath, 'not a database')
      try {
        expect(() => {
          manager.openDetectEncryption(badPath)
        }).toThrow(DatabaseError)
      } finally {
        cleanupDb(badPath)
      }
    })
  })

  describe('close()', () => {
    it('safely closes when no database is open', () => {
      // Should not throw
      manager.close()
      expect(manager.getCurrentPath()).toBeNull()
    })

    it('clears state after closing', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        expect(manager.getCurrentPath()).toBe(dbPath)

        manager.close()
        expect(manager.getCurrentPath()).toBeNull()
        expect(manager.getCurrentInfo()).toBeNull()
      } finally {
        cleanupDb(dbPath)
      }
    })

    it('can be called multiple times safely', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        manager.close()
        manager.close() // Second close should not throw
        expect(manager.getCurrentPath()).toBeNull()
      } finally {
        cleanupDb(dbPath)
      }
    })
  })

  describe('getCurrent()', () => {
    it('throws DatabaseError when no database is open', () => {
      expect(() => {
        manager.getCurrent()
      }).toThrow(DatabaseError)
    })

    it('returns current database service', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        const current = manager.getCurrent()
        expect(current).toBeDefined()
        expect(current.getPath()).toBe(dbPath)
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })
  })

  describe('getCurrentInfo()', () => {
    it('returns null when no database is open', () => {
      expect(manager.getCurrentInfo()).toBeNull()
    })

    it('returns info for plaintext database', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        const info = manager.getCurrentInfo()
        expect(info).toEqual({
          path: dbPath,
          name: expect.any(String),
          encrypted: false
        })
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })
  })

  describe('multiple operations sequence', () => {
    it('handles open → switch → switch → close correctly', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      const db3 = tempDbPath('-3')
      try {
        manager.open(db1)
        expect(manager.getCurrentPath()).toBe(db1)

        manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)

        manager.switchDatabase(db3)
        expect(manager.getCurrentPath()).toBe(db3)

        manager.close()
        expect(manager.getCurrentPath()).toBeNull()
      } finally {
        cleanupDb(db1)
        cleanupDb(db2)
        cleanupDb(db3)
      }
    })

    it('handles open → failed switch → successful switch correctly', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)

        // Failed switch - should rollback
        expect(() => {
          manager.switchDatabase('/nonexistent/bad.db')
        }).toThrow(DatabaseError)
        expect(manager.getCurrentPath()).toBe(db1)

        // Successful switch
        manager.switchDatabase(db2)
        expect(manager.getCurrentPath()).toBe(db2)
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })
  })

  describe('removeRecentDatabase()', () => {
    it('removes a database from the recent list', () => {
      const db1 = tempDbPath('-1')
      const db2 = tempDbPath('-2')
      try {
        manager.open(db1)
        manager.switchDatabase(db2)
        expect(manager.getRecentDatabases()).toHaveLength(2)

        manager.removeRecentDatabase(db1)
        const recent = manager.getRecentDatabases()
        expect(recent).toHaveLength(1)
        expect(recent[0].path).toBe(db2)
      } finally {
        manager.close()
        cleanupDb(db1)
        cleanupDb(db2)
      }
    })

    it('does nothing when removing non-existent path', () => {
      const dbPath = tempDbPath()
      try {
        manager.open(dbPath)
        expect(manager.getRecentDatabases()).toHaveLength(1)

        manager.removeRecentDatabase('/nonexistent/fake.db')
        expect(manager.getRecentDatabases()).toHaveLength(1)
      } finally {
        manager.close()
        cleanupDb(dbPath)
      }
    })
  })
})
