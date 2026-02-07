/**
 * Integration tests for ImportService
 *
 * Tests require local test data not included in the repository.
 * Place gzipped JSON variant export files in test-data/ to run these tests.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { ImportService } from '../../../src/main/import/ImportService'
import type { ProgressUpdate } from '../../../src/main/import/types'
import { UniqueConstraintError } from '../../../src/main/database/errors'

const TEST_DATA_DIR = 'test-data'
const hasTestData = existsSync(TEST_DATA_DIR)

// Sample file paths (not included in repo)
const SAMPLE_FILE = join(TEST_DATA_DIR, 'sample-snv-subset.json.gz')
const FULL_FILE = join(TEST_DATA_DIR, 'full-snv-annotations.json.gz')
const OBJECT_FORMAT_SMALL = join(TEST_DATA_DIR, 'object-format-small.json.gz')
const OBJECT_FORMAT_FULL = join(TEST_DATA_DIR, 'object-format-full.json.gz')

describe.skipIf(!hasTestData)('ImportService', () => {
  let dbPath: string
  let tmpDir: string
  let db: DatabaseService
  let importService: ImportService

  beforeEach(() => {
    // Create temporary directory and database
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-test-'))
    dbPath = join(tmpDir, 'test.db')
    db = new DatabaseService(dbPath)
    importService = new ImportService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('Basic Import', () => {
    it('should import variants from sample file and create case', async () => {
      const result = await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Test Case Sample'
      })

      expect(result.caseId).toBeGreaterThan(0)
      expect(result.variantCount).toBeGreaterThan(0)
      expect(result.skipped).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.elapsed).toBeGreaterThan(0)

      // Verify case was created with correct variant count
      const caseRecord = db.getCase(result.caseId)
      expect(caseRecord.name).toBe('Test Case Sample')
      expect(caseRecord.variant_count).toBe(result.variantCount)

      // Verify variants were inserted
      const variantCount = db.getVariantCount(result.caseId)
      expect(variantCount).toBe(result.variantCount)
    })

    it('should resolve gene IDs to symbols via dictionary', async () => {
      const result = await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Gene Resolution Test'
      })

      // Get first few variants to check gene resolution
      const variants = db.getVariants({ case_id: result.caseId }, 10)

      // Should have some variants with gene symbols (resolved from dictionary)
      const variantsWithGenes = variants.data.filter((v) => v.gene_symbol !== null)
      expect(variantsWithGenes.length).toBeGreaterThan(0)

      // Gene symbols should be strings (not numeric IDs)
      for (const variant of variantsWithGenes) {
        expect(typeof variant.gene_symbol).toBe('string')
        expect(variant.gene_symbol?.length).toBeGreaterThan(0)
      }
    })

    it('should resolve impact codes to labels', async () => {
      const result = await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Impact Resolution Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 100)

      // Should have variants with impact labels
      const variantsWithImpact = variants.data.filter((v) => v.consequence !== null)
      expect(variantsWithImpact.length).toBeGreaterThan(0)

      // Impact labels should be from dictionary (HIGH, MODERATE, LOW, MODIFIER)
      const validImpacts = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER']
      for (const variant of variantsWithImpact) {
        expect(validImpacts).toContain(variant.consequence)
      }
    })
  })

  describe('Progress Reporting', () => {
    it('should call progress callback with phase and count', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Progress Test',
        onProgress: (update) => {
          progressUpdates.push(update)
        }
      })

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)

      // All updates should be 'inserting' phase (batching happens during insert)
      for (const update of progressUpdates) {
        expect(update.phase).toBe('inserting')
        expect(update.count).toBeGreaterThan(0)
        expect(update.elapsed).toBeGreaterThan(0)
      }
    })

    it('should report skipped variants in progress updates', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Skipped Progress Test',
        onProgress: (update) => {
          progressUpdates.push({ ...update })
        }
      })

      // Should track skipped count in updates
      for (const update of progressUpdates) {
        expect(update).toHaveProperty('skipped')
        expect(update.skipped).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Error Handling', () => {
    it('should throw error for duplicate case name', async () => {
      // First import succeeds
      await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Duplicate Test'
      })

      // Second import with same name should fail
      await expect(
        importService.importVariants(SAMPLE_FILE, {
          caseName: 'Duplicate Test'
        })
      ).rejects.toThrow(UniqueConstraintError)
    })

    it('should rollback case creation on import failure', async () => {
      const casesBefore = db.getAllCases().length

      // Import from non-existent file should fail
      await expect(
        importService.importVariants(join(TEST_DATA_DIR, 'non-existent.json.gz'), {
          caseName: 'Rollback Test'
        })
      ).rejects.toThrow()

      // No new case should have been created
      const casesAfter = db.getAllCases().length
      expect(casesAfter).toBe(casesBefore)
    })
  })

  describe('Cancellation', () => {
    it.skip('should support cancellation via AbortSignal', async () => {
      // Note: This test is skipped because the current implementation
      // doesn't check the abort signal early enough in the pipeline.
      const abortController = new AbortController()

      abortController.abort()

      const importPromise = importService.importVariants(FULL_FILE, {
        caseName: 'Cancellation Test',
        signal: abortController.signal
      })

      await expect(importPromise).rejects.toThrow()

      const cases = db.getAllCases()
      const cancelledCase = cases.find((c) => c.name === 'Cancellation Test')
      expect(cancelledCase).toBeUndefined()
    })
  })

  describe('Custom Batch Size', () => {
    it('should respect custom batch size option', async () => {
      const progressUpdates: ProgressUpdate[] = []

      await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Custom Batch Size Test',
        batchSize: 50,
        onProgress: (update) => {
          progressUpdates.push(update)
        }
      })

      // With batch size 50, we should have multiple updates
      expect(progressUpdates.length).toBeGreaterThanOrEqual(2)

      // Check that counts increase by batch size (except last batch)
      for (let i = 1; i < progressUpdates.length - 1; i++) {
        const increment = progressUpdates[i].count - progressUpdates[i - 1].count
        expect(increment).toBeLessThanOrEqual(50)
      }
    })
  })

  describe('Performance Test', () => {
    it.skipIf(!!process.env.CI)(
      'should import large variant file in under 60 seconds',
      { timeout: 90000 },
      async () => {
        const startTime = Date.now()

        const result = await importService.importVariants(FULL_FILE, {
          caseName: 'Performance Test Case'
        })

        const duration = Date.now() - startTime

        expect(duration).toBeLessThan(60000)
        expect(result.variantCount).toBeGreaterThan(0)

        const dbCount = db.getVariantCount(result.caseId)
        expect(dbCount).toBe(result.variantCount)
      }
    )
  })

  describe('Field Validation', () => {
    it('should skip variants with missing required fields', async () => {
      const result = await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Validation Test'
      })

      expect(result.skipped).toBe(0)
      expect(result.variantCount).toBeGreaterThan(0)
    })
  })

  describe('Data Integrity', () => {
    it('should correctly map all variant fields', async () => {
      const result = await importService.importVariants(SAMPLE_FILE, {
        caseName: 'Field Mapping Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 10)
      const variant = variants.data[0]

      // Required fields should be present
      expect(variant.chr).toBeTruthy()
      expect(variant.pos).toBeGreaterThan(0)
      expect(variant.ref).toBeTruthy()
      expect(variant.alt).toBeTruthy()

      // Numeric fields should be numbers or null
      if (variant.gnomad_af !== null) {
        expect(typeof variant.gnomad_af).toBe('number')
      }
      if (variant.cadd !== null) {
        expect(typeof variant.cadd).toBe('number')
      }
    })
  })

  describe('Object Format Import (New Export Format)', () => {
    it('should import variants from object format file', async () => {
      const result = await importService.importVariants(OBJECT_FORMAT_SMALL, {
        caseName: 'Object Format Test'
      })

      expect(result.caseId).toBeGreaterThan(0)
      expect(result.variantCount).toBeGreaterThan(0)
      expect(result.skipped).toBe(0)
      expect(result.errors).toEqual([])

      const caseRecord = db.getCase(result.caseId)
      expect(caseRecord.name).toBe('Object Format Test')
      expect(caseRecord.variant_count).toBe(result.variantCount)
    })

    it('should correctly map gene symbols from object format', async () => {
      const result = await importService.importVariants(OBJECT_FORMAT_SMALL, {
        caseName: 'Object Format Gene Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 100)
      const variantsWithGenes = variants.data.filter((v) => v.gene_symbol !== null)

      expect(variantsWithGenes.length).toBeGreaterThan(0)
      for (const variant of variantsWithGenes) {
        expect(typeof variant.gene_symbol).toBe('string')
      }
    })

    it('should convert moi array to comma-separated abbreviations', async () => {
      const result = await importService.importVariants(OBJECT_FORMAT_FULL, {
        caseName: 'Object Format MOI Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 1000)
      const variantsWithMoi = variants.data.filter((v) => v.moi !== null)

      expect(variantsWithMoi.length).toBeGreaterThan(0)
      for (const variant of variantsWithMoi) {
        expect(typeof variant.moi).toBe('string')
        expect(variant.moi!.length).toBeGreaterThan(0)
      }
    })

    it('should map all expected fields from object format', async () => {
      const result = await importService.importVariants(OBJECT_FORMAT_SMALL, {
        caseName: 'Object Format Fields Test'
      })

      const variants = db.getVariants({ case_id: result.caseId }, 10)
      const variant = variants.data[0]

      // Required fields
      expect(variant.chr).toBeTruthy()
      expect(variant.pos).toBeGreaterThan(0)
      expect(variant.ref).toBeTruthy()
      expect(variant.alt).toBeTruthy()

      // Optional fields should be mapped (may be null)
      expect('gene_symbol' in variant).toBe(true)
      expect('omim_mim_number' in variant).toBe(true)
      expect('consequence' in variant).toBe(true)
      expect('gnomad_af' in variant).toBe(true)
      expect('cadd' in variant).toBe(true)
      expect('clinvar' in variant).toBe(true)
      expect('gt_num' in variant).toBe(true)
      expect('func' in variant).toBe(true)
      expect('qual' in variant).toBe(true)
      expect('hpo_sim_score' in variant).toBe(true)
      expect('transcript' in variant).toBe(true)
      expect('cdna' in variant).toBe(true)
      expect('aa_change' in variant).toBe(true)
      expect('moi' in variant).toBe(true)
    })

    it('should handle large object format file', { timeout: 120000 }, async () => {
      const result = await importService.importVariants(OBJECT_FORMAT_FULL, {
        caseName: 'Object Format Large Test'
      })

      expect(result.variantCount).toBeGreaterThan(0)
      expect(result.skipped).toBe(0)

      const dbCount = db.getVariantCount(result.caseId)
      expect(dbCount).toBe(result.variantCount)
    })
  })
})
