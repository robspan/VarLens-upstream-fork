-- Return the web runtime to one application database and one schema.
-- Database/role/instance lifecycle is owned by the external platform.

ALTER TABLE "__schema__"."users"
  DROP CONSTRAINT IF EXISTS users_private_db_status_check;

DROP INDEX IF EXISTS "__schema__"."users_private_db_secret_ref_unique";
DROP INDEX IF EXISTS "__schema__"."idx_users_public_annotation_snapshot_id";

ALTER TABLE "__schema__"."users"
  DROP COLUMN IF EXISTS private_db_secret_ref,
  DROP COLUMN IF EXISTS private_db_status,
  DROP COLUMN IF EXISTS public_annotation_snapshot_id;

-- Reference annotation data is optional and, when supplied, is copied into
-- this instance schema by an external operator workflow. VarLens only reads it.
CREATE TABLE IF NOT EXISTS "__schema__"."public_annotation_snapshots" (
  snapshot_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  bundle_id TEXT,
  genome_build TEXT,
  mapping_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_checksum TEXT NOT NULL,
  license_matrix_checksum TEXT NOT NULL,
  source_manifest_checksum TEXT NOT NULL,
  private_case_data BOOLEAN NOT NULL DEFAULT FALSE,
  stored_manifest_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "__schema__"."public_annotation_files" (
  snapshot_id TEXT NOT NULL
    REFERENCES "__schema__"."public_annotation_snapshots"(snapshot_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  path TEXT NOT NULL,
  checksum TEXT,
  size_bytes BIGINT,
  index_path TEXT,
  index_checksum TEXT,
  index_size_bytes BIGINT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  format_version TEXT,
  PRIMARY KEY (snapshot_id, role, path)
);

CREATE TABLE IF NOT EXISTS "__schema__"."public_annotation_variant_records" (
  snapshot_id TEXT NOT NULL
    REFERENCES "__schema__"."public_annotation_snapshots"(snapshot_id) ON DELETE CASCADE,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  source_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value JSONB NOT NULL,
  evidence_json JSONB NOT NULL,
  provenance_json JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, chr, pos, ref, alt, source_id, field_name)
);

CREATE INDEX IF NOT EXISTS public_annotation_variant_records_lookup_idx
  ON "__schema__"."public_annotation_variant_records" (chr, pos, ref, alt);
