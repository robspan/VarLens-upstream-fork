-- Postgres-side auth tables, mirroring SQLite migrations.ts v12.
--
-- Schema kept lockstep with the desktop schema so the two backends share
-- column names, role enum, lockout shape, and audit fields. The constants
-- module (src/shared/auth/auth-constants.ts) is the single source of truth for
-- these names and values.
--
-- Differences from SQLite by necessity (not policy):
--   - INTEGER PRIMARY KEY AUTOINCREMENT     -> BIGSERIAL PRIMARY KEY
--   - INTEGER 0/1 boolean                   -> BOOLEAN
--   - TEXT timestamp via datetime('now')    -> TIMESTAMPTZ DEFAULT now()
--   - INTEGER counters                      -> INTEGER (kept; row counts fit fine)
-- Argon2 hashes are TEXT in both. CHECK constraints on role mirror exactly.

CREATE TABLE IF NOT EXISTS "__schema__"."users" (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES "__schema__"."users"(id),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON "__schema__"."users"(username);

-- Concurrency guard for createFirstUser: at most one active admin row may
-- exist in this schema. Inactive admin rows must not permanently block
-- bootstrap after manual recovery, while concurrent active bootstrap attempts
-- still collapse to one successful INSERT.
CREATE UNIQUE INDEX IF NOT EXISTS users_only_one_active_admin
  ON "__schema__"."users"(role)
  WHERE role = 'admin' AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS "__schema__"."database_settings" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
