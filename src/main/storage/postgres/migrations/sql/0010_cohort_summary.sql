-- Sprint A PR-3 C1 — materialised cohort summary + per-case column metas +
-- singleton staleness state. Mirrors SQLite v25 schema (src/main/database/
-- migrations.ts around v25) and the index set at :1545.

-- cohort_variant_summary: deduped (chr, pos, ref, alt, variant_type,
-- genome_build) aggregate of the variants table. Used by C4 read-side switch.
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_variant_summary" (
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  end_pos INTEGER NULL,                    -- Pass-8 #5: required for C4 panel-interval predicate
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  variant_type TEXT NOT NULL DEFAULT 'snv',
  genome_build TEXT NOT NULL DEFAULT 'GRCh38',
  gene_symbol TEXT,
  cdna TEXT,
  aa_change TEXT,
  consequence TEXT,
  func TEXT,
  clinvar TEXT,
  gnomad_af DOUBLE PRECISION,
  cadd DOUBLE PRECISION,
  transcript TEXT,
  omim_mim_number TEXT,
  carrier_count INTEGER NOT NULL DEFAULT 0,
  het_count INTEGER NOT NULL DEFAULT 0,
  hom_count INTEGER NOT NULL DEFAULT 0,
  variant_key TEXT,
  has_star BOOLEAN NOT NULL DEFAULT false,
  has_comment BOOLEAN NOT NULL DEFAULT false,
  acmg_best TEXT NULL,
  cohort_frequency DOUBLE PRECISION,
  PRIMARY KEY (chr, pos, ref, alt, variant_type, genome_build)
);

-- Index set mirrors SQLite v25 exactly (Pass-3 LOW #7). No plain (gene_symbol)
-- or (consequence) singletons — SQLite retired those in v25 in favour of the
-- covering pairs below.
CREATE INDEX IF NOT EXISTS idx_cvs_carrier
  ON "__schema__"."cohort_variant_summary" (carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_filters
  ON "__schema__"."cohort_variant_summary" (gnomad_af, cadd);
CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq
  ON "__schema__"."cohort_variant_summary" (cohort_frequency);
CREATE INDEX IF NOT EXISTS idx_cvs_covering_common
  ON "__schema__"."cohort_variant_summary" (consequence, gnomad_af, carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_gene_covering
  ON "__schema__"."cohort_variant_summary" (gene_symbol, carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_type_build
  ON "__schema__"."cohort_variant_summary" (variant_type, genome_build);

-- cohort_column_meta: per-case filter metadata cache. Powers CaseView's
-- FilterToolbar via getFilterOptions(caseId) → getColumnMeta (C4).
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_column_meta" (
  case_id INTEGER NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  min_value JSONB,
  max_value JSONB,
  distinct_count INTEGER NOT NULL DEFAULT 0,
  distinct_values JSONB NULL,
  PRIMARY KEY (case_id, column_name)
);

-- cohort_summary_state: singleton row with staleness flags + timestamps
-- (Pass-7 MED #4 columns: stale_reason, stale_at).
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_summary_state" (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_stale BOOLEAN NOT NULL DEFAULT false,
  stale_reason TEXT NULL,
  stale_at TIMESTAMPTZ NULL,
  last_rebuilt_at TIMESTAMPTZ NULL,
  last_incremental_at TIMESTAMPTZ NULL
);

-- Conditional seed (Pass-9 #5): fresh schemas → is_stale=false (no variants
-- → no work). Existing-data schemas → is_stale=true with explicit reason so
-- the next cohort read triggers rebuild.
INSERT INTO "__schema__"."cohort_summary_state" (id, is_stale, stale_reason, stale_at)
SELECT 1,
       EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1),
       CASE WHEN EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1)
            THEN 'migration_initial_existing_data'
            ELSE NULL END,
       CASE WHEN EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1)
            THEN now()
            ELSE NULL END
ON CONFLICT (id) DO NOTHING;
