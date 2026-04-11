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

describe('AssociationDataBuilder — Path 3 parity (shared helpers)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    const now = Date.now()
    // 6 cases: 1-3 = group A (BRCA1 carriers), 4-6 = group B
    for (let i = 1; i <= 6; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
    }

    // Group A: BRCA1 SNV carriers
    // NOTE: acmg_best + cohort_frequency live on cohort_variant_summary, NOT variants,
    // so they're not part of the insert. Burden scope passes them through buildBaseWhere
    // but the aliased reference (v.acmg_best) would fail at query time — callers should
    // only use the parity fields they know exist on the base table.
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar, gnomad_af, cadd, variant_type, gt_num) VALUES (?, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 'missense_variant', 'Pathogenic', 0.001, 25.0, 'snv', '0/1')"
      ).run(caseId)
    }
  })

  it('regression: existing 4-filter burden still works after refactor', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      {
        gnomad_af_max: 0.01,
        cadd_min: 20,
        consequences: ['missense_variant'],
        gene_list: ['BRCA1']
      },
      []
    )
    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()
    expect(brca1!.groupA_carrier_count).toBe(3)
    expect(brca1!.groupB_carrier_count).toBe(0)
    expect(brca1!.groupA_non_carrier_count).toBe(0)
    expect(brca1!.groupB_non_carrier_count).toBe(3)
  })

  it('accepts all new parity fields without error (cohort-summary-only fields are silently dropped)', () => {
    // acmg_classifications + max_internal_af map to columns (acmg_best,
    // cohort_frequency) that exist on cohort_variant_summary but NOT on the
    // base variants table. buildBaseWhere with scope='cohort-burden' silently
    // drops these fields, preserving type parity with Paths 1/2 while
    // avoiding runtime SQL errors against the variants table.
    const builder = new AssociationDataBuilder(db)
    expect(() =>
      builder.build(
        [1, 2, 3],
        [4, 5, 6],
        {
          clinvars: ['Pathogenic'],
          funcs: ['missense_variant'],
          acmg_classifications: ['Pathogenic'],
          max_internal_af: 0.1
        },
        []
      )
    ).not.toThrow()
  })

  it('silently drops cohort-summary-only fields for burden scope (no runtime error, no filter effect)', () => {
    // Setting acmg_classifications=['Benign'] must NOT filter BRCA1 out —
    // the field is dropped before reaching SQL. Only clinvars (which lives
    // on variants) should actually filter.
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      {
        acmg_classifications: ['Benign'], // dropped
        max_internal_af: 0.0001, // dropped
        clinvars: ['Pathogenic'] // applied
      },
      []
    )
    // BRCA1 should still match because the dropped fields don't filter it out
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()
  })

  it('applies clinvars + funcs filter through shared helper', () => {
    const builder = new AssociationDataBuilder(db)
    // Matching clinvar + func: BRCA1 should pass
    const genesMatching = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      { clinvars: ['Pathogenic'], funcs: ['missense_variant'] },
      []
    )
    expect(genesMatching.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()

    // Non-matching clinvar: BRCA1 should be filtered out
    const genesNonMatching = builder.build([1, 2, 3], [4, 5, 6], { clinvars: ['Benign'] }, [])
    expect(genesNonMatching.find((g) => g.gene_symbol === 'BRCA1')).toBeUndefined()
  })

  it('extension filter on cnv.copy_number narrows to CNV variants via JOIN', () => {
    // Insert CNV variant for cases 1, 2, 3 (group A)
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, variant_type, gt_num) VALUES (?, 'chr17', 43000000, 'N', '<CNV>', 'MYCN', 'cnv', '0/1')"
      ).run(caseId)
      const variantRow = db
        .prepare("SELECT id FROM variants WHERE case_id = ? AND chr = 'chr17' AND pos = 43000000")
        .get(caseId) as { id: number }
      db.prepare('INSERT INTO variant_cnv (variant_id, copy_number) VALUES (?, 5)').run(
        variantRow.id
      )
    }

    const builder = new AssociationDataBuilder(db)
    // Extension filter: copy_number >= 3 should return only CNVs.
    // Because buildExtensionJoinClauses prepends variant_type='cnv' narrowing,
    // the BRCA1 SNV is excluded and only MYCN CNVs remain.
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      { column_filters: { 'cnv.copy_number': { operator: '>=', value: 3 } } },
      []
    )
    const mycn = genes.find((g) => g.gene_symbol === 'MYCN')
    expect(mycn).toBeDefined()
    expect(mycn!.groupA_carrier_count).toBe(3)
    expect(mycn!.groupB_carrier_count).toBe(0)

    // BRCA1 (SNV) should NOT appear because single-type narrowing restricts to CNVs
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeUndefined()
  })

  it('no column_filters still works (no JOIN, clean SQL)', () => {
    const builder = new AssociationDataBuilder(db)
    expect(() => builder.build([1, 2, 3], [4, 5, 6], {}, [])).not.toThrow()
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, [])
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()
  })
})
