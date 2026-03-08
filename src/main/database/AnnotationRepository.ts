import { BaseRepository } from './BaseRepository'
import type { VariantAnnotation, CaseVariantAnnotation } from './types'

export class AnnotationRepository extends BaseRepository {
  getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): VariantAnnotation | null {
    const result = this.stmt(
      'SELECT * FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get(chr, pos, ref, alt) as VariantAnnotation | undefined
    return result ?? null
  }

  upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: Partial<
      Pick<
        VariantAnnotation,
        'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): VariantAnnotation {
    return this.runTransaction(() => {
      const now = Date.now()
      const result = this.stmt(
        `
        INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
          global_comment = IFNULL(?, global_comment),
          starred = IFNULL(?, starred),
          acmg_classification = IFNULL(?, acmg_classification),
          acmg_evidence = IFNULL(?, acmg_evidence),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        chr,
        pos,
        ref,
        alt,
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        updates.global_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as VariantAnnotation
      return result
    })
  }

  deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): void {
    this.stmt(
      'DELETE FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).run(chr, pos, ref, alt)
  }

  getPerCaseAnnotation(caseId: number, variantId: number): CaseVariantAnnotation | null {
    const result = this.stmt(
      'SELECT * FROM case_variant_annotations WHERE case_id = ? AND variant_id = ?'
    ).get(caseId, variantId) as CaseVariantAnnotation | undefined
    return result ?? null
  }

  upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: Partial<
      Pick<
        CaseVariantAnnotation,
        'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
      >
    >
  ): CaseVariantAnnotation {
    return this.runTransaction(() => {
      const now = Date.now()
      const result = this.stmt(
        `
        INSERT INTO case_variant_annotations (case_id, variant_id, per_case_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
        VALUES (?, ?, ?, IFNULL(?, 0), ?, ?, ?, ?)
        ON CONFLICT(case_id, variant_id) DO UPDATE SET
          per_case_comment = IFNULL(?, per_case_comment),
          starred = IFNULL(?, starred),
          acmg_classification = IFNULL(?, acmg_classification),
          acmg_evidence = IFNULL(?, acmg_evidence),
          updated_at = excluded.updated_at
        RETURNING *
      `
      ).get(
        caseId,
        variantId,
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null,
        now,
        now,
        updates.per_case_comment ?? null,
        updates.starred !== undefined ? (updates.starred ? 1 : 0) : null,
        updates.acmg_classification ?? null,
        updates.acmg_evidence ?? null
      ) as CaseVariantAnnotation
      return result
    })
  }

  deletePerCaseAnnotation(caseId: number, variantId: number): void {
    this.stmt('DELETE FROM case_variant_annotations WHERE case_id = ? AND variant_id = ?').run(
      caseId,
      variantId
    )
  }

  getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null } {
    const variant = this.stmt(
      'SELECT id FROM variants WHERE case_id = ? AND chr = ? AND pos = ? AND ref = ? AND alt = ?'
    ).get(caseId, chr, pos, ref, alt) as { id: number } | undefined

    const variantId = variant?.id
    const global = this.getGlobalAnnotation(chr, pos, ref, alt)
    const perCase = variantId !== undefined ? this.getPerCaseAnnotation(caseId, variantId) : null
    return { global, perCase }
  }
}
