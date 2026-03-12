/**
 * Annotation scope for Case View toggle.
 * - 'case': per-case annotations only (default)
 * - 'all': per-case OR global annotations (union for filters, global for actions)
 */
export type AnnotationScope = 'case' | 'all'

/**
 * Minimal variant identity shared between Variant and CohortVariant.
 * Used by unified AnnotationDialogs to avoid coupling to either full type.
 */
export interface AnnotationTarget {
  chr: string
  pos: number
  ref: string
  alt: string
  /** Present in Variant (case view), absent in CohortVariant (cohort view) */
  id?: number
  gene_symbol?: string | null
  /** Optional fields for ACMG evidence dialog display */
  cdna?: string | null
  aa_change?: string | null
  gnomad_af?: number | null
  /** CADD score — named `cadd` in Variant, `cadd_phred` in CohortVariant */
  cadd?: number | null
  cadd_phred?: number | null
  clinvar?: string | null
}
