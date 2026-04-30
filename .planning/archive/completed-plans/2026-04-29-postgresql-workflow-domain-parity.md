# PostgreSQL Workflow Domain Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move clinical workflow domains onto PostgreSQL-backed storage paths: tags, annotations, comments, metrics, panels, gene lists, region files, filter presets, analysis groups, and audit decisions.

**Architecture:** Implement one focused PostgreSQL repository per workflow domain, add storage tasks where needed, and migrate IPC handlers away from `getDb()` for PostgreSQL sessions. Keep domains independent so work can be parallelized safely.

**Tech Stack:** TypeScript, PostgreSQL, Electron IPC, existing domain handlers, Vitest.

---

## Files

- Create: `src/main/storage/postgres/PostgresTagsRepository.ts`
- Create: `src/main/storage/postgres/PostgresAnnotationsRepository.ts`
- Create: `src/main/storage/postgres/PostgresCommentsMetricsRepository.ts`
- Create: `src/main/storage/postgres/PostgresPanelsRepository.ts`
- Create: `src/main/storage/postgres/PostgresFilterPresetsRepository.ts`
- Create: `src/main/storage/postgres/PostgresAnalysisGroupsRepository.ts`
- Modify: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/write-executor.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresWriteExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `src/main/ipc/handlers/tags.ts`
- Modify: `src/main/ipc/handlers/annotations.ts`
- Modify: `src/main/ipc/handlers/case-comments.ts`
- Modify: `src/main/ipc/handlers/case-metrics.ts`
- Modify: `src/main/ipc/handlers/panels.ts`
- Modify: `src/main/ipc/handlers/gene-lists.ts`
- Modify: `src/main/ipc/handlers/filter-presets.ts`
- Modify: `src/main/ipc/handlers/analysis-groups.ts`
- Create: `tests/main/storage/postgres-tags-repository.test.ts`
- Create: `tests/main/storage/postgres-annotations-repository.test.ts`
- Create: `tests/main/storage/postgres-panels-repository.test.ts`
- Create: `tests/main/storage/postgres-filter-presets-repository.test.ts`
- Create: `tests/main/storage/postgres-analysis-groups-repository.test.ts`

## Task 1: Tags parity

- [ ] **Step 1: Write tags repository tests**

Create `tests/main/storage/postgres-tags-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresTagsRepository } from '../../../src/main/storage/postgres/PostgresTagsRepository'

describe('PostgresTagsRepository', () => {
  it('lists tags ordered by name', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: '1', name: 'Review', color: '#ff0000' }] }))
    const repo = new PostgresTagsRepository({ query } as never, 'public')

    await expect(repo.listTags()).resolves.toEqual([{ id: 1, name: 'Review', color: '#ff0000' }])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM public."tags"'))
  })

  it('assigns a tag to a variant idempotently', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const repo = new PostgresTagsRepository({ query } as never, 'public')

    await repo.assignVariantTag(2, 10, 3)

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), [2, 10, 3])
  })
})
```

- [ ] **Step 2: Implement tags repository**

Create `src/main/storage/postgres/PostgresTagsRepository.ts`:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

export class PostgresTagsRepository {
  private readonly schemaName: string

  constructor(private readonly pool: Pick<Pool, 'query'>, schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async listTags(): Promise<Array<{ id: number; name: string; color: string }>> {
    const result = await this.pool.query(`SELECT id, name, color FROM ${this.schemaName}."tags" ORDER BY name`)
    return result.rows.map((row) => ({ id: Number(row.id), name: String(row.name), color: String(row.color) }))
  }

  async createTag(name: string, color: string): Promise<unknown> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schemaName}."tags" (name, color, created_at) VALUES ($1, $2, $3) RETURNING *`,
      [name, color, Date.now()]
    )
    return result.rows[0]
  }

  async assignVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schemaName}."variant_tags" (case_id, variant_id, tag_id, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (case_id, variant_id, tag_id) DO NOTHING`,
      [caseId, variantId, tagId, Date.now()]
    )
  }
}
```

Add update/delete/get usage/get variant tags/set/remove methods matching existing SQLite tag handler behavior.

- [ ] **Step 3: Route tag handler for PostgreSQL**

In `src/main/ipc/handlers/tags.ts`, branch on `getDbManager().getCurrentSession().capabilities.backend === 'postgres'` and route to storage task/repository instead of `getDb()`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-tags-repository.test.ts tests/main/handlers/tags-handlers.test.ts`

Expected: PASS.

## Task 2: Annotations and ACMG parity

- [ ] **Step 1: Write annotation tests**

