-- QW-16 (Phase 1 Pre-0.60 Hardening, audit Sch-03 F3, BP-05 §5)
-- Adds the two cheapest cohort-scan indexes that PostgreSQL is missing today.
-- The JSONB GIN on info_json is deferred to Sprint B per the audit, bundled
-- with the partitioning work.
--
-- "__schema__" is the template placeholder replaced by the migration runner
-- at execution time (see 0001_create_cases.sql and friends for the pattern).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- BRIN on (chr, pos): cohort scans are positional and the table is
-- naturally clustered by load order, which is the BRIN sweet spot.
CREATE INDEX IF NOT EXISTS variants_brin_chr_pos
  ON "__schema__"."variants" USING BRIN (chr, pos);

-- Trigram GIN on gene_symbol: substring/case-insensitive gene-name
-- lookups from the cohort filter UI go through this index.
CREATE INDEX IF NOT EXISTS variants_gene_trgm
  ON "__schema__"."variants" USING GIN (gene_symbol gin_trgm_ops);
