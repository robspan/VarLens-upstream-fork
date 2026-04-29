# PostgreSQL Variant Filter Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PostgreSQL variant filter metadata and high-value clinical filters so single-case PostgreSQL variant browsing matches SQLite for core workflows.

**Architecture:** Extend `PostgresVariantReadRepository` with metadata queries and joins for tags, comments, annotations/ACMG, panels, inheritance, and analysis groups. Keep query construction parameterized and add targeted tests for every previously rejected filter.

**Tech Stack:** TypeScript, PostgreSQL, `pg`, Vitest, existing `VariantFilter` and storage read executor patterns.

---

## Files

- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts`
- Create: `src/main/storage/postgres/postgres-variant-columns.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `tests/main/storage/postgres-variant-read-repository.test.ts`
- Create: `tests/main/storage/postgres-variant-filter-options.test.ts`
- Create: `tests/main/storage/postgres-variant-clinical-filters.test.ts`
- Modify: `.planning/artifacts/postgres-parity/capability-matrix.md`

## Task 1: Implement `variants:filterOptions`

- [ ] **Step 1: Write failing tests**

Create `tests/main/storage/postgres-variant-filter-options.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('PostgresVariantReadRepository filter options', () => {
  it('returns distinct core filter values for a case', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('DISTINCT consequence')) return { rows: [{ consequence: 'HIGH' }] }
      if (sql.includes('DISTINCT func')) return { rows: [{ func: 'stop_gained' }] }
      if (sql.includes('DISTINCT clinvar')) return { rows: [{ clinvar: 'Pathogenic' }] }
      if (sql.includes('MIN(gnomad_af)')) {
        return { rows: [{ min_gnomad_af: 0.01, max_gnomad_af: 0.2, min_cadd: 10, max_cadd: 35 }] }
      }
      return { rows: [] }
    })
    const repo = new PostgresVariantReadRepository({ query } as never, 'public')

    await expect(repo.getFilterOptions(1)).resolves.toMatchObject({
      consequences: ['HIGH'],
      funcs: ['stop_gained'],
      clinvars: ['Pathogenic']
    })
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/main/storage/postgres-variant-filter-options.test.ts`

Expected: FAIL with `PostgreSQL variants:filterOptions is deferred from Phase 7`.

- [ ] **Step 3: Implement filter options**

Modify `PostgresVariantReadRepository.getFilterOptions`:

```ts
async getFilterOptions(caseId: number): Promise<unknown> {
  const [consequences, funcs, clinvars, ranges] = await Promise.all([
    this.pool.query(
      `SELECT DISTINCT consequence FROM ${this.schemaName}."variants" WHERE case_id = $1 AND consequence IS NOT NULL ORDER BY consequence`,
      [caseId]
    ),
    this.pool.query(
      `SELECT DISTINCT func FROM ${this.schemaName}."variants" WHERE case_id = $1 AND func IS NOT NULL ORDER BY func`,
      [caseId]
    ),
    this.pool.query(
      `SELECT DISTINCT clinvar FROM ${this.schemaName}."variants" WHERE case_id = $1 AND clinvar IS NOT NULL ORDER BY clinvar`,
      [caseId]
    ),
    this.pool.query(
      `SELECT MIN(gnomad_af) AS min_gnomad_af, MAX(gnomad_af) AS max_gnomad_af,
              MIN(cadd) AS min_cadd, MAX(cadd) AS max_cadd
       FROM ${this.schemaName}."variants" WHERE case_id = $1`,
      [caseId]
    )
  ])

  const rangeRow = ranges.rows[0] ?? {}
  return {
    consequences: consequences.rows.map((row: { consequence: string }) => row.consequence),
    funcs: funcs.rows.map((row: { func: string }) => row.func),
    clinvars: clinvars.rows.map((row: { clinvar: string }) => row.clinvar),
    ranges: {
      gnomad_af: { min: rangeRow.min_gnomad_af ?? null, max: rangeRow.max_gnomad_af ?? null },
      cadd: { min: rangeRow.min_cadd ?? null, max: rangeRow.max_cadd ?? null }
    }
  }
}
```

