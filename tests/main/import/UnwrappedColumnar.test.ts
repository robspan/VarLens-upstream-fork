/**
 * Tests for unwrapped columnar format import.
 *
 * The unwrapped format has { "data": [[...]], "header": [...] } at the top level,
 * without a case ID wrapper key. This is a variant of the VarVis export format.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { ImportService } from '../../../src/main/import/ImportService'
import { COLUMN_INDICES } from '../../../src/main/import/config/fieldMapping'

/**
 * Build a minimal unwrapped columnar JSON fixture.
 *
 * The header array must have entries at positions matching COLUMN_INDICES
 * for the FieldMapper to extract dictionaries. The data rows are arrays
 * where each index maps to a column.
 */
function buildUnwrappedFixture(variantCount = 3): Buffer {
  // Build header with Gene dictionary for field mapping
  const header: Record<string, unknown>[] = []
  // Fill header up to the maximum needed index
  const maxIndex = Math.max(...Object.values(COLUMN_INDICES))
  for (let i = 0; i <= maxIndex; i++) {
    header.push({ id: `field_${i}`, title: `Field ${i}`, dataDictionary: null, dataType: null })
  }
  // Set Gene header with dictionary
  header[COLUMN_INDICES.GENE] = {
    id: 'Gene',
    title: 'Gene',
    dataDictionary: { '100': 'BRCA1', '200': 'TP53' },
    dataType: null
  }
  // Set Transcript header
  header[COLUMN_INDICES.TRANSCRIPT] = {
    id: 'Transcript',
    title: 'Transcript',
    dataDictionary: { '10': 'NM_007294.4' },
    dataType: null
  }

  // Build data rows — each row is an array matching column indices
  const data: unknown[][] = []
  for (let i = 0; i < variantCount; i++) {
    const row: unknown[] = new Array(maxIndex + 1).fill(null)
    row[0] = 1000 + i // ID
    row[COLUMN_INDICES.SELECTED_TRANSCRIPT] = 0
    // Chr and Pos are multi-value (arrays of arrays): [[chr, pos], [chr, pos]]
    row[COLUMN_INDICES.CHR] = [['1', 1]]
    row[COLUMN_INDICES.POS] = [[100000 + i, 100000 + i]]
    row[COLUMN_INDICES.REF] = 'A'
    row[COLUMN_INDICES.ALT] = 'T'
    row[COLUMN_INDICES.QUAL] = 30 + i
    row[COLUMN_INDICES.GT_NUM] = '0/1'
    row[COLUMN_INDICES.FUNC] = [['missense_variant']]
    row[COLUMN_INDICES.IMPACT] = [[3]] // LOW
    row[COLUMN_INDICES.GENE] = [[100]] // Dict lookup -> BRCA1
    row[COLUMN_INDICES.TRANSCRIPT] = [[10]]
    row[COLUMN_INDICES.CDNA] = [['c.123A>T']]
    row[COLUMN_INDICES.AA_CHANGE] = [['p.Lys41Asn']]
    row[COLUMN_INDICES.CADD] = 15.5
    row[COLUMN_INDICES.CLINVAR] = null
    row[COLUMN_INDICES.GNOMAD_AF] = 0.001
    data.push(row)
  }

  const json = JSON.stringify({
    data,
    header,
    uniquePersonLabelSuffixes: {},
    uniqueCnvPersonLabelSuffixes: {},
    filterApplied: false,
    thresholdViolated: false,
    threshold: 2147483646
  })

  return gzipSync(Buffer.from(json))
}

/**
 * Build a wrapped columnar fixture (the traditional format) for comparison.
 */
function buildWrappedFixture(): Buffer {
  const maxIndex = Math.max(...Object.values(COLUMN_INDICES))
  const header: Record<string, unknown>[] = []
  for (let i = 0; i <= maxIndex; i++) {
    header.push({ id: `field_${i}`, title: `Field ${i}`, dataDictionary: null, dataType: null })
  }
  header[COLUMN_INDICES.GENE] = {
    id: 'Gene',
    title: 'Gene',
    dataDictionary: { '100': 'BRCA1' },
    dataType: null
  }

  const row: unknown[] = new Array(maxIndex + 1).fill(null)
  row[0] = 2000
  row[COLUMN_INDICES.SELECTED_TRANSCRIPT] = 0
  row[COLUMN_INDICES.CHR] = [['2', 2]]
  row[COLUMN_INDICES.POS] = [[200000, 200000]]
  row[COLUMN_INDICES.REF] = 'C'
  row[COLUMN_INDICES.ALT] = 'G'
  row[COLUMN_INDICES.QUAL] = 50
  row[COLUMN_INDICES.GT_NUM] = '1/1'
  row[COLUMN_INDICES.FUNC] = [['synonymous_variant']]
  row[COLUMN_INDICES.IMPACT] = [[3]]
  row[COLUMN_INDICES.GENE] = [[100]]

  const json = JSON.stringify({
    'CASE-001': { header, data: [row] }
  })

  return gzipSync(Buffer.from(json))
}

describe('Unwrapped Columnar Import', () => {
  let tmpDir: string
  let db: DatabaseService
  let importService: ImportService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-unwrapped-test-'))
    const dbPath = join(tmpDir, 'test.db')
    db = new DatabaseService(dbPath)
    importService = new ImportService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should detect and import unwrapped columnar format', async () => {
    const fixturePath = join(tmpDir, 'unwrapped.json.gz')
    writeFileSync(fixturePath, buildUnwrappedFixture(3))

    const result = await importService.importVariants(fixturePath, {
      caseName: 'Unwrapped Test'
    })

    expect(result.caseId).toBeGreaterThan(0)
    expect(result.variantCount).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('should resolve gene dictionaries from unwrapped header', async () => {
    const fixturePath = join(tmpDir, 'unwrapped-genes.json.gz')
    writeFileSync(fixturePath, buildUnwrappedFixture(1))

    const result = await importService.importVariants(fixturePath, {
      caseName: 'Unwrapped Gene Test'
    })

    // Query the imported variant
    const variants = db.variants.getVariants({ case_id: result.caseId }, 10)
    expect(variants.data.length).toBe(1)
    expect(variants.data[0].gene_symbol).toBe('BRCA1')
  })

  it('should still import wrapped columnar format correctly', async () => {
    const fixturePath = join(tmpDir, 'wrapped.json.gz')
    writeFileSync(fixturePath, buildWrappedFixture())

    const result = await importService.importVariants(fixturePath, {
      caseName: 'Wrapped Test'
    })

    expect(result.caseId).toBeGreaterThan(0)
    expect(result.variantCount).toBe(1)
  })
})
