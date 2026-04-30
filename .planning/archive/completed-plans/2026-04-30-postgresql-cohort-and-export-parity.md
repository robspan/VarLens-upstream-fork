# PostgreSQL Cohort And Export Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Enable PostgreSQL cohort query, summary, carriers, gene burden, column metadata, and cohort export.

**Architecture:** Add a PostgreSQL cohort repository behind the storage read executor. Reuse shared filter semantics where possible, stream cohort export as CSV for PostgreSQL, and keep SQLite cohort export unchanged.

**Tech Stack:** TypeScript, Vitest, PostgreSQL SQL via `pg`, `pg-query-stream`, existing IPC/storage executor contracts.

---

## File Structure

- Create: `src/main/storage/postgres/PostgresCohortRepository.ts`
  - Implements cohort query, summary, carriers, gene burden, and column metadata.
- Modify: `src/main/storage/read-executor.ts`
  - Add cohort read tasks.
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
  - Route cohort tasks to `PostgresCohortRepository`.
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
  - Instantiate the cohort repository and flip cohort/export capabilities after tests pass.
- Modify: `src/main/ipc/handlers/cohort-logic.ts`
  - Use current storage session for PostgreSQL instead of SQLite database/pool paths.
- Modify: `src/main/ipc/handlers/export.ts`
  - Route PostgreSQL cohort export through storage executor and CSV streaming.
- Modify: `src/main/ipc/handlers/export-logic.ts`
  - Add `exportPostgresCohort`.
- Create: `tests/main/storage/postgres-cohort-repository.test.ts`
  - Unit-level SQL and mapping tests.
- Modify: `tests/main/handlers/cohort-logic.test.ts`
  - PostgreSQL session routing tests.
- Modify: `tests/main/handlers/postgres-export-routing.test.ts`
  - PostgreSQL cohort export routing tests.
- Modify: `tests/main/handlers/postgres-export-logic.test.ts`
  - PostgreSQL cohort CSV streaming tests.
- Modify: `tests/main/storage/backend-capabilities.test.ts`
  - Lock cohort/export capability values.
- Modify: `.planning/artifacts/postgres-parity/capability-matrix.md`
  - Mark cohort query and cohort export as complete.

## Task 1: Add Storage Executor Cohort Tasks

- [x] **Step 1: Extend `StorageReadTask`**

In `src/main/storage/read-executor.ts`, add:

```ts
import type {
  CohortSearchParams,
  CohortSummary
} from '../../shared/types/cohort'

// Add to StorageReadTask union:
| { type: 'cohort:query'; params: [params: CohortSearchParams] }
| { type: 'cohort:summary'; params: [] }
| { type: 'cohort:columnMeta'; params: [] }
| { type: 'cohort:carriers'; params: [chr: string, pos: number, ref: string, alt: string] }
| { type: 'cohort:geneBurden'; params: [] }
| { type: 'export:cohort'; params: [params: CohortSearchParams] }
```

Remove unused imports if TypeScript reports them.

- [x] **Step 2: Run typecheck for expected failure**

Run: `make typecheck`

Expected: FAIL because `PostgresReadExecutor` does not handle the new exhaustive union members.

## Task 2: Implement PostgreSQL Cohort Repository

- [x] **Step 1: Create repository skeleton**

Create `src/main/storage/postgres/PostgresCohortRepository.ts`:

```ts
import type { Pool } from 'pg'
import QueryStream from 'pg-query-stream'
import type {
  CohortCarrier,
  CohortPaginatedResult,
  CohortSearchParams,
  CohortSummary,
  GeneBurden
} from '../../../shared/types/cohort'
import { quoteIdentifier } from './identifiers'

type QueryablePool = Pick<Pool, 'query' | 'connect'>

export class PostgresCohortRepository {
  private readonly schemaName: string

  constructor(private readonly pool: QueryablePool, schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async queryVariants(params: CohortSearchParams): Promise<CohortPaginatedResult> {
    throw new Error('Postgres cohort query not implemented')
  }

  async getSummary(): Promise<CohortSummary> {
    throw new Error('Postgres cohort summary not implemented')
  }

  async getColumnMeta(): Promise<unknown> {
    throw new Error('Postgres cohort column metadata not implemented')
  }

  async getCarriers(chr: string, pos: number, ref: string, alt: string): Promise<CohortCarrier[]> {
    throw new Error('Postgres cohort carriers not implemented')
  }

  async getGeneBurden(): Promise<GeneBurden[]> {
    throw new Error('Postgres cohort gene burden not implemented')
  }

  streamCohortRows(params: CohortSearchParams): AsyncIterable<Record<string, unknown>> {
    throw new Error('Postgres cohort export not implemented')
  }
}
```

- [x] **Step 2: Add failing repository tests**

Create `tests/main/storage/postgres-cohort-repository.test.ts` with tests that assert:

```ts
it('queries cohort variants with carrier counts and total count', async () => {
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          chr: '1',
          pos: '100',
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          carrier_count: '2',
          total_cases: '3',
          cohort_frequency: 0.666666,
          het_count: '1',
          hom_count: '1'
        }]
      })
  }
  const repo = new PostgresCohortRepository(pool as never, 'public')

  await expect(repo.queryVariants({ gene_symbol: 'BRCA1', limit: 25, offset: 0 })).resolves.toMatchObject({
    total_count: 1,
    data: [{ chr: '1', pos: 100, carrier_count: 2, total_cases: 3 }]
  })
})
```

- [x] **Step 3: Run failing tests**

Run: `npx vitest run tests/main/storage/postgres-cohort-repository.test.ts`

Expected: FAIL with `Postgres cohort query not implemented`.

- [x] **Step 4: Implement query SQL**

Build PostgreSQL cohort query from grouped variants:

```sql
SELECT
  v.chr,
  v.pos,
  v.ref,
  v.alt,
  MAX(v.gene_symbol) AS gene_symbol,
  MAX(v.cdna) AS cdna,
  MAX(v.aa_change) AS aa_change,
  COUNT(DISTINCT v.case_id)::bigint AS carrier_count,
  $totalCases::bigint AS total_cases,
  (COUNT(DISTINCT v.case_id)::double precision / NULLIF($totalCases, 0)) AS cohort_frequency,
  SUM(CASE WHEN v.gt_num IN ('0/1', '0|1', '1|0') THEN 1 ELSE 0 END)::bigint AS het_count,
  SUM(CASE WHEN v.gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END)::bigint AS hom_count,
  MAX(v.consequence) AS consequence,
  MAX(v.func) AS func,
  MAX(v.clinvar) AS clinvar,
  MIN(v.gnomad_af) AS gnomad_af,
  MAX(v.cadd) AS cadd_phred,
  MAX(v.transcript) AS transcript,
  MAX(v.omim_mim_number) AS omim_id
FROM "__schema__"."variants" v
WHERE ...
GROUP BY v.chr, v.pos, v.ref, v.alt
ORDER BY carrier_count DESC NULLS LAST, v.chr ASC, v.pos ASC, v.ref ASC, v.alt ASC
LIMIT $limit OFFSET $offset
```

Use parameter arrays only. Do not interpolate user values into SQL.

- [x] **Step 5: Implement summary, carriers, and gene burden**

Use these query shapes:

```sql
-- summary
SELECT COUNT(*)::bigint AS total_cases FROM "__schema__"."cases";
SELECT COUNT(*)::bigint AS unique_variants
FROM (
  SELECT 1 FROM "__schema__"."variants" GROUP BY chr, pos, ref, alt
) grouped;

-- carriers
SELECT c.id AS case_id, c.name AS case_name, v.gt_num, v.gq, v.dp
FROM "__schema__"."variants" v
JOIN "__schema__"."cases" c ON c.id = v.case_id
WHERE v.chr = $1 AND v.pos = $2 AND v.ref = $3 AND v.alt = $4
ORDER BY c.name;

-- gene burden
SELECT gene_symbol, COUNT(DISTINCT case_id)::bigint AS carrier_count, COUNT(*)::bigint AS variant_count
FROM "__schema__"."variants"
WHERE gene_symbol IS NOT NULL AND gene_symbol <> ''
GROUP BY gene_symbol
ORDER BY carrier_count DESC, gene_symbol ASC;
```

- [x] **Step 6: Implement column metadata**

Return the same shape used by current cohort column metadata. At minimum include base cohort columns used by `CohortTable` and numeric/string metadata for `chr`, `pos`, `gene_symbol`, `carrier_count`, `cohort_frequency`, `het_count`, `hom_count`, `consequence`, `func`, `clinvar`, `gnomad_af`, `cadd_phred`, and `transcript`.

- [x] **Step 7: Run repository tests**

Run: `npx vitest run tests/main/storage/postgres-cohort-repository.test.ts`

Expected: PASS.

## Task 3: Wire Cohort Repository Through Storage Session

- [x] **Step 1: Add repository dependency to `PostgresReadExecutor`**

In `src/main/storage/postgres/PostgresReadExecutor.ts`, add `cohort` to `PostgresReadExecutorRepositories` with methods:

```ts
cohort: Pick<
  PostgresCohortRepository,
  'queryVariants' | 'getSummary' | 'getColumnMeta' | 'getCarriers' | 'getGeneBurden' | 'streamCohortRows'
>
```

- [x] **Step 2: Handle cohort tasks**

Add switch cases:

```ts
case 'cohort:query':
  return await this.repositories.cohort.queryVariants(task.params[0])
case 'cohort:summary':
  return await this.repositories.cohort.getSummary()
case 'cohort:columnMeta':
  return await this.repositories.cohort.getColumnMeta()
case 'cohort:carriers':
  return await this.repositories.cohort.getCarriers(...task.params)
case 'cohort:geneBurden':
  return await this.repositories.cohort.getGeneBurden()
case 'export:cohort':
  return this.repositories.cohort.streamCohortRows(task.params[0])
```

