CREATE TABLE IF NOT EXISTS "__schema__"."audit_log" (
  id BIGSERIAL PRIMARY KEY,
  action_type TEXT NOT NULL CHECK(action_type IN (
    'acmg_classify',
    'acmg_evidence_update',
    'star',
    'unstar',
    'comment_add',
    'comment_edit',
    'comment_delete',
    'tag_assign',
    'tag_remove'
  )),
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'variant_annotation',
    'case_variant_annotation'
  )),
  entity_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  user_name TEXT,
  metadata_json TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON "__schema__"."audit_log"(entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON "__schema__"."audit_log"(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON "__schema__"."audit_log"(entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON "__schema__"."audit_log"(created_at DESC);
