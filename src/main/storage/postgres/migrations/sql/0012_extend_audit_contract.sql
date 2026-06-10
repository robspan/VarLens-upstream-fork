ALTER TABLE "__schema__"."audit_log"
  DROP CONSTRAINT IF EXISTS audit_log_action_type_check;

ALTER TABLE "__schema__"."audit_log"
  ADD CONSTRAINT audit_log_action_type_check CHECK(action_type IN (
    'acmg_classify',
    'acmg_evidence_update',
    'star',
    'unstar',
    'comment_add',
    'comment_edit',
    'comment_delete',
    'tag_assign',
    'tag_remove',
    'auth_login_success',
    'auth_login_failure',
    'auth_logout',
    'auth_password_change',
    'auth_password_reset',
    'auth_user_deactivate',
    'api_write'
  ));

ALTER TABLE "__schema__"."audit_log"
  DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE "__schema__"."audit_log"
  ADD CONSTRAINT audit_log_entity_type_check CHECK(entity_type IN (
    'variant_annotation',
    'case_variant_annotation',
    'user_account',
    'api_call'
  ));