Create `tests/main/storage/postgres-annotations-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

describe('PostgresAnnotationsRepository', () => {
  it('upserts per-case annotation', async () => {
    const query = vi.fn(async () => ({ rows: [{ case_id: '1', variant_id: '2', acmg_classification: 'VUS' }] }))
    const repo = new PostgresAnnotationsRepository({ query } as never, 'public')

    await expect(repo.upsertPerCaseAnnotation(1, 2, { acmg_classification: 'VUS' })).resolves.toMatchObject({
      case_id: 1,
      variant_id: 2,
      acmg_classification: 'VUS'
    })
  })
})
```

- [ ] **Step 2: Implement annotation repository**

Create `src/main/storage/postgres/PostgresAnnotationsRepository.ts` with methods matching `annotations-logic.ts`:

```ts
export class PostgresAnnotationsRepository {
  async upsertPerCaseAnnotation(caseId: number, variantId: number, updates: Record<string, unknown>): Promise<unknown> {
    // Build explicit column list for supported fields: acmg_classification, comment, review_status, updated_at.
  }
}
```

Use explicit supported fields, not dynamic SQL from arbitrary object keys.

- [ ] **Step 3: Route annotation handler**

Modify `src/main/ipc/handlers/annotations.ts` to route PostgreSQL sessions to the repository and keep SQLite path unchanged.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-annotations-repository.test.ts tests/main/handlers/annotations-logic.test.ts`

Expected: PASS.

## Task 3: Panels, gene lists, and region files parity

- [ ] **Step 1: Write panel repository tests**

Create `tests/main/storage/postgres-panels-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresPanelsRepository } from '../../../src/main/storage/postgres/PostgresPanelsRepository'

describe('PostgresPanelsRepository', () => {
  it('sets panel genes transactionally', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const pool = { connect: vi.fn(async () => client) }
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await repo.setGenes(5, ['BRCA1', 'TP53'])

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM public."panel_genes"'), [5])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })
})
```

- [ ] **Step 2: Implement panel repository**

Create `src/main/storage/postgres/PostgresPanelsRepository.ts` with CRUD, genes, active panel state, gene list, and region file methods. Use transactions for replace operations.

- [ ] **Step 3: Route handlers**

Modify `panels.ts` and `gene-lists.ts` so PostgreSQL sessions call the PostgreSQL repository. Gene reference validation may stay local if it uses app resource DB rather than workspace data.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-panels-repository.test.ts tests/main/handlers/panels-logic.test.ts`

Expected: PASS.

## Task 4: Filter presets and analysis groups parity

- [ ] **Step 1: Decide storage scope**

Document decision in `.planning/artifacts/postgres-parity/workflow-scope-decisions.md`:

```md
# Workflow Scope Decisions

| Domain | Scope | Rationale |
| --- | --- | --- |
| Filter presets | workspace | Presets encode variant filters tied to case/workspace data. |
| Audit log | workspace | Clinical/research audit trail should follow data workspace. |
```

- [ ] **Step 2: Implement filter presets repository**

Create `PostgresFilterPresetsRepository` with list/create/update/delete/reorder matching existing handler behavior.

- [ ] **Step 3: Implement analysis groups repository**

Create `PostgresAnalysisGroupsRepository` with CRUD and membership methods.

- [ ] **Step 4: Route handlers**

Modify `filter-presets.ts` and `analysis-groups.ts` to route PostgreSQL through repositories.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-filter-presets-repository.test.ts tests/main/storage/postgres-analysis-groups-repository.test.ts`

Expected: PASS.

## Task 5: Update capabilities and commit

- [ ] **Step 1: Update PostgreSQL capabilities**

Set workflow flags to true only for implemented domains:

```ts
workflow: {
  tags: true,
  annotations: true,
  caseComments: true,
  caseMetrics: true,
  filterPresets: true,
  panels: true,
  geneLists: true,
  regionFiles: true,
  analysisGroups: true,
  auditLog: false
}
```

- [ ] **Step 2: Commit**

Run:

```bash
git add src/main/storage/postgres src/main/storage/read-executor.ts src/main/storage/write-executor.ts src/main/ipc/handlers/tags.ts src/main/ipc/handlers/annotations.ts src/main/ipc/handlers/case-comments.ts src/main/ipc/handlers/case-metrics.ts src/main/ipc/handlers/panels.ts src/main/ipc/handlers/gene-lists.ts src/main/ipc/handlers/filter-presets.ts src/main/ipc/handlers/analysis-groups.ts tests/main/storage/postgres-*.test.ts .planning/artifacts/postgres-parity/workflow-scope-decisions.md
git commit -m "feat(postgres): add workflow domain parity"
```
