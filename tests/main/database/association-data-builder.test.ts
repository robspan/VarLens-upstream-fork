import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'

describe('AssociationDataBuilder', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    // Insert 6 cases
    const now = Date.now()
    for (let i = 1; i <= 6; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
    }

    // Cases 1-3: Group A (have BRCA1 variants)
    // Cases 4-6: Group B (no BRCA1 variants, some TP53 variants)

    // Case 1: BRCA1 het variant
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (1, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '0/1')"
    ).run()

    // Case 2: BRCA1 het variant (same)
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (2, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '0/1')"
    ).run()

    // Case 3: BRCA1 hom variant
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (3, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '1/1')"
    ).run()

    // Case 4: TP53 variant only
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (4, 'chr17', 7579472, 'C', 'T', 'TP53', 'missense_variant', 0.0001, 30.0, '0/1')"
    ).run()

    // Case 5: no qualifying variants
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (5, 'chr1', 100, 'A', 'T', NULL, NULL, 0.5, 5.0, '0/1')"
    ).run()
  })

  it('builds contingency data for two groups', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, [])

    expect(genes.length).toBeGreaterThan(0)

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()
    expect(brca1!.groupA_carrier_count).toBe(3) // all 3 cases have BRCA1
    expect(brca1!.groupB_carrier_count).toBe(0) // no group B cases have BRCA1
    expect(brca1!.groupA_non_carrier_count).toBe(0)
    expect(brca1!.groupB_non_carrier_count).toBe(3)
  })

  it('applies gnomad_af filter', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], { gnomad_af_max: 0.0005 }, [])

    // BRCA1 has gnomad_af=0.001, should be filtered out
    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeUndefined()

    // TP53 has gnomad_af=0.0001, should remain
    const tp53 = genes.find((g) => g.gene_symbol === 'TP53')
    expect(tp53).toBeDefined()
  })

  it('builds per-sample dosage arrays', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, [])

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')!
    expect(brca1.samples.length).toBe(6) // all 6 cases

    // Case 3 should have dosage 2 (hom)
    const case3Sample = brca1.samples.find((s) => s.group === 1 && s.dosages[0] === 2)
    expect(case3Sample).toBeDefined()
  })

  it('returns empty for no qualifying variants', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1], [2], { cadd_min: 100 }, [])
    expect(genes).toHaveLength(0)
  })
})
