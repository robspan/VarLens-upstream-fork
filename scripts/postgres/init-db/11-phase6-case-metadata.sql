CREATE TABLE IF NOT EXISTS case_metadata (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  affected_status TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
  sex TEXT,
  age DOUBLE PRECISION,
  date_of_birth TEXT
);

CREATE TABLE IF NOT EXISTS cohort_groups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_cohort_links (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  cohort_id BIGINT NOT NULL REFERENCES cohort_groups(id) ON DELETE CASCADE,
  UNIQUE(case_id, cohort_id)
);

CREATE TABLE IF NOT EXISTS case_hpo_terms (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hpo_id TEXT NOT NULL,
  hpo_label TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(case_id, hpo_id)
);

CREATE TABLE IF NOT EXISTS case_data_info (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  import_file_name TEXT,
  import_file_type TEXT,
  platform TEXT,
  platform_details TEXT,
  af_filter TEXT,
  gene_list_filter TEXT,
  region_filter TEXT,
  quality_filter TEXT,
  data_notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  gene_list_id BIGINT,
  region_file_id BIGINT
);

CREATE TABLE IF NOT EXISTS case_external_ids (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  id_type TEXT NOT NULL,
  id_value TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(case_id, id_type)
);

CREATE TABLE IF NOT EXISTS case_comments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS metric_definitions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  value_type TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  is_predefined INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_metrics (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  metric_id BIGINT NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
  numeric_value DOUBLE PRECISION,
  text_value TEXT,
  date_value TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(case_id, metric_id)
);

CREATE INDEX IF NOT EXISTS idx_case_metadata_case_id ON case_metadata(case_id);
CREATE INDEX IF NOT EXISTS idx_case_cohort_links_case_id ON case_cohort_links(case_id);
CREATE INDEX IF NOT EXISTS idx_case_cohort_links_cohort_id ON case_cohort_links(cohort_id);
CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_case_id ON case_hpo_terms(case_id);
CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_hpo_id ON case_hpo_terms(hpo_id);
CREATE INDEX IF NOT EXISTS idx_case_data_info_case_id ON case_data_info(case_id);
CREATE INDEX IF NOT EXISTS idx_case_external_ids_case_id ON case_external_ids(case_id);
CREATE INDEX IF NOT EXISTS idx_case_comments_case_created ON case_comments(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_comments_case_category ON case_comments(case_id, category);
CREATE INDEX IF NOT EXISTS idx_case_metrics_case ON case_metrics(case_id);
CREATE INDEX IF NOT EXISTS idx_case_metrics_metric ON case_metrics(metric_id);
