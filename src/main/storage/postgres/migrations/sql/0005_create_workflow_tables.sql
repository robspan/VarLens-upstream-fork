CREATE TABLE IF NOT EXISTS "__schema__"."variant_annotations" (
  id BIGSERIAL PRIMARY KEY,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  global_comment TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  acmg_classification TEXT,
  acmg_evidence TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(chr, pos, ref, alt)
);

CREATE TABLE IF NOT EXISTS "__schema__"."case_variant_annotations" (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  variant_id BIGINT NOT NULL REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  per_case_comment TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  acmg_classification TEXT,
  acmg_evidence TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(case_id, variant_id)
);

CREATE TABLE IF NOT EXISTS "__schema__"."tags" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "__schema__"."variant_tags" (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  variant_id BIGINT NOT NULL REFERENCES "__schema__"."variants"(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES "__schema__"."tags"(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  UNIQUE(case_id, variant_id, tag_id)
);

CREATE TABLE IF NOT EXISTS "__schema__"."panels" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  source_metadata TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "__schema__"."panel_genes" (
  id BIGSERIAL PRIMARY KEY,
  panel_id BIGINT NOT NULL REFERENCES "__schema__"."panels"(id) ON DELETE CASCADE,
  hgnc_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  UNIQUE(panel_id, hgnc_id)
);

CREATE TABLE IF NOT EXISTS "__schema__"."case_active_panels" (
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  panel_id BIGINT NOT NULL REFERENCES "__schema__"."panels"(id) ON DELETE CASCADE,
  padding_bp BIGINT NOT NULL DEFAULT 5000,
  activated_at BIGINT NOT NULL,
  PRIMARY KEY (case_id, panel_id)
);

CREATE TABLE IF NOT EXISTS "__schema__"."gene_lists" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "__schema__"."gene_list_items" (
  id BIGSERIAL PRIMARY KEY,
  gene_list_id BIGINT NOT NULL REFERENCES "__schema__"."gene_lists"(id) ON DELETE CASCADE,
  gene_symbol TEXT NOT NULL,
  UNIQUE(gene_list_id, gene_symbol)
);

CREATE TABLE IF NOT EXISTS "__schema__"."region_files" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  region_count BIGINT NOT NULL DEFAULT 0,
  total_bases BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "__schema__"."region_file_entries" (
  id BIGSERIAL PRIMARY KEY,
  region_file_id BIGINT NOT NULL REFERENCES "__schema__"."region_files"(id) ON DELETE CASCADE,
  chr TEXT NOT NULL,
  start_pos BIGINT NOT NULL,
  end_pos BIGINT NOT NULL,
  label TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'case_data_info_gene_list_id_fkey'
      AND conrelid = '"__schema__"."case_data_info"'::regclass
  ) THEN
    ALTER TABLE "__schema__"."case_data_info"
      ADD CONSTRAINT case_data_info_gene_list_id_fkey
      FOREIGN KEY (gene_list_id)
      REFERENCES "__schema__"."gene_lists"(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'case_data_info_region_file_id_fkey'
      AND conrelid = '"__schema__"."case_data_info"'::regclass
  ) THEN
    ALTER TABLE "__schema__"."case_data_info"
      ADD CONSTRAINT case_data_info_region_file_id_fkey
      FOREIGN KEY (region_file_id)
      REFERENCES "__schema__"."region_files"(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "__schema__"."filter_presets" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  filter_json TEXT NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL DEFAULT 'filter' CHECK (kind IN ('filter', 'shortlist')),
  is_built_in INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  sort_order BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS "__schema__"."analysis_groups" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  group_type TEXT NOT NULL DEFAULT 'family' CHECK (group_type IN ('family', 'tumor_normal')),
  description TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS "__schema__"."analysis_group_members" (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES "__schema__"."analysis_groups"(id) ON DELETE CASCADE,
  case_id BIGINT NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN (
    'proband', 'father', 'mother', 'sibling', 'partner', 'other',
    'tumor', 'normal'
  )),
  affected_status TEXT NOT NULL DEFAULT 'unknown' CHECK(affected_status IN ('affected', 'unaffected', 'unknown')),
  individual_id TEXT,
  UNIQUE(group_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_annotations_coords ON "__schema__"."variant_annotations"(chr, pos, ref, alt);
CREATE INDEX IF NOT EXISTS idx_variant_annotations_starred ON "__schema__"."variant_annotations"(starred) WHERE starred = 1;
CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_case ON "__schema__"."case_variant_annotations"(case_id);
CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_variant ON "__schema__"."case_variant_annotations"(variant_id);
CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_starred ON "__schema__"."case_variant_annotations"(starred) WHERE starred = 1;
CREATE INDEX IF NOT EXISTS idx_variant_tags_case ON "__schema__"."variant_tags"(case_id);
CREATE INDEX IF NOT EXISTS idx_variant_tags_variant ON "__schema__"."variant_tags"(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_tags_tag ON "__schema__"."variant_tags"(tag_id);
CREATE INDEX IF NOT EXISTS idx_variant_tags_case_tag ON "__schema__"."variant_tags"(case_id, tag_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_panel_genes_panel ON "__schema__"."panel_genes"(panel_id);
CREATE INDEX IF NOT EXISTS idx_case_active_panels_case ON "__schema__"."case_active_panels"(case_id);
CREATE INDEX IF NOT EXISTS idx_gene_list_items_list ON "__schema__"."gene_list_items"(gene_list_id);
CREATE INDEX IF NOT EXISTS idx_region_file_entries_file ON "__schema__"."region_file_entries"(region_file_id);
CREATE INDEX IF NOT EXISTS idx_filter_presets_kind ON "__schema__"."filter_presets"(kind);
CREATE INDEX IF NOT EXISTS idx_agm_group ON "__schema__"."analysis_group_members"(group_id);
CREATE INDEX IF NOT EXISTS idx_agm_case ON "__schema__"."analysis_group_members"(case_id);
