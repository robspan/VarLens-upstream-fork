/**
 * VEP response types re-exported for renderer consumption.
 *
 * The canonical Zod schemas live in `src/main/services/api/schemas/vep-response.ts`.
 * Renderer code must NOT import from `main/` directly (ESLint `no-restricted-imports`).
 * Instead, import these lightweight type aliases from `@shared/types/vep`.
 */

/**
 * VEP transcript consequence — annotation for a single transcript affected by a variant.
 */
export interface VepTranscriptConsequence {
  transcript_id: string
  gene_symbol?: string
  consequence_terms: string[]
  impact?: 'HIGH' | 'MODERATE' | 'LOW' | 'MODIFIER'
  mane_select?: string
  canonical?: number
  biotype?: string
  source?: string
  cadd_phred?: number
  cadd_raw?: number
  revel_score?: number
  sift_score?: number
  sift_prediction?: string
  polyphen_score?: number
  polyphen_prediction?: string
  spliceai_pred_ds_ag?: number
  spliceai_pred_ds_al?: number
  spliceai_pred_ds_dg?: number
  spliceai_pred_ds_dl?: number
  gnomad_af?: number
  gnomad_exomes_af?: number
  gnomad_genomes_af?: number
}

/**
 * VEP colocated variant — known variant at the same genomic position (e.g. dbSNP rsID).
 */
export interface VepColocatedVariant {
  id?: string
  frequencies?: Record<string, Record<string, number>>
  clin_sig?: string[]
}

/**
 * VEP response item — annotation result for a single variant query.
 */
export interface VepResponseItem {
  id?: string
  input: string
  transcript_consequences?: VepTranscriptConsequence[]
  colocated_variants?: VepColocatedVariant[]
  most_severe_consequence?: string
}

/**
 * VEP response — array of items (one per input variant).
 */
export type VepResponse = VepResponseItem[]
