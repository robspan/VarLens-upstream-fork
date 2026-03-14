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

  it('deleteAllCases should restore FTS triggers and FTS search should work', async () => {
    await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'FTS Test'
    })

    db.cases.deleteAllCases()

    // Import again — FTS triggers should be restored so new variants are indexed
    const result = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'After Delete'
    })

    expect(result.variantCount).toBe(3)

    // Verify FTS search actually works (queries variants_fts)
    const ftsResults = db.variants.searchVariants(result.caseId, 'BRCA1')
    expect(ftsResults.length).toBeGreaterThan(0)
    expect(ftsResults[0].gene_symbol).toBe('BRCA1')
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

  it('deleteCasesBatch should restore FTS triggers and FTS search should work', async () => {
    // Import enough cases to trigger the FTS optimization (> 5)
    const ids: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
        caseName: `FTS Batch ${i}`
      })
      ids.push(r.caseId)
    }

    db.cases.deleteCasesBatch(ids)

    // Import again and verify FTS search works
    const result = await importService.importVariants(join(FIXTURES_DIR, 'simple-format.json'), {
      caseName: 'After Batch Delete'
    })

    expect(result.variantCount).toBe(3)
    const ftsResults = db.variants.searchVariants(result.caseId, 'CFTR')
    expect(ftsResults.length).toBeGreaterThan(0)
    expect(ftsResults[0].gene_symbol).toBe('CFTR')
  })

  it('deleteAllCases should delete all variants from columnar import', async () => {
    await importService.importVariants(join(FIXTURES_DIR, 'columnar-format.json'), {
      caseName: 'Large Case'
    })

    const cases = db.cases.getAllCases()
    expect(cases[0].variant_count).toBeGreaterThan(0)

    db.cases.deleteAllCases()
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
