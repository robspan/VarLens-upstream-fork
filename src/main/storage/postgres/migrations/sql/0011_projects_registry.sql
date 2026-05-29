-- Sprint A PR-4 D5 — projects registry. Single-row default backfill so
-- Sprint E doesn't have to handle projectless databases (cheap-to-add-now
-- /expensive-to-add-later). No code references this table in Sprint A.

CREATE TABLE IF NOT EXISTS "__schema__"."projects" (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- schema_name reflects the actual (template-replaced) schema. The runner only
-- interpolates the double-quoted "__schema__" token, so we resolve the real
-- schema name from the table's own catalog entry rather than a string literal:
-- '"__schema__"."projects"'::regclass becomes '"<schema>"."projects"'::regclass
-- after interpolation, and its namespace is the actual schema.
INSERT INTO "__schema__"."projects" (id, name, schema_name)
SELECT 1, 'default', (
  SELECT n.nspname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = '"__schema__"."projects"'::regclass
)
ON CONFLICT (id) DO NOTHING;
