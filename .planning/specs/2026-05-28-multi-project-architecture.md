# Sprint E — Multi-Project Architecture — Design Doc

**Status:** Locked 2026-05-28
**Spec for Sprint E** (plan in Sprint E itself)
**Predecessor:** Sprint A PR-4 D5 — this doc + the projects-registry migration land in PR-4; no code references it in Sprint A.

## Goal

Allow VarLens to manage multiple isolated projects (each a PG schema or SQLite database) from one running instance, with a project picker, hot session pool, and cross-project queries (PG only).

## In scope (Sprint E)

- Data model: `projects` table — see migrations 0011 (PG) and v30 (SQLite) from PR-4 D5.
- Session model — where the implicit single-project assumption lives today (StorageSession.constructor), what to refactor.
- Hot session pool — SessionPool + pickProject(projectId) API.
- Cross-project query story (PG only) — UNION ALL over schemas; SQLite stays single-project.
- Existing-user migration — default project row backfilled on first launch (already shipped in PR-4 D5's seed).

## Out of scope (Sprint F+)

- Multi-tenant authentication / authorisation.
- Per-project encryption keys.
- Cross-project annotations.

## Data model (already shipped in PR-4)

PG migration 0011_projects_registry.sql + SQLite v30 created the `projects`
table with a single 'default' row.

> **Migration-number note (verified 2026-05-28 against `feat/job-runner`):**
> at the time this doc was locked the highest shipped PG migration was
> `0010_cohort_summary.sql` and the highest SQLite `user_version` was `30`
> (`end_pos` on `cohort_variant_summary`, Sprint A PR-3). The PR-4 D5
> migration task MUST therefore re-verify the next free number for **each**
> backend immediately before writing — the projects registry lands as PG
> `0011` and SQLite **`v31`** (one greater than the SQLite head, not `v30`,
> which is already taken). This doc keeps the plan's nominal `0011 / v30`
> labels for traceability; the executing task uses the re-verified numbers.

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  schema_name TEXT NOT NULL,           -- PG schema OR SQLite path
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO projects (id, name, schema_name) VALUES (1, 'default', 'public');
```

The `schema_name` column is intentionally backend-overloaded: on PostgreSQL it
is the SQL schema (`public`, `project_2`, …) that already threads through every
repository as the `schema: string` argument; on SQLite it is the absolute
database-file path. This keeps one registry shape across both backends without a
backend-discriminated union at the row level — the consuming code branches on
`StorageCapabilities.backend`, not on the row.

## Session model

Today VarLens runs exactly one `StorageSession` at a time, and the
single-project assumption is structural rather than explicit. The relevant
seams:

- **`StorageSession` (`src/main/storage/session.ts`)** carries a single
  `readonly workspace: WorkspaceRef`. There is no notion of "which project"
  beyond "which workspace is open right now".
- **`WorkspaceRef` (`src/main/storage/types.ts`)** is a union of
  `{ kind: 'sqlite', path, name, encrypted }` and
  `{ kind: 'postgres', connectionLabel, connectionUrlRedacted, schema }`. The
  `schema` (PG) and `path` (SQLite) fields ARE the per-project discriminators —
  they map one-to-one onto `projects.schema_name`. A project is therefore not a
  new concept at the storage layer; it is a named, registry-backed
  `WorkspaceRef`.
- **`PostgresStorageSession` (`src/main/storage/postgres/PostgresStorageSession.ts`)**
  is constructed for one `schema` and threads that schema into every repository
  (`createCaseListRepository(pool, schema)` and the per-call `args.schema`
  pattern seen across `cohort-annotation-flags-sql.ts`,
  `PostgresCaseLifecycleRepository`, etc.). The PG plumbing is already
  schema-parameterised; what is missing is a registry that maps a project id to
  a schema and a factory that opens a session for an arbitrary registered
  schema.
- **`SqliteStorageSession` (`src/main/storage/sqlite/SqliteStorageSession.ts`)**
  is constructed for one database file (one `path`). SQLite multi-project means
  one file per project; there is no cross-file query path (see below).
- **Single-flight guards** (`PostgresImportExecutor` "An import is already in
  progress"; cohort association guard in cohort-logic; batch-import-logic
  "A batch import is already in progress") are today implicitly per-instance.
  Once multiple sessions can be live in the pool, these guards MUST become
  **per-project** (keyed by project id / schema) rather than per-process, or
  importing into project A would wrongly block an import into project B. Sprint E
  MUST audit each guard and re-key it; this is called out explicitly so the
  refactor does not silently re-scope or weaken an existing guard.

**Refactor target:** introduce a `ProjectRegistry` (reads the `projects` table
through the active connection / a control session) and make session creation
take a `projectId`. The existing factories
(`createPostgresStorageSession` / `createSqliteStorageSession`) already accept
the workspace shape; Sprint E wraps them so a `projectId` resolves to a
`schema_name` and then to a `WorkspaceRef`.

## Hot session pool

A `SessionPool` holds up to N open `StorageSession` instances keyed by
`projectId`, so switching projects in the UI does not pay full
connect + migrate cost every time.

```ts
interface SessionPool {
  // Resolve projectId -> schema_name via ProjectRegistry, open or reuse a
  // StorageSession, mark it most-recently-used. Opens lazily.
  pickProject(projectId: number): Promise<StorageSession>

  // The currently active session, if any (drives the renderer's data views).
  active(): StorageSession | undefined

  // Pool sizing. When size would exceed max, evict the least-recently-used
  // session whose close() is safe (no in-flight import / single-flight guard
  // held). Eviction MUST respect per-project single-flight state.
  readonly maxOpen: number

  closeAll(): Promise<void>
}
```

- **LRU eviction**: when `pickProject` would exceed `maxOpen`, evict the
  least-recently-used idle session and `close()` it. A session holding a
  per-project single-flight guard (active import / cohort association /
  batch import) is **not** evictable until that operation completes.
- **PG vs SQLite**: PG sessions share one `Pool` connection pool and differ
  only by `schema` / `search_path`, so they are cheap to keep hot. SQLite
  sessions each own a file handle (and possibly an encryption key), so `maxOpen`
  may be smaller for SQLite.
- **Encryption**: per-project encryption keys are out of scope (Sprint F+); for
  Sprint E a SQLite project reuses the existing single-key model via
  `getEncryptionKey()`.

## Cross-project queries (PG)

PostgreSQL only. Because each project is a schema in the same database, a
cross-project cohort query is a `UNION ALL` over the per-project schemas with a
synthetic `project_id` column so results stay attributable:

```sql
SELECT 1 AS project_id, /* cohort cols */ FROM project_1.variants v /* ... */
UNION ALL
SELECT 2 AS project_id, /* cohort cols */ FROM project_2.variants v /* ... */
-- one branch per selected project's schema_name, generated from ProjectRegistry
```

- The branch list is generated from the `projects` registry (filtered to the
  user's selected projects), reusing the existing schema-parameterised SQL
  builders — each builder already takes `schema: string`, so the cross-project
  builder composes N single-schema fragments rather than introducing new SQL.
- **Set-equality guarantee** (Gate, below): the `UNION ALL` result MUST be
  set-equal to running the same single-schema query against each schema
  separately and unioning client-side. This is the correctness contract the
  Sprint E plan tests.
- **SQLite stays single-project.** SQLite has no cross-database schema-union
  equivalent that matches the PG semantics cheaply (ATTACH-based unions are
  out of scope), so the cross-project feature is PG-only by design. The
  renderer disables the cross-project affordance when
  `capabilities.backend === 'sqlite'`.

## Migration story

Existing users get the default project row backfilled in PR-4 D5; the migration
inserts `(1, 'default', 'public')` (PG) / `(1, 'default', <existing db path>)`
(SQLite) so every already-open workspace becomes "the default project" with no
data movement. Sprint E's renderer picks `'default'` (project id 1) when no
explicit project is selected, so a user who never opens the project picker sees
identical behaviour to today. No backfill re-keys data or moves it between
schemas; the default project simply names the schema/file that already exists.

## Acceptance gates (for Sprint E plan)

1. SessionPool can hold N open StorageSessions; LRU eviction.
2. Project picker UI in renderer.
3. Cross-project cohort query (PG only) returns set-equal results to
   running the query against each schema separately and UNION-ing.
4. Existing single-project users see no behaviour change.
