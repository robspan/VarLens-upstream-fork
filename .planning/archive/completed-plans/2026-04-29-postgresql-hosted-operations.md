# PostgreSQL Hosted Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize hosted PostgreSQL operation with connection profiles, credential handling, SSL policy, health diagnostics, redacted diagnostic bundles, and operations documentation.

**Architecture:** Add a typed connection profile model and health diagnostics service. Keep credentials out of plaintext settings, expose safe profile metadata to renderer, and document deployment/backup/restore expectations.

**Tech Stack:** TypeScript, Electron safe storage or OS credential store, PostgreSQL `pg`, existing settings IPC, VitePress docs, Vitest.

---

## Files

- Create: `src/shared/types/postgres-profile.ts`
- Create: `src/main/storage/postgres/PostgresProfileStore.ts`
- Create: `src/main/storage/postgres/PostgresHealthDiagnostics.ts`
- Create: `src/main/storage/postgres/PostgresDiagnosticBundle.ts`
- Modify: `src/main/storage/config.ts`
- Modify: `src/main/database/startup.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/shared/ipc/domains/database.ts`
- Modify: `src/preload/domains/database.ts`
- Create: `tests/main/storage/postgres-profile-store.test.ts`
- Create: `tests/main/storage/postgres-health-diagnostics.test.ts`
- Create: `tests/main/storage/postgres-diagnostic-bundle.test.ts`
- Create: `docs/postgresql-hosted-workspaces.md`

## Task 1: Define connection profile model

- [ ] **Step 1: Create shared profile types**

Create `src/shared/types/postgres-profile.ts`:

```ts
export type PostgresProfileSslMode = 'disable' | 'require-verify'

export interface PostgresConnectionProfilePublic {
  id: string
  name: string
  host: string
  port: number
  database: string
  username: string
  schema: string
  sslMode: PostgresProfileSslMode
  poolMax: number
  connectionTimeoutMillis: number
  statementTimeoutMs: number
  lockTimeoutMs: number
  idleInTransactionSessionTimeoutMs: number
  caCertificateConfigured: boolean
}

export interface PostgresConnectionProfileSecretInput {
  password: string
  caCertificatePem?: string
}

export interface PostgresConnectionProfileInput extends Omit<PostgresConnectionProfilePublic, 'id' | 'caCertificateConfigured'> {
  secrets: PostgresConnectionProfileSecretInput
}
```

- [ ] **Step 2: Write profile store test**

Create `tests/main/storage/postgres-profile-store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresProfileStore } from '../../../src/main/storage/postgres/PostgresProfileStore'

describe('PostgresProfileStore', () => {
  it('stores public profile separately from secrets', async () => {
    const secrets = { set: vi.fn(), get: vi.fn() }
    const store = new PostgresProfileStore('/tmp/settings.json', secrets as never)

    const profile = await store.saveProfile({
      name: 'Lab PG',
      host: 'db.example.org',
      port: 5432,
      database: 'varlens',
      username: 'varlens_app',
      schema: 'workspace_a',
      sslMode: 'require-verify',
      poolMax: 4,
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      secrets: { password: 'secret', caCertificatePem: 'pem' }
    })

    expect(profile.caCertificateConfigured).toBe(true)
    expect(secrets.set).toHaveBeenCalledWith(expect.stringContaining(profile.id), expect.any(String))
  })
})
```

- [ ] **Step 3: Implement profile store skeleton**

Create `src/main/storage/postgres/PostgresProfileStore.ts`:

```ts
import { randomUUID } from 'node:crypto'

import type { PostgresConnectionProfileInput, PostgresConnectionProfilePublic } from '../../../shared/types/postgres-profile'

export interface SecretStore {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
}

export class PostgresProfileStore {
  constructor(private readonly settingsPath: string, private readonly secrets: SecretStore) {}

  async saveProfile(input: PostgresConnectionProfileInput): Promise<PostgresConnectionProfilePublic> {
    const id = randomUUID()
    await this.secrets.set(`postgres:${id}:password`, input.secrets.password)
    if (input.secrets.caCertificatePem !== undefined) {
      await this.secrets.set(`postgres:${id}:ca`, input.secrets.caCertificatePem)
    }
    return {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      schema: input.schema,
      sslMode: input.sslMode,
      poolMax: input.poolMax,
      connectionTimeoutMillis: input.connectionTimeoutMillis,
      statementTimeoutMs: input.statementTimeoutMs,
      lockTimeoutMs: input.lockTimeoutMs,
      idleInTransactionSessionTimeoutMs: input.idleInTransactionSessionTimeoutMs,
      caCertificateConfigured: input.secrets.caCertificatePem !== undefined
    }
  }
}
```

Replace the skeleton settings persistence with existing settings IO patterns during implementation.

## Task 2: Add health diagnostics

- [ ] **Step 1: Write diagnostics test**

Create `tests/main/storage/postgres-health-diagnostics.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresHealthDiagnostics } from '../../../src/main/storage/postgres/PostgresHealthDiagnostics'

describe('PostgresHealthDiagnostics', () => {
  it('collects server, schema, role, and migration status', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('version()')) return { rows: [{ version: 'PostgreSQL 18' }] }
      if (sql.includes('current_user')) return { rows: [{ current_user: 'varlens_app' }] }
      if (sql.includes('schema_migrations')) return { rows: [{ version: '0004' }] }
      return { rows: [{ ok: 1 }] }
    })
    const diagnostics = new PostgresHealthDiagnostics({ query } as never, 'public')

    await expect(diagnostics.collect()).resolves.toMatchObject({
      ok: true,
      serverVersion: 'PostgreSQL 18',
      currentUser: 'varlens_app',
      schema: 'public',
      currentMigration: '0004'
    })
  })
})
```

