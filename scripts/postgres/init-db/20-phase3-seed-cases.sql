INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at, genome_build)
VALUES
  (1, 'Oldest Case', '/data/oldest.vcf.gz', 1024, 0, 1714060800000, 'GRCh38'),
  (2, 'Middle Case', '/data/middle.vcf.gz', 2048, 21, 1714060801000, 'GRCh37'),
  (3, 'Newest Case', '/data/newest.vcf.gz', 4096, 42, 1714060802000, 'GRCh38');

INSERT INTO case_metadata (case_id, affected_status, sex, notes)
VALUES
  (1, 'affected', 'female', 'index case'),
  (2, 'unaffected', 'male', 'control case')
ON CONFLICT (case_id) DO UPDATE SET
  affected_status = EXCLUDED.affected_status,
  sex = EXCLUDED.sex,
  notes = EXCLUDED.notes;

INSERT INTO cohort_groups (id, name, description, created_at)
VALUES
  (1, 'rare disease', 'Rare disease cohort', 1714060803000),
  (2, 'controls', 'Control cohort', 1714060804000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO case_cohort_links (case_id, cohort_id)
VALUES (1, 1), (2, 2), (3, 1)
ON CONFLICT (case_id, cohort_id) DO NOTHING;

INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
VALUES
  (1, 'HP:0001250', 'Seizure', 1714060805000),
  (3, 'HP:0004322', 'Short stature', 1714060806000)
ON CONFLICT (case_id, hpo_id) DO UPDATE SET hpo_label = EXCLUDED.hpo_label;

INSERT INTO case_comments (id, case_id, category, content, created_at)
VALUES
  (1, 1, 'clinical', 'Reviewed for PostgreSQL parity smoke', 1714060807000)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  content = EXCLUDED.content;

INSERT INTO metric_definitions (id, name, value_type, unit, category, is_predefined, created_at)
VALUES
  (1, 'Age at analysis', 'numeric', 'years', 'clinical', 1, 1714060808000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  value_type = EXCLUDED.value_type,
  unit = EXCLUDED.unit,
  category = EXCLUDED.category,
  is_predefined = EXCLUDED.is_predefined;

INSERT INTO case_metrics (id, case_id, metric_id, numeric_value, created_at, updated_at)
VALUES
  (1, 1, 1, 42, 1714060809000, 1714060809000)
ON CONFLICT (id) DO UPDATE SET
  numeric_value = EXCLUDED.numeric_value,
  updated_at = EXCLUDED.updated_at;

SELECT setval(pg_get_serial_sequence('public.case_metadata', 'id'), COALESCE((SELECT MAX(id) FROM case_metadata), 1), true);
SELECT setval(pg_get_serial_sequence('public.cohort_groups', 'id'), COALESCE((SELECT MAX(id) FROM cohort_groups), 1), true);
SELECT setval(pg_get_serial_sequence('public.case_comments', 'id'), COALESCE((SELECT MAX(id) FROM case_comments), 1), true);
SELECT setval(pg_get_serial_sequence('public.metric_definitions', 'id'), COALESCE((SELECT MAX(id) FROM metric_definitions), 1), true);
SELECT setval(pg_get_serial_sequence('public.case_metrics', 'id'), COALESCE((SELECT MAX(id) FROM case_metrics), 1), true);
