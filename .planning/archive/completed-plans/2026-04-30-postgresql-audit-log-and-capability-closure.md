# PostgreSQL Audit Log And Capability Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add PostgreSQL audit log parity and close the remaining capability matrix gates honestly.

**Architecture:** Add a PostgreSQL audit table and repository, route audit IPC through storage executors, write audit entries from workflow mutation paths, and add tests that fail if declared PostgreSQL parity regresses.

**Tech Stack:** TypeScript, PostgreSQL migrations, Vitest, existing storage session/read/write executor pattern.

---

## File Structure

- Create: `src/main/storage/postgres/migrations/sql/0006_create_audit_log.sql`
  - PostgreSQL audit log table and indexes.
- Modify: `src/main/storage/postgres/migrations/definitions.ts`
  - Register the new migration.
- Create: `src/main/storage/postgres/PostgresAuditLogRepository.ts`
  - Audit query and append methods.
- Modify: `src/main/storage/read-executor.ts`
  - Add audit read tasks.
- Modify: `src/main/storage/write-executor.ts`
  - Add audit append task if audit writes are routed through storage writes.
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
  - Route audit read tasks.
- Modify: `src/main/storage/postgres/PostgresWriteExecutor.ts`
  - Route audit append task.
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
  - Instantiate audit repository and set `workflow.auditLog` to `true`.
- Modify: `src/main/ipc/handlers/audit-log.ts`
  - Read via current storage session rather than `db.auditLog`.
- Modify: `src/main/ipc/handlers/annotations-logic.ts`
  - Ensure PostgreSQL annotation mutations write audit entries.
- Modify: `src/main/ipc/handlers/tags.ts`
  - Ensure PostgreSQL tag assignment/removal mutations write audit entries.
- Create: `tests/main/storage/postgres-audit-log-repository.test.ts`
  - SQL and mapping tests.
- Create: `tests/main/handlers/audit-log.test.ts`
  - IPC routing tests for PostgreSQL audit reads.
- Modify: `tests/main/storage/backend-capabilities.test.ts`
  - Lock `workflow.auditLog: true`.
- Modify: `.planning/artifacts/postgres-parity/capability-matrix.md`
  - Mark audit log complete.

## Task 1: Add PostgreSQL Audit Migration

- [x] **Step 1: Create migration SQL**

Create `src/main/storage/postgres/migrations/sql/0006_create_audit_log.sql`:

```sql
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
  metadata_json TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON "__schema__"."audit_log"(entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON "__schema__"."audit_log"(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON "__schema__"."audit_log"(entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON "__schema__"."audit_log"(created_at DESC);
```

- [x] **Step 2: Register migration**

In `src/main/storage/postgres/migrations/definitions.ts`, add the migration after `0005_create_workflow_tables.sql` with the next version number.

- [x] **Step 3: Add migration test**

Update `tests/main/storage/postgres-migration-definitions.test.ts` to assert `0006_create_audit_log.sql` is registered after `0005_create_workflow_tables.sql`.

- [x] **Step 4: Run migration tests**

Run: `npx vitest run tests/main/storage/postgres-migration-definitions.test.ts`

Expected: PASS.

## Task 2: Implement Audit Repository

- [x] **Step 1: Create repository**

Create `src/main/storage/postgres/PostgresAuditLogRepository.ts`:

```ts
import type { Pool } from 'pg'
import type { AuditActionType, AuditEntityType } from '../../database/types'
import { quoteIdentifier } from './identifiers'

export interface AuditQueryParams {
  action_type?: AuditActionType
  entity_type?: AuditEntityType
  entity_key?: string
  from_timestamp?: number
  to_timestamp?: number
  limit?: number
  offset?: number
}

export interface AuditAppendParams {
  action_type: AuditActionType
  entity_type: AuditEntityType
  entity_key: string
  old_value?: unknown
  new_value?: unknown
  metadata?: unknown
}

export class PostgresAuditLogRepository {
  private readonly schemaName: string

  constructor(private readonly pool: Pick<Pool, 'query'>, schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getByEntityKey(entityKey: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schemaName}."audit_log" WHERE entity_key = $1 ORDER BY created_at DESC`,
      [entityKey]
    )
    return result.rows
  }

  async query(params: AuditQueryParams): Promise<unknown[]> {
    const where: string[] = []
    const values: unknown[] = []
    const add = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }

    if (params.action_type !== undefined) where.push(`action_type = ${add(params.action_type)}`)
    if (params.entity_type !== undefined) where.push(`entity_type = ${add(params.entity_type)}`)
    if (params.entity_key !== undefined) where.push(`entity_key = ${add(params.entity_key)}`)
    if (params.from_timestamp !== undefined) where.push(`created_at >= ${add(params.from_timestamp)}`)
    if (params.to_timestamp !== undefined) where.push(`created_at <= ${add(params.to_timestamp)}`)

    const limit = add(params.limit ?? 1000)
    const offset = add(params.offset ?? 0)
    const result = await this.pool.query(
      `SELECT * FROM ${this.schemaName}."audit_log"
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      values
    )
    return result.rows
  }

  async append(params: AuditAppendParams): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schemaName}."audit_log" (
        action_type, entity_type, entity_key, old_value, new_value, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.action_type,
        params.entity_type,
        params.entity_key,
        params.old_value === undefined ? null : JSON.stringify(params.old_value),
        params.new_value === undefined ? null : JSON.stringify(params.new_value),
        params.metadata === undefined ? null : JSON.stringify(params.metadata)
      ]
    )
  }
}
```

- [x] **Step 2: Add repository tests**

Create `tests/main/storage/postgres-audit-log-repository.test.ts` with tests for:

```ts
it('queries by entity key ordered newest first', async () => {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: '1', entity_key: 'v:1' }] }) }
  const repo = new PostgresAuditLogRepository(pool as never, 'public')
  await expect(repo.getByEntityKey('v:1')).resolves.toHaveLength(1)
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), ['v:1'])
})

it('appends json-encoded old and new values', async () => {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  const repo = new PostgresAuditLogRepository(pool as never, 'public')
  await repo.append({
    action_type: 'star',
    entity_type: 'case_variant_annotation',
    entity_key: 'case:1:variant:2',
    old_value: { starred: 0 },
    new_value: { starred: 1 }
  })
  expect(pool.query.mock.calls[0][1]).toContain(JSON.stringify({ starred: 1 }))
})
```

- [x] **Step 3: Run repository tests**

Run: `npx vitest run tests/main/storage/postgres-audit-log-repository.test.ts`

Expected: PASS.

## Task 3: Wire Audit Through Storage Executors

- [x] **Step 1: Add read tasks**

In `src/main/storage/read-executor.ts`, add:

```ts
| { type: 'audit:getByEntity'; params: [entityKey: string] }
| { type: 'audit:query'; params: [params: AuditQueryParams] }
```

- [x] **Step 2: Add write task**

In `src/main/storage/write-executor.ts`, add:

```ts
| { type: 'audit:append'; params: [params: AuditAppendParams] }
```

- [x] **Step 3: Route tasks in PostgreSQL executors**

In `PostgresReadExecutor`, add:

```ts
case 'audit:getByEntity':
  return await this.repositories.audit.getByEntityKey(task.params[0])
case 'audit:query':
  return await this.repositories.audit.query(task.params[0])
```

In `PostgresWriteExecutor`, add:

```ts
case 'audit:append':
  return await this.workflow.audit.append(task.params[0])
```

- [x] **Step 4: Instantiate in `PostgresStorageSession`**

Create:

```ts
const audit = new PostgresAuditLogRepository(options.pool, options.config.schema)
```

Pass it to both read and write executors.

- [x] **Step 5: Run executor tests**

Run:

```bash
npx vitest run tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
make typecheck
```

Expected: PASS.

## Task 4: Route Audit IPC And Mutation Writes

- [x] **Step 1: Update audit IPC handler**

In `src/main/ipc/handlers/audit-log.ts`, use the current storage session:

```ts
const session = getDbManager().getCurrentSession()
if (session.capabilities.backend === 'postgres') {
  return await session.getReadExecutor().execute({
    type: 'audit:getByEntity',
    params: [validated.data]
  })
}
const db = getDb()
return db.auditLog.getByEntityKey(validated.data)
```

Apply the same pattern for `audit:query`.

- [x] **Step 2: Update handler dependencies**

Change `registerAuditLogHandlers` to destructure `getDbManager` from `HandlerDependencies`:

```ts
export function registerAuditLogHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
```

Update `src/main/ipc/domains/audit-log.ts` only if its call site does not already pass the full dependency object.

- [x] **Step 3: Add PostgreSQL audit handler tests**

Create or update `tests/main/handlers/audit-log.test.ts` to assert:

```ts
expect(readExecutor.execute).toHaveBeenCalledWith({
  type: 'audit:getByEntity',
  params: ['case:1:variant:2']
})
```

and:

```ts
expect(readExecutor.execute).toHaveBeenCalledWith({
  type: 'audit:query',
  params: [expect.objectContaining({ action_type: 'star' })]
})
```

- [x] **Step 4: Add mutation audit writes**

In the workflow mutation logic that writes SQLite audit entries today, add a PostgreSQL path that calls:

```ts
await session.getWriteExecutor().execute({
  type: 'audit:append',
  params: [{
    action_type,
    entity_type,
    entity_key,
    old_value: oldValue,
    new_value: newValue,
    metadata
  }]
})
```

Wrap only the audit append in a best-effort `try/catch` if SQLite already treats audit as best-effort. Use `mainLogger.warn` for audit append failures.

- [x] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/main/handlers/audit-log.test.ts tests/main/handlers/annotations-logic.test.ts tests/main/storage/postgres-audit-log-repository.test.ts
make typecheck
```

Expected: PASS.

## Task 5: Close Capabilities And Matrix

- [x] **Step 1: Flip audit capability**

In `src/main/storage/postgres/PostgresStorageSession.ts`, set:

```ts
workflow: {
  auditLog: true
}
```

Preserve the existing `true` values for other workflow domains.

- [x] **Step 2: Update capability tests**

In `tests/main/storage/backend-capabilities.test.ts`, expect:

```ts
expect(POSTGRES_CAPABILITIES.workflow.auditLog).toBe(true)
```

- [x] **Step 3: Update matrix**

In `.planning/artifacts/postgres-parity/capability-matrix.md`, update:

```md
| Workflow | audit log | yes | yes | no | done |
```

- [x] **Step 4: Add final parity guard test**

Create `tests/main/storage/postgres-final-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { POSTGRES_CAPABILITIES } from '../../../src/main/storage/postgres/PostgresStorageSession'

describe('PostgreSQL final parity capabilities', () => {
  it('declares support for scoped final parity features', () => {
    expect(POSTGRES_CAPABILITIES.variants.panelFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.tagFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.commentFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.acmgFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.annotationFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.inheritanceFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.variants.analysisGroupFilters).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.query).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.summary).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.carriers).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.geneBurden).toBe(true)
    expect(POSTGRES_CAPABILITIES.cohort.columnMeta).toBe(true)
    expect(POSTGRES_CAPABILITIES.export.cohort).toBe(true)
    expect(POSTGRES_CAPABILITIES.workflow.auditLog).toBe(true)
  })
})
```

- [x] **Step 5: Run final focused tests**

Run:

```bash
npx vitest run tests/main/storage/postgres-final-parity.test.ts tests/main/storage/backend-capabilities.test.ts tests/main/handlers/audit-log.test.ts tests/main/storage/postgres-audit-log-repository.test.ts
make typecheck
```

Expected: PASS.

- [x] **Step 6: Run full local gate**

Run:

```bash
make ci
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/main/storage src/main/ipc tests/main .planning/artifacts/postgres-parity/capability-matrix.md
git commit -m "feat(postgres): add audit log parity"
```
