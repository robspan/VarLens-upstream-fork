import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'

describe('CohortSummaryService', () => {
  let db: Database.Database
  let service: CohortSummaryService

  const insertCase = (name: string): number => {
    const result = db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, 0, ?)'
      )
      .run(name, `/test/${name}.json`, 1000, Date.now())
    return result.lastInsertRowid as number
  }

  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    opts: { gene_symbol?: string; gt_num?: string; consequence?: string } = {}
  ): void => {
    db.prepare(
      `
      INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, consequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      caseId,
      chr,
      pos,
      ref,
      alt,
      opts.gene_symbol ?? null,
      opts.gt_num ?? '0/1',
      opts.consequence ?? null
    )
  }

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    service = new CohortSummaryService(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('rebuild', () => {
    it('populates cohort_variant_summary from variants', () => {
      const c1 = insertCase('case1')
      const c2 = insertCase('case2')
      insertVariant(c1, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1', gt_num: '0/1' })
      insertVariant(c2, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1', gt_num: '1/1' })
      insertVariant(c1, '2', 200, 'G', 'C', { gene_symbol: 'TP53', gt_num: '0/1' })

      service.rebuild()

      const rows = db
        .prepare('SELECT * FROM cohort_variant_summary ORDER BY chr, pos')
        .all() as Array<{
        chr: string
        pos: number
        carrier_count: number
        het_count: number
        hom_count: number
        variant_key: string
      }>
      expect(rows).toHaveLength(2)
      // First variant: 2 carriers (1 het, 1 hom)
      expect(rows[0].carrier_count).toBe(2)
      expect(rows[0].het_count).toBe(1)
      expect(rows[0].hom_count).toBe(1)
      expect(rows[0].variant_key).toBe('1:100:A:T')
      // Second variant: 1 carrier (1 het)
      expect(rows[1].carrier_count).toBe(1)
      expect(rows[1].het_count).toBe(1)
    })

    it('populates gene_burden_summary', () => {
      const c1 = insertCase('case1')
      const c2 = insertCase('case2')
      insertVariant(c1, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1' })
      insertVariant(c2, '1', 100, 'A', 'T', { gene_symbol: 'BRCA1' })
      insertVariant(c1, '1', 200, 'G', 'C', { gene_symbol: 'BRCA1' })
      insertVariant(c1, '2', 300, 'A', 'G', { gene_symbol: 'TP53' })

      service.rebuild()

      const rows = db
        .prepare('SELECT * FROM gene_burden_summary ORDER BY affected_case_count DESC')
        .all() as Array<{
        gene_symbol: string
        variant_count: number
        unique_variant_count: number
        affected_case_count: number
      }>
      expect(rows).toHaveLength(2)
      expect(rows[0].gene_symbol).toBe('BRCA1')
      expect(rows[0].variant_count).toBe(3)
      expect(rows[0].unique_variant_count).toBe(2)
      expect(rows[0].affected_case_count).toBe(2)
      expect(rows[1].gene_symbol).toBe('TP53')
      expect(rows[1].affected_case_count).toBe(1)
    })

    it('clears stale flag after rebuild', () => {
      service.markStale()
      expect(service.getStatus().is_stale).toBe(true)
      service.rebuild()
      expect(service.getStatus().is_stale).toBe(false)
    })

    it('replaces old data on rebuild', () => {
      const c1 = insertCase('case1')
      insertVariant(c1, '1', 100, 'A', 'T')
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 1 })

      // Delete the variant, rebuild should clear
      db.prepare('DELETE FROM variants').run()
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 0 })
    })

    it('handles empty database', () => {
      service.rebuild()
      expect(db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get()).toEqual({ c: 0 })
      expect(db.prepare('SELECT COUNT(*) as c FROM gene_burden_summary').get()).toEqual({ c: 0 })
    })
  })

  describe('markStale / getStatus', () => {
    it('marks summary as stale', () => {
      service.markStale()
      const status = service.getStatus()
      expect(status.is_stale).toBe(true)
    })

    it('returns not stale when no meta rows exist', () => {
      const status = service.getStatus()
      expect(status.is_stale).toBe(false)
      expect(status.last_rebuilt_at).toBe(0)
    })
  })
})
