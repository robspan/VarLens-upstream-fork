/**
 * TranscriptAnnotation — full row from variant_transcripts table.
 * Returned by getVariantTranscripts() to the renderer.
 */
export interface TranscriptAnnotation {
  id: number
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: boolean
  is_mane_select: boolean | null
  is_canonical: boolean | null
}

/**
 * TranscriptInsertRow — data for inserting into variant_transcripts.
 * Used by the import pipeline (no id or variant_id yet).
 */
export interface TranscriptInsertRow {
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: number // 0 or 1 (SQLite integer boolean)
}