Adjust returned property names to match SQLite `VariantRepository.getFilterOptions` exactly. If the focused test reveals mismatched shape, update the test to the SQLite shape, not a new PostgreSQL-only shape.

- [ ] **Step 4: Run focused test**

Run: `npx vitest run tests/main/storage/postgres-variant-filter-options.test.ts`

Expected: PASS.

## Task 2: Implement `variants:columnMeta`

- [ ] **Step 1: Write tests for numeric and categorical metadata**

Extend `tests/main/storage/postgres-variant-filter-options.test.ts`:

```ts
it('returns numeric column metadata', async () => {
  const query = vi.fn(async () => ({ rows: [{ min: 1, max: 99, null_count: 2, total_count: 10 }] }))
  const repo = new PostgresVariantReadRepository({ query } as never, 'public')

  await expect(repo.getColumnMeta({ caseId: 1 }, 'cadd')).resolves.toMatchObject({
    kind: 'numeric',
    min: 1,
    max: 99,
    nullCount: 2,
    totalCount: 10
  })
})

it('returns categorical column metadata', async () => {
  const query = vi.fn(async () => ({ rows: [{ value: 'HIGH', count: 4 }] }))
  const repo = new PostgresVariantReadRepository({ query } as never, 'public')

  await expect(repo.getColumnMeta({ caseId: 1 }, 'consequence')).resolves.toMatchObject({
    kind: 'categorical',
    values: [{ value: 'HIGH', count: 4 }]
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/main/storage/postgres-variant-filter-options.test.ts`

Expected: FAIL with deferred column meta error.

- [ ] **Step 3: Create column definitions**

Create `src/main/storage/postgres/postgres-variant-columns.ts`:

```ts
export type PostgresColumnMetaKind = 'numeric' | 'categorical'

export interface PostgresVariantColumnDefinition {
  key: string
  sql: string
  kind: PostgresColumnMetaKind
}

export const POSTGRES_VARIANT_COLUMN_DEFINITIONS: Record<string, PostgresVariantColumnDefinition> = {
  cadd: { key: 'cadd', sql: 'v.cadd', kind: 'numeric' },
  gnomad_af: { key: 'gnomad_af', sql: 'v.gnomad_af', kind: 'numeric' },
  qual: { key: 'qual', sql: 'v.qual', kind: 'numeric' },
  consequence: { key: 'consequence', sql: 'v.consequence', kind: 'categorical' },
  func: { key: 'func', sql: 'v.func', kind: 'categorical' },
  clinvar: { key: 'clinvar', sql: 'v.clinvar', kind: 'categorical' },
  'cnv.copy_number': { key: 'cnv.copy_number', sql: 'cnv.copy_number', kind: 'numeric' },
  'str.disease': { key: 'str.disease', sql: 'str_ext.disease', kind: 'categorical' },
  'sv.support': { key: 'sv.support', sql: 'sv.support', kind: 'numeric' }
}
```

- [ ] **Step 4: Implement `getColumnMeta`**

Modify `PostgresVariantReadRepository.getColumnMeta` to use definitions, build scope SQL from `caseId` or `caseIds`, join extension tables when column key starts with `sv.`, `cnv.`, or `str.`, and return the same shape as SQLite.

Use this parameter pattern:

```ts
const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
const where = `v.case_id = ANY($1::bigint[])`
```

For numeric:

```ts
SELECT MIN(${definition.sql}) AS min, MAX(${definition.sql}) AS max,
       COUNT(*) FILTER (WHERE ${definition.sql} IS NULL)::int AS null_count,
       COUNT(*)::int AS total_count
```

For categorical:

```ts
SELECT ${definition.sql} AS value, COUNT(*)::int AS count
...
WHERE ${where} AND ${definition.sql} IS NOT NULL
GROUP BY ${definition.sql}
ORDER BY count DESC, value ASC
LIMIT 200
```

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-variant-filter-options.test.ts`

Expected: PASS.

## Task 3: Add clinical filter joins

- [ ] **Step 1: Write tests for rejected filters**

Create `tests/main/storage/postgres-variant-clinical-filters.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

