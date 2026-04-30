# PostgreSQL Clinical Filter Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make PostgreSQL case-level variant queries support the clinical filters currently rejected by `PostgresVariantReadRepository`.

**Architecture:** Keep SQL generation in `src/main/storage/postgres/PostgresVariantReadRepository.ts`, split filter SQL helpers into a focused file if the repository becomes hard to review, and match SQLite `VariantFilterBuilder` semantics. Capabilities are flipped only after tests prove each filter works.

**Tech Stack:** TypeScript, Vitest, PostgreSQL SQL fragments via `pg` parameter arrays, existing storage capability system.

---

## File Structure

- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts`
  - Remove rejections for implemented filters.
  - Add SQL predicates for tags, starred/comment/ACMG annotation scope, panel intervals, inheritance, analysis groups, and accepted no-op `consider_phasing`.
- Create: `src/main/storage/postgres/postgres-variant-clinical-filter-sql.ts`
  - Holds clinical filter SQL helpers so `PostgresVariantReadRepository.ts` stays focused on base query assembly.
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
  - Flip implemented `POSTGRES_CAPABILITIES.variants.*` flags to `true`.
- Modify: `.planning/artifacts/postgres-parity/capability-matrix.md`
  - Mark implemented variant filter rows as PostgreSQL `yes`.
- Modify: `tests/main/storage/postgres-variant-read-repository.test.ts`
  - Replace rejection tests with SQL generation tests.
- Create: `tests/main/storage/postgres-variant-clinical-filters.test.ts`
  - Focused tests for clinical filter SQL fragments.
- Modify: `tests/main/storage/backend-capabilities.test.ts`
  - Lock the new PostgreSQL capability values.

## Task 1: Convert Rejection Tests Into Failing Parity Tests

- [x] **Step 1: Replace unsupported-filter rejection cases**

In `tests/main/storage/postgres-variant-read-repository.test.ts`, replace the `rejects unsupported postgres variant filter` table with cases that expect a query to be generated and executed:

```ts
it.each([
  ['tag_ids', { tag_ids: [1] }, 'variant_tags'],
  ['starred_only', { starred_only: true }, 'case_variant_annotations'],
  ['has_comment', { has_comment: true }, 'per_case_comment'],
  ['acmg_classifications', { acmg_classifications: ['Pathogenic'] }, 'acmg_classification'],
  ['annotation_scope all', { starred_only: true, annotation_scope: 'all' }, 'variant_annotations'],
  ['active_panel_ids', { active_panel_ids: [1] }, 'case_active_panels'],
  ['inheritance_modes', { inheritance_modes: ['heterozygous'] }, 'gt_num'],
  ['analysis_group_id', { inheritance_modes: ['de_novo'], analysis_group_id: 7 }, 'analysis_group_members'],
  ['consider_phasing', { consider_phasing: true }, 'variants']
])('supports postgres variant filter %s', async (_name, filter, expectedSql) => {
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
  }
  const repository = new PostgresVariantReadRepository(pool as never, 'public')

  await expect(
    repository.queryVariants({ case_id: 1, ...filter }, 25, 0, undefined, false, false)
  ).resolves.toMatchObject({ data: [] })
  expect(pool.query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain(expectedSql)
})
```

- [x] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts`

Expected: FAIL because `PostgresVariantReadRepository` still throws `Unsupported PostgreSQL variant filter(s)`.

## Task 2: Add Clinical Filter SQL Helpers

- [x] **Step 1: Create helper file**

Create `src/main/storage/postgres/postgres-variant-clinical-filter-sql.ts` with this shape:

```ts
import type { VariantFilter } from '../../../shared/types/database'

interface ClinicalFilterSqlContext {
  schemaName: string
  addParam: (value: unknown) => string
  addWhere: (sql: string) => void
}

export function addPostgresClinicalVariantFilters(
  filter: VariantFilter,
  context: ClinicalFilterSqlContext
): void {
  addTagFilter(filter, context)
  addAnnotationFilters(filter, context)
  addPanelFilter(filter, context)
  addInheritanceFilters(filter, context)
}
```

- [x] **Step 2: Add tag filter SQL**

Add a predicate equivalent to SQLite tag filtering:

```ts
function addTagFilter(filter: VariantFilter, { schemaName, addParam, addWhere }: ClinicalFilterSqlContext): void {
  if ((filter.tag_ids?.length ?? 0) === 0) return
  const caseId = addParam(filter.case_id)
  const tagIds = addParam(filter.tag_ids)
  addWhere(`EXISTS (
    SELECT 1
    FROM ${schemaName}."variant_tags" vt
    WHERE vt.case_id = ${caseId}
      AND vt.variant_id = v.id
      AND vt.tag_id = ANY(${tagIds}::bigint[])
  )`)
}
```

- [x] **Step 3: Add annotation filter SQL**

Implement case scope and all scope:

```ts
function addAnnotationFilters(filter: VariantFilter, context: ClinicalFilterSqlContext): void {
  const { schemaName, addParam, addWhere } = context
  const scopeAll = filter.annotation_scope === 'all'

  if (filter.starred_only === true) {
    const caseId = addParam(filter.case_id)
    addWhere(scopeAll
      ? `(
          EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
            WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND cva.starred = 1)
          OR EXISTS (SELECT 1 FROM ${schemaName}."variant_annotations" va
            WHERE va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt AND va.starred = 1)
        )`
      : `EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
          WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND cva.starred = 1)`)
  }

  if (filter.has_comment === true) {
    const caseId = addParam(filter.case_id)
    addWhere(scopeAll
      ? `(
          EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
            WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND NULLIF(cva.per_case_comment, '') IS NOT NULL)
          OR EXISTS (SELECT 1 FROM ${schemaName}."variant_annotations" va
            WHERE va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt AND NULLIF(va.global_comment, '') IS NOT NULL)
        )`
      : `EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
          WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND NULLIF(cva.per_case_comment, '') IS NOT NULL)`)
  }

  if ((filter.acmg_classifications?.length ?? 0) > 0) {
    const caseId = addParam(filter.case_id)
    const classes = addParam(filter.acmg_classifications)
    addWhere(scopeAll
      ? `(
          EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
            WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND cva.acmg_classification = ANY(${classes}::text[]))
          OR EXISTS (SELECT 1 FROM ${schemaName}."variant_annotations" va
            WHERE va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt AND va.acmg_classification = ANY(${classes}::text[]))
        )`
      : `EXISTS (SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
          WHERE cva.case_id = ${caseId} AND cva.variant_id = v.id AND cva.acmg_classification = ANY(${classes}::text[]))`)
  }
}
```

- [x] **Step 4: Add panel filter SQL**

Support resolved intervals first, then active panel genes:

```ts
function addPanelFilter(filter: VariantFilter, { schemaName, addParam, addWhere }: ClinicalFilterSqlContext): void {
  if ((filter.panel_intervals?.length ?? 0) > 0) {
    const clauses = filter.panel_intervals!.map((interval) => {
      const chr = addParam(interval.chr)
      const start = addParam(interval.start)
      const end = addParam(interval.end)
      return `(v.chr = ${chr} AND v.pos <= ${end} AND COALESCE(v.end_pos, v.pos) >= ${start})`
    })
    addWhere(`(${clauses.join(' OR ')})`)
    return
  }

  if ((filter.active_panel_ids?.length ?? 0) === 0) return
  const panelIds = addParam(filter.active_panel_ids)
  addWhere(`EXISTS (
    SELECT 1
    FROM ${schemaName}."panel_genes" pg
    WHERE pg.panel_id = ANY(${panelIds}::bigint[])
      AND pg.symbol = v.gene_symbol
  )`)
}
```

- [x] **Step 5: Add inheritance and analysis-group SQL**

Port SQLite genotype predicates to PostgreSQL. The required solo predicates are:

```ts
if (modes.includes('homozygous')) conditions.push(`v.gt_num IN ('1/1', '1|1')`)
if (modes.includes('heterozygous')) conditions.push(`v.gt_num IN ('0/1', '0|1', '1|0')`)
if (modes.includes('x_hemizygous')) {
  conditions.push(`(v.chr IN ('X', 'chrX') AND v.gt_num IN ('1/1', '1|1', '1'))`)
}
```

For trio modes, use `analysis_group_members` with roles `father`, `mother`, and `proband`, matching `VariantFilterBuilder`. Use coordinate joins on `chr`, `pos`, `ref`, and `alt`.

- [x] **Step 6: Wire helpers into query builder**

In `buildPostgresVariantQueryParts`, call the helper after base filters and before column filters:

```ts
addPostgresClinicalVariantFilters(filter, {
  schemaName,
  addParam,
  addWhere
})
addPostgresColumnFilters(filter, addParam, addWhere)
```

- [x] **Step 7: Narrow unsupported assertions**

Change `assertSupportedPostgresVariantFilter` so it no longer rejects implemented filters. Keep rejection for genuinely unsupported future keys only.

- [x] **Step 8: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-variant-clinical-filters.test.ts`

Expected: PASS.

## Task 3: Flip Capabilities and Matrix

- [x] **Step 1: Update PostgreSQL variant capabilities**

In `src/main/storage/postgres/PostgresStorageSession.ts`, set:

```ts
panelFilters: true,
tagFilters: true,
commentFilters: true,
acmgFilters: true,
annotationFilters: true,
inheritanceFilters: true,
analysisGroupFilters: true,
phasingFilters: true
```

`phasingFilters` means accepted with current no-op phasing semantics, not phasing-aware compound-het logic.

- [x] **Step 2: Update capability tests**

In `tests/main/storage/backend-capabilities.test.ts`, expect these PostgreSQL flags to be `true`.

- [x] **Step 3: Update capability matrix artifact**

In `.planning/artifacts/postgres-parity/capability-matrix.md`, update:

```md
| Variants | panel filters | yes | yes | no | done |
| Variants | tag/comment/ACMG filters | yes | yes | no | done |
```

- [x] **Step 4: Run verification**

Run:

```bash
npx vitest run tests/main/storage/backend-capabilities.test.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-variant-clinical-filters.test.ts
make typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/main/storage/postgres tests/main/storage .planning/artifacts/postgres-parity/capability-matrix.md
git commit -m "feat(postgres): add clinical variant filter parity"
```