- [ ] **Step 2: Implement diagnostics service**

Create `src/main/storage/postgres/PostgresHealthDiagnostics.ts`:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

export interface PostgresHealthDiagnosticResult {
  ok: boolean
  serverVersion?: string
  currentUser?: string
  schema: string
  currentMigration?: string | null
  message?: string
}

export class PostgresHealthDiagnostics {
  private readonly schemaName: string

  constructor(private readonly pool: Pick<Pool, 'query'>, private readonly schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async collect(): Promise<PostgresHealthDiagnosticResult> {
    try {
      const [version, user, migration] = await Promise.all([
        this.pool.query('SELECT version() AS version'),
        this.pool.query('SELECT current_user'),
        this.pool.query(`SELECT version FROM ${this.schemaName}."schema_migrations" ORDER BY version DESC LIMIT 1`)
      ])
      return {
        ok: true,
        serverVersion: String(version.rows[0]?.version ?? ''),
        currentUser: String(user.rows[0]?.current_user ?? ''),
        schema: this.schema,
        currentMigration: migration.rows[0]?.version ?? null
      }
    } catch (error) {
      return { ok: false, schema: this.schema, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
```

- [ ] **Step 3: Expose diagnostics IPC**

Add `database:postgresDiagnostics` channel in `database.ts`, shared domain, and preload. Return diagnostics only for PostgreSQL sessions; for SQLite return a typed unsupported result through `wrapHandler`.

## Task 3: Add redacted diagnostic bundle

- [ ] **Step 1: Write bundle test**

Create `tests/main/storage/postgres-diagnostic-bundle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createPostgresDiagnosticBundle } from '../../../src/main/storage/postgres/PostgresDiagnosticBundle'

describe('PostgresDiagnosticBundle', () => {
  it('redacts secrets from connection labels', () => {
    const bundle = createPostgresDiagnosticBundle({
      appVersion: '1.0.0',
      connectionUrlRedacted: 'postgres://db.example.org/varlens',
      schema: 'public',
      capabilities: { backend: 'postgres' } as never,
      diagnostics: { ok: true, schema: 'public' }
    })

    expect(JSON.stringify(bundle)).not.toContain('password')
    expect(bundle.backend).toBe('postgres')
  })
})
```

- [ ] **Step 2: Implement bundle**

Create `src/main/storage/postgres/PostgresDiagnosticBundle.ts`:

```ts
import type { StorageCapabilities } from '../types'
import type { PostgresHealthDiagnosticResult } from './PostgresHealthDiagnostics'

export interface PostgresDiagnosticBundleInput {
  appVersion: string
  connectionUrlRedacted: string
  schema: string
  capabilities: StorageCapabilities
  diagnostics: PostgresHealthDiagnosticResult
}

export function createPostgresDiagnosticBundle(input: PostgresDiagnosticBundleInput): Record<string, unknown> {
  return {
    appVersion: input.appVersion,
    backend: 'postgres',
    connectionUrlRedacted: input.connectionUrlRedacted,
    schema: input.schema,
    capabilities: input.capabilities,
    diagnostics: input.diagnostics,
    generatedAt: new Date().toISOString()
  }
}
```

## Task 4: Hosted operations docs

- [ ] **Step 1: Create docs page**

Create `docs/postgresql-hosted-workspaces.md`:

```md
# PostgreSQL hosted workspaces

VarLens can connect to a PostgreSQL workspace for teams that need hosted storage. PostgreSQL support is separate from the default encrypted local SQLite database.

## Security model

Use a dedicated PostgreSQL role for VarLens application access. Use a separate migration/admin role when schema upgrades are required. Do not grant broad superuser privileges to the app role.

## SSL

Use certificate verification for hosted deployments. Local development may use SSL disabled only on trusted local networks.

## Backups

Back up the database or workspace schema using `pg_dump`. Test restore before relying on backups for clinical or research data recovery.

## Connection pooling

Start with a small pool size. Managed PostgreSQL services enforce connection limits. If PgBouncer is used, prefer session pooling unless VarLens has been verified against transaction pooling.

## Diagnostics

Use the PostgreSQL diagnostics export when reporting issues. It redacts credentials and includes schema, migration, capability, and health status.
```

- [ ] **Step 2: Add VitePress sidebar entry if docs config has one**

Modify docs config to include `postgresql-hosted-workspaces.md` in the relevant section.

## Task 5: Commit

- [ ] **Step 1: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-profile-store.test.ts tests/main/storage/postgres-health-diagnostics.test.ts tests/main/storage/postgres-diagnostic-bundle.test.ts`

Expected: PASS.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/shared/types/postgres-profile.ts src/main/storage/postgres/PostgresProfileStore.ts src/main/storage/postgres/PostgresHealthDiagnostics.ts src/main/storage/postgres/PostgresDiagnosticBundle.ts src/main/storage/config.ts src/main/database/startup.ts src/main/ipc/handlers/database.ts src/shared/ipc/domains/database.ts src/preload/domains/database.ts tests/main/storage/postgres-profile-store.test.ts tests/main/storage/postgres-health-diagnostics.test.ts tests/main/storage/postgres-diagnostic-bundle.test.ts docs/postgresql-hosted-workspaces.md
git commit -m "feat(postgres): add hosted operations foundation"
```
