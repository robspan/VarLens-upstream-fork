// ---------------------------------------------------------------------------
// Shared column constants and helpers for Postgres import repositories.
//
// Both PostgresJsonImportRepository and PostgresVcfImportRepository must write
// to the same schema, so the column lists, recordset-type maps, and id helpers
// live here as the single source of truth.
//
// search_document is intentionally excluded from VARIANT_BASE_COLUMNS: the
// Phase 7 trigger `variants_search_document_tg` populates it on BEFORE INSERT
// (see scripts/postgres/init-db/12-phase7-variants.sql).
// ---------------------------------------------------------------------------

import {
  encodeText,
  encodeInteger,
  encodeFloat,
  type CopyColumnEncoder
} from './copy-text-encoder'

export const VARIANT_BASE_COLUMNS = [
  'case_id',
  'chr',
  'pos',
  'ref',
  'alt',
  'gene_symbol',
  'omim_mim_number',
  'consequence',
  'gnomad_af',
  'cadd',
  'clinvar',
  'gt_num',
  'func',
  'qual',
  'hpo_sim_score',
  'transcript',
  'cdna',
  'aa_change',
  'moi',
  'gq',
  'dp',
  'ad_ref',
  'ad_alt',
  'ab',
  'filter',
  'info_json',
  'source_format',
  'variant_type',
  'end_pos',
  'sv_type',
  'sv_length',
  'caller'
] as const

// jsonb_to_recordset requires a record type definition. We align it with the
// variants base columns (excluding case_id which we set from the outer scope).
export const VARIANT_BATCH_RECORDSET_TYPES: Record<string, string> = {
  chr: 'text',
  pos: 'bigint',
  ref: 'text',
  alt: 'text',
  gene_symbol: 'text',
  omim_mim_number: 'text',
  consequence: 'text',
  gnomad_af: 'double precision',
  cadd: 'double precision',
  clinvar: 'text',
  gt_num: 'text',
  func: 'text',
  qual: 'double precision',
  hpo_sim_score: 'double precision',
  transcript: 'text',
  cdna: 'text',
  aa_change: 'text',
  moi: 'text',
  gq: 'double precision',
  dp: 'bigint',
  ad_ref: 'bigint',
  ad_alt: 'bigint',
  ab: 'double precision',
  filter: 'text',
  info_json: 'text',
  source_format: 'text',
  variant_type: 'text',
  end_pos: 'bigint',
  sv_type: 'text',
  sv_length: 'bigint',
  caller: 'text'
}

export const VARIANT_TRANSCRIPT_COLUMNS = [
  'variant_id',
  'transcript_id',
  'gene_symbol',
  'consequence',
  'cdna',
  'aa_change',
  'hpo_sim_score',
  'moi',
  'is_selected',
  'is_mane_select',
  'is_canonical'
] as const

export const VARIANT_SV_COLUMNS = [
  'variant_id',
  'sv_is_precise',
  'cipos_left',
  'cipos_right',
  'ciend_left',
  'ciend_right',
  'support',
  'coverage',
  'strand',
  'stdev_len',
  'stdev_pos',
  'vaf',
  'dr',
  'dv',
  'pe_support',
  'sr_support',
  'event_id',
  'mate_id'
] as const

export const VARIANT_CNV_COLUMNS = [
  'variant_id',
  'copy_number',
  'copy_number_quality',
  'homozygosity_ref',
  'homozygosity_alt',
  'sm',
  'bin_count'
] as const

export const VARIANT_STR_COLUMNS = [
  'variant_id',
  'repeat_id',
  'variant_catalog_id',
  'repeat_unit',
  'display_repeat_unit',
  'ref_copies',
  'alt_copies',
  'repeat_length',
  'str_status',
  'normal_max',
  'pathologic_min',
  'disease',
  'inheritance_mode',
  'source_display',
  'rank_score',
  'locus_coverage',
  'support_type',
  'confidence_interval'
] as const

// ---------------------------------------------------------------------------
// COPY FROM STDIN column lists (Phase 16).
//
// VARIANT_COPY_COLUMNS prepends `id` because the COPY path supplies pre-allocated
// ids (via nextval on variants_id_seq) instead of relying on BIGSERIAL defaults —
// this is what lets the extension tables' COPY rows reference the correct
// variant_id without a per-row RETURNING round-trip. VARIANT_BASE_COLUMNS already
// starts with `case_id`, so we do NOT include `case_id` again.
//
// The four extension-table COPY column lists are intentional aliases of the
// existing `_COLUMNS` constants — they already begin with `variant_id` and
// already exclude `search_document` (which is populated by BEFORE-INSERT
// triggers; see compute_*_search_document migrations from Task 2).
// ---------------------------------------------------------------------------

export const VARIANT_COPY_COLUMNS = ['id', ...VARIANT_BASE_COLUMNS] as const
export const VARIANT_TRANSCRIPT_COPY_COLUMNS = VARIANT_TRANSCRIPT_COLUMNS
export const VARIANT_SV_COPY_COLUMNS = VARIANT_SV_COLUMNS
export const VARIANT_CNV_COPY_COLUMNS = VARIANT_CNV_COLUMNS
export const VARIANT_STR_COPY_COLUMNS = VARIANT_STR_COLUMNS