- [x] **Step 3: Instantiate in `PostgresStorageSession`**

Create `const cohort = new PostgresCohortRepository(options.pool, options.config.schema)` and pass it to `PostgresReadExecutor`.

- [x] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/postgres-cohort-repository.test.ts
make typecheck
```

Expected: PASS.

## Task 4: Route Cohort IPC Through Storage Session

- [x] **Step 1: Modify cohort logic**

In `src/main/ipc/handlers/cohort-logic.ts`, where a current session exists and `session.capabilities.backend === 'postgres'`, call storage tasks:

```ts
const session = getDbManager().getCurrentSession()
if (session.capabilities.backend === 'postgres') {
  return convertBigInts(await session.getReadExecutor().execute({
    type: 'cohort:query',
    params: [cohortParams]
  }))
}
```

Apply the same pattern for summary, column metadata, carriers, and gene burden.

- [x] **Step 2: Add handler tests**

In `tests/main/handlers/cohort-logic.test.ts`, add tests with a fake PostgreSQL session to prove `cohort:query`, `cohort:summary`, `cohort:columnMeta`, `cohort:carriers`, and `cohort:geneBurden` are routed through `getReadExecutor()`.

- [x] **Step 3: Run handler tests**

Run: `npx vitest run tests/main/handlers/cohort-logic.test.ts`

Expected: PASS.

## Task 5: Add PostgreSQL Cohort Export

- [x] **Step 1: Add CSV streaming function**

In `src/main/ipc/handlers/export-logic.ts`, first extract the shared body of `exportPostgresVariants` into a private helper:

```ts
async function exportRowsToCsv(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  columns: Array<{ key: string; header: string }>,
  callbacks: ExportCallbacks,
  label: string
): Promise<ExportResult> {
  // Move the current createWriteStream/writeLine/for-await loop here.
  // Use columns instead of EXPORT_COLUMNS and label in logger messages.
}
```

Then change `exportPostgresVariants` to call `exportRowsToCsv(rows, outputFilePath, EXPORT_COLUMNS, callbacks, 'PostgreSQL export')`.

Add:

```ts
export async function exportPostgresCohort(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  return exportRowsToCsv(rows, outputFilePath, COHORT_EXPORT_COLUMNS, callbacks, 'PostgreSQL cohort export')
}
```

- [x] **Step 2: Route `export:cohort`**

In `src/main/ipc/handlers/export.ts`, detect PostgreSQL before the save dialog. Use `.csv` and call:

```ts
const rows = (await session.getReadExecutor().execute({
  type: 'export:cohort',
  params: [validated.data]
})) as AsyncIterable<Record<string, unknown>>
return await exportPostgresCohort(rows, result.filePath, exportCallbacks)
```

- [x] **Step 3: Add export tests**

Add tests proving PostgreSQL cohort export:

```ts
expect(showSaveDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  title: 'Export Cohort Variants to CSV'
}))
expect(readExecutor.execute).toHaveBeenCalledWith({
  type: 'export:cohort',
  params: [expect.any(Object)]
})
```

- [x] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/handlers/postgres-export-routing.test.ts tests/main/handlers/postgres-export-logic.test.ts tests/main/storage/postgres-cohort-repository.test.ts`

Expected: PASS.

## Task 6: Flip Capabilities, Benchmark, And Commit

- [x] **Step 1: Update capabilities**

In `src/main/storage/postgres/PostgresStorageSession.ts`, set:

```ts
cohort: {
  query: true,
  summary: true,
  rebuild: false,
  carriers: true,
  geneBurden: true,
  columnMeta: true
},
export: {
  variants: true,
  cohort: true,
  streaming: true
}
```

`rebuild` remains `false` unless this plan adds a PostgreSQL summary table and rebuild path.

- [x] **Step 2: Update capability matrix**

In `.planning/artifacts/postgres-parity/capability-matrix.md`, update:

```md
| Cohort | query | yes | yes | no | done |
| Export | cohort | yes | yes | no | done |
```

Add the export cohort row if it is absent.

- [x] **Step 3: Run focused and performance checks**

Run:

```bash
npx vitest run tests/main/storage/postgres-cohort-repository.test.ts tests/main/handlers/cohort-logic.test.ts tests/main/handlers/postgres-export-routing.test.ts tests/main/handlers/postgres-export-logic.test.ts tests/main/storage/backend-capabilities.test.ts
make typecheck
```

If a PostgreSQL test database and WGS fixture are available, run:

```bash
make pg-reset && make pg-up
VARLENS_RUN_WGS_QUERY_PERF=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts
make pg-down
```

Expected: focused tests PASS. WGS perf must not show a regression severe enough to keep cohort capability gated; if it does, add a PostgreSQL cohort summary table before flipping capabilities.

- [x] **Step 4: Commit**

```bash
git add src/main/storage src/main/ipc tests/main .planning/artifacts/postgres-parity/capability-matrix.md
git commit -m "feat(postgres): add cohort and export parity"
```
