-- scripts/postgres/init-db/16-phase16-search-document-fns.sql
-- Phase 16.1: replace the BEFORE INSERT/UPDATE FTS triggers with STORED
-- generated columns that compute `search_document` inline at row write
-- time. This eliminates Phase 16's per-batch bulk UPDATE (which the
-- profile run showed was 38.9% of WGS import wall time) along with the
-- bracket-transaction trigger-defer machinery and the recovery shim.
--
-- Why a wrapper function instead of inlining `to_tsvector(...)`:
--   `concat_ws(text, VARIADIC text[])` is declared STABLE in pg_proc, so
--   inlining it inside a STORED generated column expression is rejected
--   ("generation expression is not immutable"). PostgreSQL trusts the
--   IMMUTABLE marker on a SQL function regardless of the inner volatility,
--   which is the documented escape hatch for this exact case (see
--   https://www.postgresql.org/docs/current/xfunc-volatility.html).
--   `concat_ws` over text inputs IS effectively immutable; the pg_proc
--   marker is conservative.
--
-- This migration is destructive: it drops Phase 16's triggers, the row-typed
-- `compute_*_search_document(<table>)` functions, and the existing
-- `search_document` column on each FTS-bearing table, then re-adds the column
-- as GENERATED ALWAYS AS ... STORED. The variants/variant_sv/variant_str
-- tables are recreated by `12-phase7-variants.sql` on every dev `make
-- pg-reset`, so the DROP COLUMN is safe in dev. In any future production
-- migration this would need a populate step on existing data — out of scope
-- for the dev container.

-- 1. Drop Phase 7's triggers (added by 12-phase7-variants.sql) and Phase 16's
--    rewritten trigger functions + row-typed compute_* functions.
DROP TRIGGER IF EXISTS variants_search_document_tg    ON variants;
DROP TRIGGER IF EXISTS variant_sv_search_document_tg  ON variant_sv;
DROP TRIGGER IF EXISTS variant_str_search_document_tg ON variant_str;

DROP FUNCTION IF EXISTS update_variants_search_document();
DROP FUNCTION IF EXISTS update_variant_sv_search_document();
DROP FUNCTION IF EXISTS update_variant_str_search_document();

DROP FUNCTION IF EXISTS compute_variants_search_document(variants);
DROP FUNCTION IF EXISTS compute_variant_sv_search_document(variant_sv);
DROP FUNCTION IF EXISTS compute_variant_str_search_document(variant_str);

-- 2. IMMUTABLE wrapper functions, one per FTS table. The argument lists
--    intentionally take plain text columns (NOT the row type) so the
--    GENERATED column expression in step 3 can pass column references
--    directly. Bodies are byte-for-byte identical to the original Phase 7
--    trigger expressions in 12-phase7-variants.sql.
CREATE OR REPLACE FUNCTION compute_variants_search_doc(
  gene_symbol     text,
  consequence     text,
  omim_mim_number text,
  func            text,
  transcript      text,
  cdna            text,
  aa_change       text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', gene_symbol, consequence, omim_mim_number, func, transcript, cdna, aa_change)
  );
$$;

CREATE OR REPLACE FUNCTION compute_variant_sv_search_doc(
  event_id text,
  mate_id  text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector('simple', concat_ws(' ', event_id, mate_id));
$$;

CREATE OR REPLACE FUNCTION compute_variant_str_search_doc(
  repeat_id           text,
  variant_catalog_id  text,
  repeat_unit         text,
  display_repeat_unit text,
  str_status          text,
  disease             text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', repeat_id, variant_catalog_id, repeat_unit, display_repeat_unit, str_status, disease)
  );
$$;

-- 3. Replace `search_document` on each FTS table with a STORED generated
--    column that calls the IMMUTABLE wrapper. Every COPY/INSERT/UPDATE
--    populates the column inline; no second write, no trigger, no bulk
--    UPDATE.
ALTER TABLE variants    DROP COLUMN IF EXISTS search_document;
ALTER TABLE variant_sv  DROP COLUMN IF EXISTS search_document;
ALTER TABLE variant_str DROP COLUMN IF EXISTS search_document;

ALTER TABLE variants ADD COLUMN search_document tsvector
  GENERATED ALWAYS AS (
    compute_variants_search_doc(
      gene_symbol, consequence, omim_mim_number, func, transcript, cdna, aa_change
    )
  ) STORED;

ALTER TABLE variant_sv ADD COLUMN search_document tsvector
  GENERATED ALWAYS AS (
    compute_variant_sv_search_doc(event_id, mate_id)
  ) STORED;

ALTER TABLE variant_str ADD COLUMN search_document tsvector
  GENERATED ALWAYS AS (
    compute_variant_str_search_doc(
      repeat_id, variant_catalog_id, repeat_unit, display_repeat_unit, str_status, disease
    )
  ) STORED;