function repoWithQueryCapture() {
  const calls: string[] = []
  const query = vi.fn(async (sql: string) => {
    calls.push(sql)
    return { rows: sql.includes('COUNT') ? [{ count: 0 }] : [] }
  })
  return { repo: new PostgresVariantReadRepository({ query } as never, 'public'), calls }
}

describe('PostgreSQL clinical variant filters', () => {
  it('supports tag filters', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, tag_ids: [7] }, 25)
    expect(calls.join('\n')).toContain('variant_tags')
  })

  it('supports comment filters', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, has_comment: true }, 25)
    expect(calls.join('\n')).toContain('variant_annotations')
  })

  it('supports ACMG filters', async () => {
    const { repo, calls } = repoWithQueryCapture()
    await repo.queryVariants({ case_id: 1, acmg_classifications: ['Pathogenic'] }, 25)
    expect(calls.join('\n')).toContain('acmg')
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/main/storage/postgres-variant-clinical-filters.test.ts`

Expected: FAIL because filters are rejected.

- [ ] **Step 3: Implement supported filter joins**

In `assertSupportedQueryFilter`, remove filters as they are implemented.

In `queryVariants`, add `EXISTS` filters rather than unconditional joins where possible:

```ts
if ((filter.tag_ids?.length ?? 0) > 0) {
  addWhere(`EXISTS (
    SELECT 1 FROM ${this.schemaName}."variant_tags" vt
    WHERE vt.case_id = v.case_id AND vt.variant_id = v.id
      AND vt.tag_id = ANY(${addParam(filter.tag_ids)}::bigint[])
  )`)
}

if (filter.has_comment === true) {
  addWhere(`EXISTS (
    SELECT 1 FROM ${this.schemaName}."variant_annotations" va
    WHERE va.case_id = v.case_id AND va.variant_id = v.id
      AND NULLIF(TRIM(va.comment), '') IS NOT NULL
  )`)
}

if ((filter.acmg_classifications?.length ?? 0) > 0) {
  addWhere(`EXISTS (
    SELECT 1 FROM ${this.schemaName}."variant_annotations" va
    WHERE va.case_id = v.case_id AND va.variant_id = v.id
      AND va.acmg_classification = ANY(${addParam(filter.acmg_classifications)}::text[])
  )`)
}
```

Adjust table and column names to match the PostgreSQL migration schema. If those tables do not exist yet, keep these tests skipped and move implementation to the workflow-domain parity plan after migrations add the tables.

- [ ] **Step 4: Implement panel interval filter support**

If `filter.panel_intervals` is present, add an overlap condition:

```ts
if ((filter.panel_intervals?.length ?? 0) > 0) {
  const intervals = filter.panel_intervals
  const clauses = intervals.map((interval) => {
    const chr = addParam(interval.chr)
    const start = addParam(interval.start)
    const end = addParam(interval.end)
    return `(v.chr = ${chr} AND v.pos <= ${end} AND COALESCE(v.end_pos, v.pos) >= ${start})`
  })
  addWhere(`(${clauses.join(' OR ')})`)
}
```

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-variant-clinical-filters.test.ts tests/main/storage/postgres-variant-read-repository.test.ts`

Expected: PASS for filters whose backing tables exist; any not-yet-schema-backed filters must remain explicitly capability-gated.

## Task 4: Update capabilities and artifact

- [ ] **Step 1: Update capability booleans**

In `POSTGRES_CAPABILITIES`, set these to true after implementation:

```ts
variants: {
  filterOptions: true,
  columnMeta: true,
  panelFilters: true,
  tagFilters: true,
  commentFilters: true,
  acmgFilters: true,
  annotationFilters: true
}
```

Only set flags for features actually implemented and tested.

- [ ] **Step 2: Update capability matrix artifact**

Modify `.planning/artifacts/postgres-parity/capability-matrix.md` rows from `no` to `yes` for implemented filters.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts src/main/storage/postgres/postgres-variant-columns.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-variant-filter-options.test.ts tests/main/storage/postgres-variant-clinical-filters.test.ts .planning/artifacts/postgres-parity/capability-matrix.md
git commit -m "feat(postgres): add variant filter parity"
```