// ---------------------------------------------------------------------------
// Per-column encoder map (Phase 16).
//
// Covers every column appearing in any of the five COPY column lists above.
// Source of truth for column → Postgres type:
// scripts/postgres/init-db/12-phase7-variants.sql.
//
// Mapping rules:
//   TEXT                                  → encodeText
//   BIGINT / BIGSERIAL / INTEGER          → encodeInteger
//   DOUBLE PRECISION                      → encodeFloat
//
// Note: `is_selected`, `is_mane_select`, `is_canonical`, `sv_is_precise` are
// stored as INTEGER (0/1) in the schema, NOT BOOLEAN. They use encodeInteger;
// using encodeBoolean would throw because the encoder is strict.
//
// Where a column name appears in multiple tables (e.g. `gene_symbol`,
// `consequence`, `cdna`, `aa_change`, `hpo_sim_score`, `moi`, `variant_id`),
// the type is identical across tables, so a single shared entry is correct.
// ---------------------------------------------------------------------------

export const VARIANT_COLUMN_ENCODERS: Record<string, CopyColumnEncoder> = {
  // variants
  id: encodeInteger,
  case_id: encodeInteger,
  chr: encodeText,
  pos: encodeInteger,
  ref: encodeText,
  alt: encodeText,
  gene_symbol: encodeText,
  omim_mim_number: encodeText,
  consequence: encodeText,
  gnomad_af: encodeFloat,
  cadd: encodeFloat,
  clinvar: encodeText,
  gt_num: encodeText,
  func: encodeText,
  qual: encodeFloat,
  hpo_sim_score: encodeFloat,
  transcript: encodeText,
  cdna: encodeText,
  aa_change: encodeText,
  moi: encodeText,
  gq: encodeFloat,
  dp: encodeInteger,
  ad_ref: encodeInteger,
  ad_alt: encodeInteger,
  ab: encodeFloat,
  filter: encodeText,
  info_json: encodeText,
  source_format: encodeText,
  variant_type: encodeText,
  end_pos: encodeInteger,
  sv_type: encodeText,
  sv_length: encodeInteger,
  caller: encodeText,
  // variant_transcripts
  variant_id: encodeInteger,
  transcript_id: encodeText,
  is_selected: encodeInteger,
  is_mane_select: encodeInteger,
  is_canonical: encodeInteger,
  // variant_sv
  sv_is_precise: encodeInteger,
  cipos_left: encodeInteger,
  cipos_right: encodeInteger,
  ciend_left: encodeInteger,
  ciend_right: encodeInteger,
  support: encodeInteger,
  coverage: encodeText,
  strand: encodeText,
  stdev_len: encodeFloat,
  stdev_pos: encodeFloat,
  vaf: encodeFloat,
  dr: encodeInteger,
  dv: encodeInteger,
  pe_support: encodeInteger,
  sr_support: encodeInteger,
  event_id: encodeText,
  mate_id: encodeText,
  // variant_cnv
  copy_number: encodeInteger,
  copy_number_quality: encodeInteger,
  homozygosity_ref: encodeFloat,
  homozygosity_alt: encodeFloat,
  sm: encodeFloat,
  bin_count: encodeInteger,
  // variant_str
  repeat_id: encodeText,
  variant_catalog_id: encodeText,
  repeat_unit: encodeText,
  display_repeat_unit: encodeText,
  ref_copies: encodeFloat,
  alt_copies: encodeText,
  repeat_length: encodeInteger,
  str_status: encodeText,
  normal_max: encodeInteger,
  pathologic_min: encodeInteger,
  disease: encodeText,
  inheritance_mode: encodeText,
  source_display: encodeText,
  rank_score: encodeText,
  locus_coverage: encodeFloat,
  support_type: encodeText,
  confidence_interval: encodeText
}

// ---------------------------------------------------------------------------
// Extension-table recordset type maps (used by insertExtensionBatch callers).
// ---------------------------------------------------------------------------

export const TRANSCRIPT_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  transcript_id: 'text',
  gene_symbol: 'text',
  consequence: 'text',
  cdna: 'text',
  aa_change: 'text',
  hpo_sim_score: 'double precision',
  moi: 'text',
  is_selected: 'integer',
  is_mane_select: 'integer',
  is_canonical: 'integer'
}

export const SV_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  sv_is_precise: 'integer',
  cipos_left: 'bigint',
  cipos_right: 'bigint',
  ciend_left: 'bigint',
  ciend_right: 'bigint',
  support: 'bigint',
  coverage: 'text',
  strand: 'text',
  stdev_len: 'double precision',
  stdev_pos: 'double precision',
  vaf: 'double precision',
  dr: 'bigint',
  dv: 'bigint',
  pe_support: 'bigint',
  sr_support: 'bigint',
  event_id: 'text',
  mate_id: 'text'
}

export const CNV_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  copy_number: 'bigint',
  copy_number_quality: 'bigint',
  homozygosity_ref: 'double precision',
  homozygosity_alt: 'double precision',
  sm: 'double precision',
  bin_count: 'bigint'
}

export const STR_RECORDSET_TYPES: Record<string, string> = {
  variant_id: 'bigint',
  repeat_id: 'text',
  variant_catalog_id: 'text',
  repeat_unit: 'text',
  display_repeat_unit: 'text',
  ref_copies: 'double precision',
  alt_copies: 'text',
  repeat_length: 'bigint',
  str_status: 'text',
  normal_max: 'bigint',
  pathologic_min: 'bigint',
  disease: 'text',
  inheritance_mode: 'text',
  source_display: 'text',
  rank_score: 'text',
  locus_coverage: 'double precision',
  support_type: 'text',
  confidence_interval: 'text'
}

// ---------------------------------------------------------------------------
// Shared helper: convert a pg RETURNING id value to a JS number.
// Throws if the value is not a finite number or a numeric string —
// a NaN would silently poison every FK that depends on it.
// ---------------------------------------------------------------------------

export function toNumericId(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
  }
  throw new Error(`Expected numeric id, received: ${String(value)}`)
}
