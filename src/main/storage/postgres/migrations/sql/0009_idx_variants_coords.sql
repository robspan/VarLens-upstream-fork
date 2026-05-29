-- Sprint A PR-1 A1-prereq (risk-table mitigation): cover the global / case-less
-- (chr, pos, ref, alt) lookup path used by AnnotationRepository.getBatch and the
-- A1 batched IN-list JOINs. The existing variants index (case_id, chr, pos, ref, alt)
-- cannot serve a case-less lookup as a leading-column scan.
--
-- "__schema__" is the migration-runner template placeholder (see 0001_create_cases.sql).

CREATE INDEX IF NOT EXISTS variants_coords
  ON "__schema__"."variants" (chr, pos, ref, alt);
