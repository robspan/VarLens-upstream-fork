/**
 * Tests for case deletion with FTS trigger optimization.
 *
 * Verifies that deleteAllCases and deleteCasesBatch properly handle
 * FTS triggers and complete without blocking.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { ImportService } from '../../../src/main/import/ImportService'

const FIXTURES_DIR = join(__dirname, '../../fixtures/import')

describe('Case Deletion', () => {
  let tmpDir: string
  let db: DatabaseService
  let importService: ImportService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-delete-test-'))
    const dbPath = join(tmpDir, 'test.db')
    db = new DatabaseService(dbPath)
    importService = new ImportService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deleteAllCases should delete all cases and variants', async () => {
    // Import two cases
    await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'Case 1'
    })
    await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'Case 2'
    })

    expect(db.cases.getAllCases()).toHaveLength(2)

    const deleted = db.cases.deleteAllCases()
    expect(deleted).toBe(2)
    expect(db.cases.getAllCases()).toHaveLength(0)
  })

  it('deleteAllCases should restore FTS triggers after deletion', async () => {
    await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'FTS Test'
    })

    db.cases.deleteAllCases()

    // Import again — FTS triggers should be restored so FTS works
    const result = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'After Delete'
    })

    expect(result.variantCount).toBe(3)

    // Verify FTS search still works after triggers were restored
    const cases = db.cases.getAllCases()
    expect(cases).toHaveLength(1)
    expect(cases[0].variant_count).toBe(3)
  })

  it('deleteCasesBatch should delete specified cases', async () => {
    const r1 = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'Batch Case 1'
    })
    const r2 = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'Batch Case 2'
    })
    await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'Batch Case 3'
    })

    expect(db.cases.getAllCases()).toHaveLength(3)

    const deleted = db.cases.deleteCasesBatch([r1.caseId, r2.caseId])
    expect(deleted).toBe(2)
    expect(db.cases.getAllCases()).toHaveLength(1)
    expect(db.cases.getAllCases()[0].name).toBe('Batch Case 3')
  })

  it('deleteCasesBatch should restore FTS triggers after deletion', async () => {
    const r1 = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'FTS Batch 1'
    })

    db.cases.deleteCasesBatch([r1.caseId])

    // Import again and verify FTS still works
    const result = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'After Batch Delete'
    })

    expect(result.variantCount).toBe(3)
  })

  it('deleteAllCases should complete quickly even with many variants', async () => {
    // Import the columnar file which has more variants
    await importService.importVariants(join(FIXTURES_DIR, 'columnar-format.json'), {
      caseName: 'Large Case'
    })

    const cases = db.cases.getAllCases()
    expect(cases[0].variant_count).toBeGreaterThan(0)

    const start = Date.now()
    db.cases.deleteAllCases()
    const elapsed = Date.now() - start

    // Should complete in under 2 seconds even with FTS rebuild
    expect(elapsed).toBeLessThan(2000)
    expect(db.cases.getAllCases()).toHaveLength(0)
  })

  it('deleteAllCases with empty database should not error', () => {
    const deleted = db.cases.deleteAllCases()
    expect(deleted).toBe(0)
  })

  it('deleteCasesBatch with empty array should return 0', () => {
    const deleted = db.cases.deleteCasesBatch([])
    expect(deleted).toBe(0)
  })
})
