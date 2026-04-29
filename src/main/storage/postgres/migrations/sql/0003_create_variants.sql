-- Phase 9.1: hash-keyed coordinate index requires pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "__schema__"."variants" (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  gene_symbol TEXT,
  omim_mim_number TEXT,
  consequence TEXT,
  gnomad_af DOUBLE PRECISION,
  cadd DOUBLE PRECISION,
  clinvar TEXT,
  gt_num TEXT,
  func TEXT,
  qual DOUBLE PRECISION,
  hpo_sim_score DOUBLE PRECISION,
  transcript TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_match TEXT,
  moi TEXT,
  gq DOUBLE PRECISION,
  dp BIGINT,
  ad_ref BIGINT,
  ad_alt BIGINT,
  ab DOUBLE PRECISION,
  filter TEXT,
  info_json TEXT,
  source_format TEXT,
  variant_type TEXT NOT NULL DEFAULT 'snv',
  end_pos BIGINT,
  sv_type TEXT,
  sv_length BIGINT,
  caller TEXT,
  coord_hash BYTEA GENERATED ALWAYS AS (
    digest(
      int4send(octet_length(chr::bytea)) || chr::bytea ||
      int8send(pos) ||
      int4send(octet_length(ref::bytea)) || ref::bytea ||
      int4send(octet_length(alt::bytea)) || alt::bytea,
      'sha256'
    )
  ) STORED
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_transcripts" (
  id BIGSERIAL PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  gene_symbol TEXT,
  consequence TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_sim_score DOUBLE PRECISION,
  moi TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0,
  is_mane_select INTEGER,
  is_canonical INTEGER,
  UNIQUE(variant_id, transcript_id)
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_frequency" (
  id BIGSERIAL PRIMARY KEY,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  case_count BIGINT NOT NULL DEFAULT 1,
  coord_hash BYTEA GENERATED ALWAYS AS (
    digest(
      int4send(octet_length(chr::bytea)) || chr::bytea ||
      int8send(pos) ||
      int4send(octet_length(ref::bytea)) || ref::bytea ||
      int4send(octet_length(alt::bytea)) || alt::bytea,
      'sha256'
    )
  ) STORED
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_sv" (
  variant_id BIGINT PRIMARY KEY REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  sv_is_precise INTEGER,
  cipos_left BIGINT,
  cipos_right BIGINT,
  ciend_left BIGINT,
  ciend_right BIGINT,
  support BIGINT,
  coverage TEXT,
  strand TEXT,
  stdev_len DOUBLE PRECISION,
  stdev_pos DOUBLE PRECISION,
  vaf DOUBLE PRECISION,
  dr BIGINT,
  dv BIGINT,
  pe_support BIGINT,
  sr_support BIGINT,
  event_id TEXT,
  mate_id TEXT
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_cnv" (
  variant_id BIGINT PRIMARY KEY REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  copy_number BIGINT,
  copy_number_quality BIGINT,
  homozygosity_ref DOUBLE PRECISION,
  homozygosity_alt DOUBLE PRECISION,
  sm DOUBLE PRECISION,
  bin_count BIGINT
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_str" (
  variant_id BIGINT PRIMARY KEY REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  repeat_id TEXT,
  variant_catalog_id TEXT,
  repeat_unit TEXT,
  display_repeat_unit TEXT,
  ref_copies DOUBLE PRECISION,
  alt_copies TEXT,
  repeat_length BIGINT,
  str_status TEXT,
  normal_max BIGINT,
  pathologic_min BIGINT,
  disease TEXT,
  inheritance_mode TEXT,
  source_display TEXT,
  rank_score TEXT,
  locus_coverage DOUBLE PRECISION,
  support_type TEXT,
  confidence_interval TEXT
);

CREATE INDEX IF NOT EXISTS idx_variants_case_type ON "__schema__"."variants"(case_id, variant_type);
CREATE INDEX IF NOT EXISTS idx_variants_case_gene ON "__schema__"."variants"(case_id, gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_case_pos ON "__schema__"."variants"(case_id, chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_case_consequence ON "__schema__"."variants"(case_id, consequence);
CREATE INDEX IF NOT EXISTS idx_variants_case_func ON "__schema__"."variants"(case_id, func);
-- Phase 9.1: hash-keyed cross-case coordinate index (replaces idx_variants_coord_case
-- which couldn't store entries for variants with ref+alt > ~2 KB).
CREATE INDEX IF NOT EXISTS idx_variants_coord_hash_case ON "__schema__"."variants"(coord_hash, case_id);
CREATE UNIQUE INDEX IF NOT EXISTS variant_frequency_coord_hash_uniq
  ON "__schema__"."variant_frequency"(coord_hash);
CREATE INDEX IF NOT EXISTS idx_vt_variant_id ON "__schema__"."variant_transcripts"(variant_id);
CREATE INDEX IF NOT EXISTS idx_vt_selected ON "__schema__"."variant_transcripts"(variant_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_cnv_copy_number ON "__schema__"."variant_cnv"(copy_number);
CREATE INDEX IF NOT EXISTS idx_str_repeat_id ON "__schema__"."variant_str"(repeat_id);
CREATE INDEX IF NOT EXISTS idx_str_disease ON "__schema__"."variant_str"(disease);
