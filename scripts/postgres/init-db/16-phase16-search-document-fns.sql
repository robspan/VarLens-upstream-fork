-- scripts/postgres/init-db/16-phase16-search-document-fns.sql
-- Phase 16: extract trigger expressions into reusable SQL functions
-- so the bulk-UPDATE path (Phase 16) and the trigger path share a single
-- source of truth for `search_document`. Additive only: no column,
-- index, or trigger declaration changes.

CREATE OR REPLACE FUNCTION compute_variants_search_document(v variants)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', v.gene_symbol, v.consequence, v.omim_mim_number, v.func, v.transcript, v.cdna, v.aa_change)
  );
$$;

CREATE OR REPLACE FUNCTION compute_variant_sv_search_document(s variant_sv)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector('simple', concat_ws(' ', s.event_id, s.mate_id));
$$;

CREATE OR REPLACE FUNCTION compute_variant_str_search_document(t variant_str)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', t.repeat_id, t.variant_catalog_id, t.repeat_unit, t.display_repeat_unit, t.str_status, t.disease)
  );
$$;

-- Rewrite the existing trigger functions as one-liners that delegate.
-- Behaviour is byte-for-byte identical to the original trigger functions.

CREATE OR REPLACE FUNCTION update_variants_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variants_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_sv_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variant_sv_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_str_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variant_str_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
