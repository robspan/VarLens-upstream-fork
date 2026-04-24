# PostgreSQL Parity Phase 7: Variants Read Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed

**Goal:** Add PostgreSQL-backed read parity for the first variant browsing slice: schema/read model, `variants:typeCounts`, `variants:typesPresent`, `variants:geneSymbols`, initial `variants:query`, PostgreSQL FTS, and optional basic filter metadata.

**Architecture:** Extend the Phase 6 storage-session read executor rather than adding a new worker path. SQLite keeps its existing `DbPool`/`DatabaseService` behavior behind `SqliteReadExecutor`; PostgreSQL gets a focused `PostgresVariantReadRepository` with parameterized SQL, explicit unsupported-filter checks, and Docker-seeded variant fixtures. PostgreSQL FTS uses `tsvector` + GIN indexes and supports `search_query` inside `variants:query`; import/export/delete/rebuild/cohort/database-overview/renderer settings remain deferred.

**Tech Stack:** Electron 40 main IPC, TypeScript 6, `pg`, PostgreSQL Docker dev workflow, Vitest, Playwright Electron E2E, `make rebuild-node`, `make typecheck`, `make ci`

---

## Reference Documents

- Spec: `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`
- Previous phase: `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-6-case-metadata-and-cases-filters.md`
- Readiness input: `.planning/artifacts/postgres-parity-phase-6-wgs-readiness.md`
- Existing SQLite query behavior: `src/main/database/VariantRepository.ts`
- Existing SQLite filter builder: `src/main/database/VariantFilterBuilder.ts`
- Existing SQLite search behavior: `src/main/database/VariantSearchService.ts`
- IPC contract: `src/shared/ipc/domains/variants.ts`

## File Structure

### New Files

- `scripts/postgres/init-db/12-phase7-variants.sql` - PostgreSQL variant base/extension/frequency tables, indexes, FTS trigger functions, and search indexes.
- `scripts/postgres/init-db/21-phase7-seed-variants.sql` - deterministic variant seed rows for Docker validation.
- `src/main/storage/postgres/PostgresVariantReadRepository.ts` - PostgreSQL implementation of Phase 7 variant reads.
- `tests/main/storage/postgres-variant-read-repository.test.ts` - mocked `pg.Pool` tests for SQL shape, read normalization, supported filters, and unsupported filters.
- `tests/e2e/postgres-variants-schema-dev-mode.e2e.ts` - gated Docker-backed schema smoke for Phase 7 tables, seed rows, and FTS documents.
- `tests/e2e/postgres-variants-read-dev-mode.e2e.ts` - gated Docker-backed Electron E2E for Phase 7 variant reads.

### Modified Files

- `scripts/postgres/init-db/README.md` - document Phase 7 init ordering and seed scope.
- `src/main/storage/read-executor.ts` - add Phase 7 variant read tasks.
- `src/main/storage/sqlite/SqliteReadExecutor.ts` - route new tasks to existing SQLite repository or worker pool.
- `src/main/storage/postgres/PostgresReadExecutor.ts` - route new tasks to `PostgresVariantReadRepository`.
- `src/main/storage/postgres/PostgresStorageSession.ts` - construct and inject `PostgresVariantReadRepository`.
- `src/main/ipc/handlers/variants-logic.ts` - depend on `StorageSession` for Phase 7 reads.
- `src/main/ipc/handlers/variants.ts` - pass active storage session into logic functions while preserving validation.
- `src/main/ipc/domains/variants.ts` - inject `getDatabaseManager` if the handler signature needs it.
- `tests/main/storage/read-executor-contract.test.ts` - add variant read task coverage.
- `tests/main/storage/sqlite-read-executor.test.ts` - assert SQLite dispatch parity.
- `tests/main/storage/postgres-read-executor.test.ts` - assert PostgreSQL dispatch parity.
- `tests/main/storage/postgres-storage-session.test.ts` - assert repository injection.
- `tests/main/handlers/variants-logic.test.ts` - assert storage-session routing and unsupported filter behavior.
- `tests/main/handlers/variants-handlers.test.ts` - preserve IPC validation behavior.

### Explicitly Unchanged

- `src/main/workers/import-worker.ts`
- `src/main/workers/export-worker.ts`
- `src/main/workers/delete-worker.ts`
- `src/main/workers/rebuild-summary-worker.ts`
- `src/main/database/DatabaseOverviewService.ts`
- `src/main/database/CohortService.ts`
- renderer PostgreSQL settings or storage-selection UI

## Parallel Work Lanes

Use these lanes after Task 1 lands. Workers are not alone in the codebase; they must avoid reverting unrelated edits and coordinate on shared contract files.

| Lane | Can start after | Write set | Commit |
|---|---|---|---|
| A Schema/seed | Task 0 baseline | `scripts/postgres/init-db/12-phase7-variants.sql`, `21-phase7-seed-variants.sql`, README | `feat(storage): add postgres variant schema and seed` |
| B Contracts/exhaustive stubs | Task 0 baseline | `read-executor.ts`, `SqliteReadExecutor.ts`, `PostgresReadExecutor.ts`, contract tests | `test(storage): add variant read executor contracts` |
| C Small PostgreSQL reads | Tasks 1 and 2 | `PostgresVariantReadRepository.ts`, `PostgresReadExecutor.ts`, repository tests | `feat(storage): add postgres variant small reads` |
| D Query/FTS | Tasks 2 and 3 | PostgreSQL repository query helpers and tests | `feat(storage): add postgres variant query read path` |
| E IPC routing | Task 1 | variant handler logic and handler tests | `refactor(ipc): route variant reads through storage sessions` |
| F Metadata | Tasks 3, 4, and scope gate | filter options / column metadata helpers and tests | `feat(storage): add postgres variant filter metadata` |
| G Docker E2E | Tasks 2, 3, 4, and 5 | `tests/e2e/postgres-variants-schema-dev-mode.e2e.ts`, `tests/e2e/postgres-variants-read-dev-mode.e2e.ts` | `test(e2e): cover postgres variant reads` |

## Task 0: Start From a Clean Implementation Branch

**Files:**

- No source files

- [ ] **Step 1: Inspect branch and local changes**

Run:

```bash
git status --short --branch
git log --oneline -10
```

Expected:

- Existing user or generated changes are understood and not reverted.
- Work is not committed directly to `main`.

- [ ] **Step 2: Create or switch to the Phase 7 branch**

Run only if not already on an appropriate Phase 7 branch:

```bash
git switch -c feat/postgres-parity-phase-7-variants-read
```

Expected:

- Implementation commits land on `feat/postgres-parity-phase-7-variants-read`.

- [ ] **Step 3: Run current PostgreSQL baseline smoke if Docker is available**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
make pg-down
```

Expected:

- Existing PostgreSQL cases and metadata E2E pass before Phase 7 changes.
- If Docker is unavailable, record that in the implementation notes and continue with unit tests.

## Task 1: Add Variant Read Executor Contracts

**Files:**

- Modify: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/sqlite/SqliteReadExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `tests/main/storage/read-executor-contract.test.ts`

- [ ] **Step 1: Write failing contract tests**

Append this test to `tests/main/storage/read-executor-contract.test.ts`:

```ts
it('supports phase 7 variant read tasks', () => {
  const tasks = [
    { type: 'variants:typeCounts', params: [1] },
    { type: 'variants:typesPresent', params: [{ caseId: 1 }] },
    { type: 'variants:typesPresent', params: [{ caseIds: [1, 2] }] },
    { type: 'variants:geneSymbols', params: [1, 'BR', 20] },
    {
      type: 'variants:query',
      params: [{ case_id: 1, variant_type: 'snv' }, 25, 0, [{ key: 'pos', order: 'asc' }], false, true]
    },
    { type: 'variants:filterOptions', params: [1] },
    { type: 'variants:columnMeta', params: [{ caseId: 1 }, 'cadd'] }
  ] satisfies StorageReadTask[]

  expect(tasks).toHaveLength(7)
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts
```

Expected:

- FAIL because `StorageReadTask` does not include the variant tasks yet.

- [ ] **Step 3: Add the task union**

Modify `src/main/storage/read-executor.ts` to import the needed shared types and add:

```ts
import type { SortItem, VariantFilter } from '../../shared/types/database'
```

Add these union members:

```ts
  | { type: 'variants:typeCounts'; params: [caseId: number] }
  | {
      type: 'variants:typesPresent'
      params: [scope: { caseId: number } | { caseIds: number[] }]
    }
  | { type: 'variants:geneSymbols'; params: [caseId: number, query: string, limit: number] }
  | {
      type: 'variants:query'
      params: [
        filter: VariantFilter,
        limit: number,
        offset: number,
        sortBy: SortItem[] | undefined,
        skipCount: boolean,
        includeUnfilteredCount: boolean
      ]
    }
  | { type: 'variants:filterOptions'; params: [caseId: number] }
  | {
      type: 'variants:columnMeta'
      params: [scope: { caseId: number } | { caseIds: number[] }, columnKey: string]
    }
```

If TypeScript reports unused imported result types, remove only the unused imports. The contract is the task shape, not executor return typing.

- [ ] **Step 4: Add temporary exhaustive executor stubs**

Add a local helper to both `SqliteReadExecutor` and `PostgresReadExecutor`:

```ts
function deferredVariantReadTask(taskType: string): never {
  throw new Error(`${taskType} is not implemented by this storage executor yet`)
}
```

Then add temporary switch cases for every new variant read task in both executors:

```ts
case 'variants:typeCounts':
case 'variants:typesPresent':
case 'variants:geneSymbols':
case 'variants:query':
case 'variants:filterOptions':
case 'variants:columnMeta':
  return deferredVariantReadTask(task.type)
```

These stubs are intentionally temporary. They keep the commit type-safe and exhaustive while later tasks replace each backend with real dispatch. They must not be wired through IPC to PostgreSQL before the repository implementations land.

- [ ] **Step 5: Re-run contract tests**

Run:

```bash
npx vitest run tests/main/storage/read-executor-contract.test.ts
make typecheck
```

Expected:

- PASS for the contract test.
- `make typecheck` passes because both storage executors remain exhaustive.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/storage/read-executor.ts src/main/storage/sqlite/SqliteReadExecutor.ts src/main/storage/postgres/PostgresReadExecutor.ts tests/main/storage/read-executor-contract.test.ts
git commit -m "test(storage): add variant read executor contracts"
```

## Task 2: Add PostgreSQL Variant Schema and Seed

**Files:**

- Create: `scripts/postgres/init-db/12-phase7-variants.sql`
- Create: `scripts/postgres/init-db/21-phase7-seed-variants.sql`
- Modify: `scripts/postgres/init-db/README.md`
- Create: `tests/e2e/postgres-variants-schema-dev-mode.e2e.ts`

- [ ] **Step 1: Write a failing Docker schema smoke test**

Create `tests/e2e/postgres-variants-schema-dev-mode.e2e.ts`:

```ts
import { test, expect } from '@playwright/test'
import { Pool } from 'pg'

test('postgres dev schema exposes phase 7 variant read tables and seed data', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const pool = new Pool({
    connectionString:
      process.env.VARLENS_PG_URL ??
      'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
  })

  try {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
       ORDER BY table_name`,
      [
        process.env.VARLENS_PG_SCHEMA ?? 'public',
        ['variants', 'variant_frequency', 'variant_sv', 'variant_cnv', 'variant_str']
      ]
    )
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'variant_cnv',
      'variant_frequency',
      'variant_str',
      'variant_sv',
      'variants'
    ])

    const seeded = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM variants WHERE case_id = $1',
      [1]
    )
    expect(seeded.rows[0]?.count).toBe(5)

    const baseSearch = await pool.query<{ id: number }>(
      "SELECT id FROM variants WHERE search_document @@ to_tsquery('simple', 'brca1:*') ORDER BY id"
    )
    expect(baseSearch.rows.map((row) => row.id)).toContain(1)

    const strSearch = await pool.query<{ variant_id: number }>(
      "SELECT variant_id FROM variant_str WHERE search_document @@ to_tsquery('simple', 'huntington:*')"
    )
    expect(strSearch.rows.map((row) => row.variant_id)).toContain(5)

    const simpleConfig = await pool.query<{ simple: string; english: string }>(
      "SELECT to_tsvector('simple', 'RUNS')::text AS simple, to_tsvector('english', 'RUNS')::text AS english"
    )
    expect(simpleConfig.rows[0]?.simple).not.toBe(simpleConfig.rows[0]?.english)
  } finally {
    await pool.end()
  }
})
```

- [ ] **Step 2: Run the schema smoke and confirm failure**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-variants-schema-dev-mode.e2e.ts
```

Expected:

- FAIL because Phase 7 variant tables do not exist yet.

- [ ] **Step 3: Write the schema file**

Create `scripts/postgres/init-db/12-phase7-variants.sql` with:

```sql
CREATE TABLE IF NOT EXISTS variants (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  gene_symbol TEXT,
  omim_mim_number TEXT,
  consequence TEXT,
  gnomad_af DOUBLE PRECISION,
  cadd DOUBLE PRECISION,
  clinvar TEXT,
  gt_num TEXT,
  func TEXT,
  qual DOUBLE PRECISION,
  hpo_sim_score DOUBLE PRECISION,
  transcript TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_match TEXT,
  moi TEXT,
  gq DOUBLE PRECISION,
  dp BIGINT,
  ad_ref BIGINT,
  ad_alt BIGINT,
  ab DOUBLE PRECISION,
  filter TEXT,
  info_json TEXT,
  source_format TEXT,
  variant_type TEXT NOT NULL DEFAULT 'snv',
  end_pos BIGINT,
  sv_type TEXT,
  sv_length BIGINT,
  caller TEXT,
  search_document tsvector
);

CREATE TABLE IF NOT EXISTS variant_transcripts (
  id BIGSERIAL PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  gene_symbol TEXT,
  consequence TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_sim_score DOUBLE PRECISION,
  moi TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0,
  is_mane_select INTEGER,
  is_canonical INTEGER,
  UNIQUE(variant_id, transcript_id)
);

CREATE TABLE IF NOT EXISTS variant_frequency (
  chr TEXT NOT NULL,
  pos BIGINT NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  case_count BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (chr, pos, ref, alt)
);

CREATE TABLE IF NOT EXISTS variant_sv (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  sv_is_precise INTEGER,
  cipos_left BIGINT,
  cipos_right BIGINT,
  ciend_left BIGINT,
  ciend_right BIGINT,
  support BIGINT,
  coverage TEXT,
  strand TEXT,
  stdev_len DOUBLE PRECISION,
  stdev_pos DOUBLE PRECISION,
  vaf DOUBLE PRECISION,
  dr BIGINT,
  dv BIGINT,
  pe_support BIGINT,
  sr_support BIGINT,
  event_id TEXT,
  mate_id TEXT,
  search_document tsvector
);

CREATE TABLE IF NOT EXISTS variant_cnv (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  copy_number BIGINT,
  copy_number_quality BIGINT,
  homozygosity_ref DOUBLE PRECISION,
  homozygosity_alt DOUBLE PRECISION,
  sm DOUBLE PRECISION,
  bin_count BIGINT
);

CREATE TABLE IF NOT EXISTS variant_str (
  variant_id BIGINT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  repeat_id TEXT,
  variant_catalog_id TEXT,
  repeat_unit TEXT,
  display_repeat_unit TEXT,
  ref_copies DOUBLE PRECISION,
  alt_copies TEXT,
  repeat_length BIGINT,
  str_status TEXT,
  normal_max BIGINT,
  pathologic_min BIGINT,
  disease TEXT,
  inheritance_mode TEXT,
  source_display TEXT,
  rank_score TEXT,
  locus_coverage DOUBLE PRECISION,
  support_type TEXT,
  confidence_interval TEXT,
  search_document tsvector
);

CREATE OR REPLACE FUNCTION update_variants_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document :=
    to_tsvector('simple',
      concat_ws(' ', NEW.gene_symbol, NEW.consequence, NEW.omim_mim_number, NEW.func, NEW.transcript, NEW.cdna, NEW.aa_change)
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_sv_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := to_tsvector('simple', concat_ws(' ', NEW.event_id, NEW.mate_id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_str_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document :=
    to_tsvector('simple',
      concat_ws(' ', NEW.repeat_id, NEW.variant_catalog_id, NEW.repeat_unit, NEW.display_repeat_unit, NEW.str_status, NEW.disease)
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS variants_search_document_tg ON variants;
CREATE TRIGGER variants_search_document_tg
BEFORE INSERT OR UPDATE ON variants
FOR EACH ROW EXECUTE FUNCTION update_variants_search_document();

DROP TRIGGER IF EXISTS variant_sv_search_document_tg ON variant_sv;
CREATE TRIGGER variant_sv_search_document_tg
BEFORE INSERT OR UPDATE ON variant_sv
FOR EACH ROW EXECUTE FUNCTION update_variant_sv_search_document();

DROP TRIGGER IF EXISTS variant_str_search_document_tg ON variant_str;
CREATE TRIGGER variant_str_search_document_tg
BEFORE INSERT OR UPDATE ON variant_str
FOR EACH ROW EXECUTE FUNCTION update_variant_str_search_document();

CREATE INDEX IF NOT EXISTS idx_variants_case_type ON variants(case_id, variant_type);
CREATE INDEX IF NOT EXISTS idx_variants_case_gene ON variants(case_id, gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_case_pos ON variants(case_id, chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_case_consequence ON variants(case_id, consequence);
CREATE INDEX IF NOT EXISTS idx_variants_case_func ON variants(case_id, func);
CREATE INDEX IF NOT EXISTS idx_variants_coord_case ON variants(chr, pos, ref, alt, case_id);
CREATE INDEX IF NOT EXISTS idx_variants_search_document ON variants USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_variant_sv_search_document ON variant_sv USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_variant_str_search_document ON variant_str USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_vt_variant_id ON variant_transcripts(variant_id);
CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_cnv_copy_number ON variant_cnv(copy_number);
CREATE INDEX IF NOT EXISTS idx_str_repeat_id ON variant_str(repeat_id);
CREATE INDEX IF NOT EXISTS idx_str_disease ON variant_str(disease);
```

- [ ] **Step 4: Write the seed file**

Create `scripts/postgres/init-db/21-phase7-seed-variants.sql` with deterministic rows:

```sql
INSERT INTO variants
  (id, case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi, variant_type, end_pos, sv_type, sv_length, caller, source_format)
VALUES
  (1, 1, '1', 1000, 'A', 'G', 'BRCA1', '113705', 'HIGH', 0.001, 28.5, 'Pathogenic', '0/1', 'missense_variant', 99.0, 0.91, 'NM_007294.4', 'c.100A>G', 'p.Lys34Arg', 'AD', 'snv', NULL, NULL, NULL, 'vep', 'vcf'),
  (2, 1, '1', 1050, 'AT', 'A', 'BRCA2', '600185', 'MODERATE', 0.02, 18.1, 'Likely benign', '0/1', 'frameshift_variant', 87.0, 0.72, 'NM_000059.4', 'c.200delT', 'p.Val67fs', 'AD', 'indel', NULL, NULL, NULL, 'vep', 'vcf'),
  (3, 1, '2', 2000, 'N', '<DEL>', 'DMD', '310200', 'HIGH', NULL, 30.0, 'Pathogenic', '0/1', 'transcript_ablation', 80.0, 0.83, NULL, NULL, NULL, 'XR', 'sv', 2600, 'DEL', -600, 'manta', 'vcf'),
  (4, 1, '3', 3000, 'N', '<DUP>', 'PMP22', '601097', 'MODERATE', NULL, 12.2, NULL, '1/1', 'copy_number_gain', 75.0, 0.55, NULL, NULL, NULL, 'AD', 'cnv', 9000, 'DUP', 6000, 'cnvnator', 'vcf'),
  (5, 1, '4', 4000, 'CAG', '<STR>', 'HTT', '613004', 'MODERATE', NULL, 10.5, 'Pathogenic', '0/1', 'repeat_expansion', 60.0, 0.88, NULL, NULL, NULL, 'AD', 'str', 4045, NULL, NULL, 'expansionhunter', 'vcf'),
  (6, 2, '1', 1000, 'A', 'G', 'BRCA1', '113705', 'HIGH', 0.001, 28.5, 'Pathogenic', '0/1', 'missense_variant', 99.0, 0.91, 'NM_007294.4', 'c.100A>G', 'p.Lys34Arg', 'AD', 'snv', NULL, NULL, NULL, 'vep', 'vcf')
ON CONFLICT (id) DO UPDATE SET
  case_id = EXCLUDED.case_id,
  gene_symbol = EXCLUDED.gene_symbol,
  consequence = EXCLUDED.consequence,
  variant_type = EXCLUDED.variant_type;

-- Phase 7 seed uses bare chromosome names (`1`, `2`, `3`, `4`) consistently
-- so variant_frequency joins match the seeded variants literally.

INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
VALUES ('1', 1000, 'A', 'G', 2)
ON CONFLICT (chr, pos, ref, alt) DO UPDATE SET case_count = EXCLUDED.case_count;

INSERT INTO variant_sv (variant_id, support, event_id, mate_id)
VALUES (3, 12, 'MANTA_EVENT_001', 'MATE_001')
ON CONFLICT (variant_id) DO UPDATE SET support = EXCLUDED.support, event_id = EXCLUDED.event_id, mate_id = EXCLUDED.mate_id;

INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality)
VALUES (4, 4, 70)
ON CONFLICT (variant_id) DO UPDATE SET copy_number = EXCLUDED.copy_number, copy_number_quality = EXCLUDED.copy_number_quality;

INSERT INTO variant_str (variant_id, repeat_id, repeat_unit, disease, str_status)
VALUES (5, 'HTT', 'CAG', 'Huntington disease', 'pathogenic')
ON CONFLICT (variant_id) DO UPDATE SET repeat_id = EXCLUDED.repeat_id, repeat_unit = EXCLUDED.repeat_unit, disease = EXCLUDED.disease, str_status = EXCLUDED.str_status;

UPDATE cases
SET variant_count = seeded.count
FROM (
  SELECT case_id, COUNT(*)::BIGINT AS count
  FROM variants
  GROUP BY case_id
) seeded
WHERE cases.id = seeded.case_id;

SELECT setval(pg_get_serial_sequence('public.variants', 'id'), COALESCE((SELECT MAX(id) FROM variants), 1), true);
SELECT setval(pg_get_serial_sequence('public.variant_transcripts', 'id'), COALESCE((SELECT MAX(id) FROM variant_transcripts), 1), true);
```

The `setval(..., true)` calls intentionally match the Phase 6 seed pattern because these Docker scripts run after `make pg-reset` on fresh dev volumes. Do not infer a general PostgreSQL upsert/reseed strategy from this dev seed.

- [ ] **Step 5: Document init order**

Update `scripts/postgres/init-db/README.md` to include:

```markdown
- `12-phase7-variants.sql` creates read-only PostgreSQL variant tables, indexes, and FTS trigger-backed `tsvector` columns.
- `21-phase7-seed-variants.sql` seeds deterministic variant rows for gated Phase 7 E2E tests. It is not an import path.
```

- [ ] **Step 6: Validate Docker schema**

Run:

```bash
make pg-reset
make pg-up
make pg-psql
```

Inside `psql`, run:

```sql
\dt
SELECT id, gene_symbol, variant_type FROM variants ORDER BY id;
SELECT id FROM variants WHERE search_document @@ to_tsquery('simple', 'brca1:*');
SELECT variant_id FROM variant_str WHERE search_document @@ to_tsquery('simple', 'huntington:*');
```

Expected:

- Variant tables exist.
- Six seeded rows exist.
- Base and STR FTS lookups return rows.

- [ ] **Step 7: Re-run the schema smoke**

Run:

```bash
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-variants-schema-dev-mode.e2e.ts
make pg-down
```

Expected:

- PASS against the Docker PostgreSQL backend.

- [ ] **Step 8: Commit**

Run:

```bash
git add scripts/postgres/init-db/12-phase7-variants.sql scripts/postgres/init-db/21-phase7-seed-variants.sql scripts/postgres/init-db/README.md tests/e2e/postgres-variants-schema-dev-mode.e2e.ts
git commit -m "feat(storage): add postgres variant schema and seed"
```

## Task 3: Preserve SQLite Dispatch for Variant Read Tasks

**Files:**

- Modify: `src/main/storage/sqlite/SqliteReadExecutor.ts`
- Modify: `tests/main/storage/sqlite-read-executor.test.ts`

- [ ] **Step 1: Write failing SQLite executor tests**

Add tests that verify both pool and direct-service paths:

```ts
it('dispatches variant reads through the sqlite worker pool when present', async () => {
  const dbPool = { run: vi.fn().mockResolvedValue({ snv: 1 }) }
  const executor = new SqliteReadExecutor({} as never, dbPool as never)

  await expect(executor.execute({ type: 'variants:typeCounts', params: [1] })).resolves.toStrictEqual({ snv: 1 })

  expect(dbPool.run).toHaveBeenCalledWith({ type: 'variants:typeCounts', params: [1] })
})

it('dispatches variant reads to DatabaseService when no pool is present', async () => {
  const databaseService = {
    variants: {
      getVariantTypeCounts: vi.fn().mockReturnValue({ snv: 1 }),
      getVariantTypesPresent: vi.fn().mockReturnValue(new Set(['snv'])),
      getGeneSymbols: vi.fn().mockReturnValue(['BRCA1'])
    }
  }
  const executor = new SqliteReadExecutor(databaseService as never, null)

  await expect(executor.execute({ type: 'variants:typeCounts', params: [1] })).resolves.toStrictEqual({ snv: 1 })
  await expect(executor.execute({ type: 'variants:typesPresent', params: [{ caseId: 1 }] })).resolves.toStrictEqual(['snv'])
  await expect(executor.execute({ type: 'variants:geneSymbols', params: [1, 'BR', 20] })).resolves.toStrictEqual(['BRCA1'])
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/main/storage/sqlite-read-executor.test.ts
```

Expected:

- FAIL because `SqliteReadExecutor` is exhaustive and does not handle variant read tasks.

- [ ] **Step 3: Implement SQLite dispatch**

Add cases in `SqliteReadExecutor.execute()`:

```ts
case 'variants:typeCounts':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return this.databaseService.variants.getVariantTypeCounts(task.params[0])

case 'variants:typesPresent':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return Array.from(this.databaseService.variants.getVariantTypesPresent(task.params[0]))

case 'variants:geneSymbols':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return this.databaseService.variants.getGeneSymbols(task.params[0], task.params[1], task.params[2])

case 'variants:query':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return this.databaseService.variants.getVariants(...task.params)

case 'variants:filterOptions':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return this.databaseService.variants.getFilterOptions(task.params[0])

case 'variants:columnMeta':
  if (this.dbPool !== null) return await this.dbPool.run({ type: task.type, params: task.params })
  return this.databaseService.variants.getColumnMeta(task.params[0], task.params[1])
```

- [ ] **Step 4: Verify SQLite dispatch**

Run:

```bash
npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/read-executor-contract.test.ts
make typecheck
```

Expected:

- Focused tests pass.
- `make typecheck` passes because PostgreSQL still has temporary exhaustive stubs from Task 1.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/main/storage/sqlite/SqliteReadExecutor.ts tests/main/storage/sqlite-read-executor.test.ts
git commit -m "refactor(storage): route sqlite variant reads through executor"
```

## Task 4: Add PostgreSQL Small Variant Reads

**Files:**

- Create: `src/main/storage/postgres/PostgresVariantReadRepository.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `tests/main/storage/postgres-read-executor.test.ts`
- Modify: `tests/main/storage/postgres-storage-session.test.ts`
- Create: `tests/main/storage/postgres-variant-read-repository.test.ts`

- [ ] **Step 1: Write failing repository tests for small reads**

Create `tests/main/storage/postgres-variant-read-repository.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  PostgresVariantReadRepository,
  toPrefixTsQueryForTest
} from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

describe('PostgresVariantReadRepository', () => {
  it('returns variant type counts with bigint strings normalized', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { variant_type: 'snv', count: '2' },
          { variant_type: 'sv', count: '1' }
        ]
      })
    }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypeCounts(1)).resolves.toStrictEqual({ snv: 2, sv: 1 })
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/\bvariants\b/), [1])
  })

  it('returns distinct variant types for a case scope', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ variant_type: 'snv' }, { variant_type: 'str' }] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getVariantTypesPresent({ caseId: 1 })).resolves.toStrictEqual(['snv', 'str'])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('case_id = $1'), [1])
  })

  it('returns gene symbols by prefix case-insensitively', async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ gene_symbol: 'BRCA1' }] }) }
    const repository = new PostgresVariantReadRepository(pool as never, 'public')

    await expect(repository.getGeneSymbols(1, 'br', 20)).resolves.toStrictEqual(['BRCA1'])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), [1, 'br%', 20])
  })
})
```

- [ ] **Step 2: Write failing executor injection tests**

Add to `tests/main/storage/postgres-read-executor.test.ts`:

```ts
it('dispatches variant small reads to the postgres variant repository', async () => {
  const variants = {
    getVariantTypeCounts: vi.fn().mockResolvedValue({ snv: 2 }),
    getVariantTypesPresent: vi.fn().mockResolvedValue(['snv']),
    getGeneSymbols: vi.fn().mockResolvedValue(['BRCA1'])
  }
  const casesQuery = { queryCases: vi.fn() }
  const availableBuilds = { getAvailableGenomeBuilds: vi.fn() }
  const caseMetadata = {
    getCaseMetadata: vi.fn(),
    listCohortGroups: vi.fn(),
    getCohortGroupByName: vi.fn(),
    getCaseCohorts: vi.fn(),
    getCaseHpoTerms: vi.fn(),
    getCaseDataInfo: vi.fn(),
    listCaseExternalIds: vi.fn(),
    getDistinctHpoTerms: vi.fn(),
    getDistinctPlatforms: vi.fn(),
    getDistinctExternalIdTypes: vi.fn(),
    getFullCaseMetadata: vi.fn()
  }
  const executor = new PostgresReadExecutor({
    casesQuery,
    availableBuilds,
    caseMetadata,
    variants
  } as never)

  await expect(executor.execute({ type: 'variants:typeCounts', params: [1] })).resolves.toStrictEqual({ snv: 2 })
  await expect(executor.execute({ type: 'variants:typesPresent', params: [{ caseId: 1 }] })).resolves.toStrictEqual(['snv'])
  await expect(executor.execute({ type: 'variants:geneSymbols', params: [1, 'BR', 20] })).resolves.toStrictEqual(['BRCA1'])
})
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts
```

Expected:

- FAIL because the repository and executor wiring do not exist.

- [ ] **Step 4: Implement the repository small reads**

Create `src/main/storage/postgres/PostgresVariantReadRepository.ts` with the same constructor shape as other PostgreSQL repositories:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

export class PostgresVariantReadRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getVariantTypeCounts(caseId: number): Promise<Record<string, number>> {
    const result = await this.pool.query(
      `SELECT variant_type, COUNT(*)::int AS count
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
       GROUP BY variant_type
       ORDER BY variant_type`,
      [caseId]
    )
    const counts: Record<string, number> = {}
    for (const row of result.rows as Array<{ variant_type: string; count: unknown }>) {
      counts[row.variant_type] = toNumber(row.count)
    }
    return counts
  }

  async getVariantTypesPresent(scope: { caseId: number } | { caseIds: number[] }): Promise<string[]> {
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) return []
    const result =
      caseIds.length === 1
        ? await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = $1 AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds[0]]
          )
        : await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = ANY($1::bigint[]) AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds]
          )
    return (result.rows as Array<{ variant_type: string }>).map((row) => row.variant_type)
  }

  async getGeneSymbols(caseId: number, query: string, limit: number): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT gene_symbol
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
         AND gene_symbol IS NOT NULL
         AND gene_symbol ILIKE $2
       ORDER BY gene_symbol
       LIMIT $3`,
      [caseId, `${query}%`, limit]
    )
    return (result.rows as Array<{ gene_symbol: string }>).map((row) => row.gene_symbol)
  }
}
```

- [ ] **Step 5: Wire the repository into PostgreSQL executor/session**

Update `PostgresReadExecutor` repository dependencies with `variants`, then add cases for `variants:typeCounts`, `variants:typesPresent`, and `variants:geneSymbols`.

Update `PostgresStorageSession` to construct `new PostgresVariantReadRepository(options.pool, options.config.schema)` and pass it to `PostgresReadExecutor`.

- [ ] **Step 6: Verify small reads**

Run:

```bash
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
make typecheck
```

Expected:

- Focused tests pass.
- `make typecheck` passes because query and metadata tasks still have temporary exhaustive stubs.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts src/main/storage/postgres/PostgresReadExecutor.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add postgres variant small reads"
```

## Task 5: Add PostgreSQL FTS and Initial `variants:query`

**Files:**

- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts`
- Modify: `tests/main/storage/postgres-variant-read-repository.test.ts`

- [ ] **Step 1: Write failing unsupported-filter tests**

Add:

```ts
it.each([
  ['tag_ids', { tag_ids: [1] }],
  ['starred_only', { starred_only: true }],
  ['has_comment', { has_comment: true }],
  ['acmg_classifications', { acmg_classifications: ['Pathogenic'] }],
  ['annotation_scope', { annotation_scope: 'all' }],
  ['active_panel_ids', { active_panel_ids: [1] }],
  ['panel_intervals', { panel_intervals: [{ chr: '1', start: 1, end: 2 }] }],
  ['inheritance_modes', { inheritance_modes: ['de_novo'] }]
])('rejects unsupported postgres variant filter %s', async (_name, filter) => {
  const repository = new PostgresVariantReadRepository({ query: vi.fn() } as never, 'public')

  await expect(
    repository.queryVariants({ case_id: 1, ...filter }, 25, 0, undefined, false, false)
  ).rejects.toThrow('Unsupported PostgreSQL variant filter')
})
```

- [ ] **Step 2: Write failing query tests for supported behavior**

Add:

```ts
it('queries variants with supported filters, sorting, counts, and unfiltered count', async () => {
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            case_id: '1',
            chr: '1',
            pos: '1000',
            ref: 'A',
            alt: 'G',
            gene_symbol: 'BRCA1',
            variant_type: 'snv',
            internal_af: 0.5
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
  }
  const repository = new PostgresVariantReadRepository(pool as never, 'public')

  await expect(
    repository.queryVariants(
      {
        case_id: 1,
        variant_type: 'snv',
        gene_symbol: 'BRC',
        consequences: ['HIGH'],
        funcs: ['missense_variant'],
        clinvars: ['Pathogenic'],
        gnomad_af_max: 0.01,
        cadd_min: 20,
        max_internal_af: 0.6,
        search_query: 'BRCA1',
        column_filters: {
          consequence: { operator: 'in', value: ['HIGH'] },
          gene_symbol: { operator: 'like', value: 'BRC' }
        }
      },
      25,
      0,
      [{ key: 'pos', order: 'asc' }],
      false,
      true
    )
  ).resolves.toStrictEqual({
    data: [
      expect.objectContaining({
        id: 1,
        case_id: 1,
        pos: 1000,
        gene_symbol: 'BRCA1',
        variant_type: 'snv',
        internal_af: 0.5
      })
    ],
    total_count: 2,
    unfiltered_count: 5
  })

  const countSql = pool.query.mock.calls[0][0] as string
  const dataSql = pool.query.mock.calls[1][0] as string
  expect(countSql).toContain('COUNT(*)::int AS count')
  expect(dataSql).toContain('to_tsquery')
  expect(dataSql).toContain('LEFT JOIN "public"."variant_frequency"')
  expect(dataSql).toContain('COUNT(*) FROM "public"."cases"')
  expect(dataSql).toContain('EXISTS')
  expect(dataSql).toContain('"public"."variant_sv"')
  expect(dataSql).toContain('"public"."variant_str"')
  expect(dataSql).toContain('search_document @@')
  expect(dataSql).toContain('v.consequence IN')
  expect(dataSql).toContain('v.gene_symbol ILIKE')
  expect(dataSql).toContain("variant_type IN ('snv', 'indel')")
})
```

Add punctuation-heavy FTS tests so the implementation cannot emit invalid `tsquery` syntax:

```ts
it('sanitizes postgres tsquery search tokens before appending prefix operators', async () => {
  expect(toPrefixTsQueryForTest('BRCA1')).toBe('BRCA1:*')
  expect(toPrefixTsQueryForTest('chr1:1000 A>G')).toBe('chr11000:* & AG:*')
  expect(toPrefixTsQueryForTest('***')).toBe('')
})
```

Expose this helper only in tests by exporting a standalone function from the repository module, for example `toPrefixTsQueryForTest`, or by testing the generated SQL/params through `queryVariants`. Do not leave a public app-facing API solely for tests.

Add one extension projection test:

```ts
it('adds STR extension projections for str variant queries', async () => {
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: '5', case_id: '1', chr: '4', pos: '4000', ref: 'CAG', alt: '<STR>', variant_type: 'str', _str_repeat_id: 'HTT' }] })
  }
  const repository = new PostgresVariantReadRepository(pool as never, 'public')

  await repository.queryVariants({ case_id: 1, variant_type: 'str' }, 25, 0, undefined, false, false)

  expect(pool.query.mock.calls[1][0]).toContain('variant_str')
  expect(pool.query.mock.calls[1][0]).toContain('_str_repeat_id')
})
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts
```

Expected:

- FAIL because query support and unsupported-filter checks do not exist.

- [ ] **Step 4: Implement explicit unsupported-filter checks**

Add a private helper:

```ts
private assertSupportedQueryFilter(filter: VariantFilter): void {
  const unsupported: string[] = []
  if ((filter.tag_ids?.length ?? 0) > 0) unsupported.push('tag_ids')
  if (filter.starred_only === true) unsupported.push('starred_only')
  if (filter.has_comment === true) unsupported.push('has_comment')
  if ((filter.acmg_classifications?.length ?? 0) > 0) unsupported.push('acmg_classifications')
  if (filter.annotation_scope !== undefined) unsupported.push('annotation_scope')
  if ((filter.active_panel_ids?.length ?? 0) > 0) unsupported.push('active_panel_ids')
  if ((filter.panel_intervals?.length ?? 0) > 0) unsupported.push('panel_intervals')
  if ((filter.inheritance_modes?.length ?? 0) > 0) unsupported.push('inheritance_modes')
  if (filter.analysis_group_id !== undefined) unsupported.push('analysis_group_id')
  if (filter.consider_phasing !== undefined) unsupported.push('consider_phasing')

  if (unsupported.length > 0) {
    throw new Error(`Unsupported PostgreSQL variant filter(s): ${unsupported.join(', ')}`)
  }
}
```

- [ ] **Step 5: Implement query SQL builder in the repository**

Add `queryVariants(...)` that:

- builds `WHERE` clauses using `$1`, `$2`, ... parameters
- always includes `v.case_id = $n`
- uses `variant_type IN ('snv', 'indel')` for SNV tab
- joins `variant_frequency vf` for `internal_af`
- computes `internal_af` as `vf.case_count::double precision / NULLIF((SELECT COUNT(*) FROM <schema>.cases), 0)`, matching SQLite semantics
- applies `max_internal_af` as `vf.case_count IS NULL OR computed_internal_af <= $n`, matching SQLite null-inclusive semantics
- supports simple `search_query` with sanitized `to_tsquery('simple', $n)` and applies it to `variants.search_document`, `variant_sv.search_document`, and `variant_str.search_document` through explicit `EXISTS` branches
- supports allowlisted base `column_filters` with `=`, `!=`, `<`, `>`, `<=`, `>=`, `like`, and `in` operators
- supports allowlisted base sort keys only
- returns normalized numbers for `id`, `case_id`, `pos`, `end_pos`, `sv_length`, `dp`, `ad_ref`, `ad_alt`, `internal_af`, and count fields

Import and adapt the existing SQLite allowlist instead of redeclaring a narrower subset:

```ts
import { BASE_SORTABLE_COLUMNS } from '../../database/VariantFilterBuilder'

const POSTGRES_BASE_SORT_COLUMNS = Object.fromEntries(
  Object.entries(BASE_SORTABLE_COLUMNS).map(([key, column]) => [key, `v.${column}`])
)
```

If a key from `BASE_SORTABLE_COLUMNS` is not valid for PostgreSQL, the implementation must add a repository test documenting the deliberate rejection. Do not silently narrow the allowlist relative to SQLite.

For FTS tokenization, add a narrow helper:

```ts
function toPrefixTsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9_]/g, ''))
    .filter((token) => token.length > 0)
    .map((token) => `${token}:*`)
    .join(' & ')
}
```

If the helper returns an empty string, skip the FTS predicate.

When translating base `column_filters`, use an allowlist that maps UI keys to SQL columns. Do not interpolate arbitrary column keys. For `like`, use `ILIKE`; for numeric range operators, preserve the SQLite default `includeEmpty !== false` behavior by adding `v.<column> IS NULL OR ...`.

- [ ] **Step 6: Wire query dispatch in `PostgresReadExecutor`**

Add:

```ts
case 'variants:query':
  return await this.repositories.variants.queryVariants(...task.params)
```

- [ ] **Step 7: Verify query tests**

Run:

```bash
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts
make typecheck
```

Expected:

- Query tests pass.
- `make typecheck` passes because metadata tasks still have temporary exhaustive stubs or explicit deferred repository methods.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts src/main/storage/postgres/PostgresReadExecutor.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts
git commit -m "feat(storage): add postgres variant query read path"
```

## Task 6: Route Variant IPC Logic Through Storage Sessions

**Files:**

- Modify: `src/main/ipc/handlers/variants-logic.ts`
- Modify: `src/main/ipc/handlers/variants.ts`
- Modify: `src/main/ipc/domains/variants.ts`
- Modify: `tests/main/handlers/variants-logic.test.ts`
- Modify: `tests/main/handlers/variants-handlers.test.ts`

- [ ] **Step 1: Write failing routing tests**

In `tests/main/handlers/variants-logic.test.ts`, add tests that use a fake session:

```ts
it('routes typeCounts through the active storage session read executor', async () => {
  const execute = vi.fn().mockResolvedValue({ snv: 2 })
  const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

  await expect(getVariantTypeCounts(1, getSession)).resolves.toStrictEqual({ snv: 2 })
  expect(execute).toHaveBeenCalledWith({ type: 'variants:typeCounts', params: [1] })
})

it('routes query through the active storage session read executor', async () => {
  const execute = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
  const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

  await queryVariants({ case_id: 1 }, 25, 0, undefined, false, false, getSession)

  expect(execute).toHaveBeenCalledWith({
    type: 'variants:query',
    params: [{ case_id: 1 }, 25, 0, undefined, false, false]
  })
})

it('does not call getDb while preparing postgres active panel filters', () => {
  const getDb = vi.fn(() => {
    throw new Error('getDb should not be called for postgres panel rejection')
  })
  const getSession = () =>
    ({
      capabilities: { backend: 'postgres' }
    }) as never

  expect(
    buildVariantFilter(1, { active_panel_ids: [1], panel_padding_bp: 50 }, getDb, undefined, getSession)
  ).toMatchObject({
    case_id: 1,
    active_panel_ids: [1],
    panel_padding_bp: 50
  })
  expect(getDb).not.toHaveBeenCalled()
})

it('fails variants:search clearly on postgres instead of calling getDb', async () => {
  const getDb = vi.fn(() => {
    throw new Error('getDb should not be called for postgres search rejection')
  })
  const getSession = () =>
    ({
      capabilities: { backend: 'postgres' }
    }) as never

  await expect(searchVariants(1, 'BRCA1', 20, getSession, getDb)).rejects.toThrow(
    'PostgreSQL variants:search is deferred from Phase 7'
  )
  expect(getDb).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/main/handlers/variants-logic.test.ts tests/main/handlers/variants-handlers.test.ts
```

Expected:

- FAIL because variant logic still depends on `getDb`/`getDbPool`.

- [ ] **Step 3: Refactor included logic functions**

Update these functions in `variants-logic.ts` to accept `getSession: () => StorageSession`:

- `queryVariants`
- `getFilterOptions`
- `searchVariants`
- `getGeneSymbols`
- `getVariantTypeCounts`
- `getColumnMetaForKey`
- `getVariantTypesPresent`

Keep `buildVariantFilter` separate. For Phase 7, add an optional `getSession?: () => StorageSession` argument. If `getSession().capabilities.backend === 'postgres'` and `active_panel_ids` are present, return the full filter unchanged so `PostgresVariantReadRepository.assertSupportedQueryFilter()` rejects `active_panel_ids` clearly. Do not call `getDb()` on PostgreSQL sessions for panel filters.

For `searchVariants`, do not leave the existing fallback path that calls `getDb()` on PostgreSQL. Add a PostgreSQL branch that throws `PostgreSQL variants:search is deferred from Phase 7` before any SQLite-only dependency is touched. SQLite behavior must continue to use the existing worker pool or `DatabaseService` path.

The read functions should call:

```ts
return await getSession().getReadExecutor().execute({
  type: 'variants:typeCounts',
  params: [caseId]
})
```

Use the matching task type and params for each function.

- [ ] **Step 4: Update handler dependency injection**

In `variants.ts`, derive:

```ts
const getSession = () => getDbManager().getCurrentSession()
```

Pass `getSession` into the refactored logic functions. Preserve all current Zod validation and `mainLogger.error(...)` calls.

In `src/main/ipc/domains/variants.ts`, pass `getDbManager` into `registerVariantHandlers` if needed.

- [ ] **Step 5: Verify handlers**

Run:

```bash
npx vitest run tests/main/handlers/variants-logic.test.ts tests/main/handlers/variants-handlers.test.ts tests/shared/types/preload-contract.test.ts
make typecheck
```

Expected:

- Handler tests pass.
- Preload contract remains unchanged.
- Typecheck passes or reports only optional metadata tasks if not implemented.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/ipc/handlers/variants-logic.ts src/main/ipc/handlers/variants.ts src/main/ipc/domains/variants.ts tests/main/handlers/variants-logic.test.ts tests/main/handlers/variants-handlers.test.ts
git commit -m "refactor(ipc): route variant reads through storage sessions"
```

## Task 7: Add Basic Filter Options and Column Metadata or Document Deferral

**Files:**

- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `tests/main/storage/postgres-variant-read-repository.test.ts`
- Optional artifact if deferred: `.planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md`

- [ ] **Step 1: Run the scope gate**

Before writing implementation, inspect the current repository size and query helper complexity:

```bash
wc -l src/main/storage/postgres/PostgresVariantReadRepository.ts
rg -n "getFilterOptions|getColumnMeta|getAllColumnMetas|getBaseColumnMeta|getExtensionColumnMeta" src/main/database/VariantRepository.ts
```

Proceed only if the implementation can stay inside `PostgresVariantReadRepository.ts` plus focused tests, without creating a broad query-builder abstraction or touching cohort domain files.

- [ ] **Step 2: If the scope gate fails, write a deferral artifact instead of code**

Create `.planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md` with:

```markdown
# PostgreSQL Phase 7 Filter Metadata Deferral

**Date:** 2026-04-24
**Decision:** Defer `variants:filterOptions` and `variants:columnMeta` from Phase 7.

## Reason

The implementation requires more than a small read-only repository helper and would expand Phase 7 beyond variant read parity.

## Required Follow-up

- Add PostgreSQL base column metadata aggregation.
- Add PostgreSQL extension column metadata aggregation.
- Decide whether cohort-scoped `caseIds` metadata belongs with variant reads or cohort parity.
- Add Docker E2E coverage after metadata is implemented.
```

Before committing, still keep the PostgreSQL executor exhaustive by adding clear unsupported paths:

```ts
async getFilterOptions(_caseId: number): Promise<never> {
  throw new Error('PostgreSQL variants:filterOptions is deferred from Phase 7')
}

async getColumnMeta(
  _scope: { caseId: number } | { caseIds: number[] },
  _columnKey: string
): Promise<never> {
  throw new Error('PostgreSQL variants:columnMeta is deferred from Phase 7')
}
```

Wire the corresponding `PostgresReadExecutor` cases to these methods so `make typecheck` remains exhaustive and callers get a clear error. Include those source changes in the deferral commit:

```bash
git add .planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md src/main/storage/postgres/PostgresVariantReadRepository.ts src/main/storage/postgres/PostgresReadExecutor.ts
git commit -m "docs(planning): defer postgres variant filter metadata"
```

Skip the remaining implementation steps in this task.

- [ ] **Step 3: Write failing metadata tests if scope gate passes**

Add:

```ts
it('returns basic filter options from base column metadata', async () => {
  const pool = {
    query: vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ consequences: ['HIGH'], funcs: ['missense_variant'], clinvars: ['Pathogenic'], min_cadd: 10, max_cadd: 30, min_gnomad_af: 0.001, max_gnomad_af: 0.02 }]
      })
      .mockResolvedValueOnce({ rows: [{ key: 'consequence', data_type: 'text', distinct_count: '1', distinct_values: ['HIGH'] }] })
  }
  const repository = new PostgresVariantReadRepository(pool as never, 'public')

  await expect(repository.getFilterOptions(1)).resolves.toMatchObject({
    consequences: ['HIGH'],
    funcs: ['missense_variant'],
    clinvars: ['Pathogenic'],
    minCadd: 10,
    maxCadd: 30,
    minGnomadAf: 0.001,
    maxGnomadAf: 0.02,
    columnMeta: [expect.objectContaining({ key: 'consequence', distinctCount: 1 })]
  })
})

it('returns base column metadata for one column', async () => {
  const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ distinct_count: '2', min: 10, max: 30 }] }) }
  const repository = new PostgresVariantReadRepository(pool as never, 'public')

  await expect(repository.getColumnMeta({ caseId: 1 }, 'cadd')).resolves.toStrictEqual({
    key: 'cadd',
    dataType: 'numeric',
    distinctCount: 2,
    min: 10,
    max: 30
  })
})
```

- [ ] **Step 4: Implement metadata helpers**

Add methods:

```ts
async getFilterOptions(caseId: number): Promise<FilterOptions>
async getColumnMeta(scope: { caseId: number } | { caseIds: number[] }, columnKey: string): Promise<ColumnFilterMeta>
```

Use allowlisted base columns and explicit extension-column mappings only. Return `{ key, dataType: 'text', distinctCount: 0 }` for unknown columns. Do not query cohort tables.

- [ ] **Step 5: Wire metadata dispatch**

Add executor cases:

```ts
case 'variants:filterOptions':
  return await this.repositories.variants.getFilterOptions(task.params[0])

case 'variants:columnMeta':
  return await this.repositories.variants.getColumnMeta(task.params[0], task.params[1])
```

- [ ] **Step 6: Verify metadata**

Run:

```bash
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts
make typecheck
```

Expected:

- Metadata tests pass if implemented.
- If deferred, the deferral artifact exists and PostgreSQL executor paths are wired only to clear deferred errors.

- [ ] **Step 7: Commit if implemented**

Run only if metadata was implemented:

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts src/main/storage/postgres/PostgresReadExecutor.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts
git commit -m "feat(storage): add postgres variant filter metadata"
```

## Task 8: Add Docker-backed PostgreSQL Variant E2E

**Files:**

- Create: `tests/e2e/postgres-variants-read-dev-mode.e2e.ts`

- [ ] **Step 1: Write the gated E2E test**

Create `tests/e2e/postgres-variants-read-dev-mode.e2e.ts`:

```ts
import { expect, test } from '@playwright/test'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

function expectSuccessfulIpcResult<T>(result: T): T {
  expect(result).not.toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      userMessage: expect.any(String)
    })
  )
  return result
}

test('postgres dev mode supports phase 7 variant reads', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const results = await launched.window.evaluate(async () => {
      return {
        typeCounts: await window.api.variants.typeCounts(1),
        typesPresent: await window.api.variants.typesPresent({ caseId: 1 }),
        geneSymbols: await window.api.variants.geneSymbols(1, 'BR', 20),
        snvQuery: await window.api.variants.query(1, { variant_type: 'snv' }, 0, 25, [{ key: 'pos', order: 'asc' }], false, true),
        baseFilterQuery: await window.api.variants.query(1, { funcs: ['missense_variant'] }, 0, 25),
        numericFilterQuery: await window.api.variants.query(1, { cadd_min: 25 }, 0, 25),
        columnFilterQuery: await window.api.variants.query(1, { column_filters: { consequence: { operator: 'in', value: ['HIGH'] } } }, 0, 25),
        internalAfQuery: await window.api.variants.query(1, { max_internal_af: 0.6 }, 0, 25),
        ftsQuery: await window.api.variants.query(1, { search_query: 'Huntington' }, 0, 25),
        coordinateQuery: await window.api.variants.query(1, { chr: '1', pos: 1000, ref: 'A', alt: 'G' }, 0, 25)
      }
    })

    expect(expectSuccessfulIpcResult(results.typeCounts)).toMatchObject({
      snv: 1,
      indel: 1,
      sv: 1,
      cnv: 1,
      str: 1
    })
    expect(expectSuccessfulIpcResult(results.typesPresent)).toEqual(['cnv', 'indel', 'snv', 'str', 'sv'])
    expect(expectSuccessfulIpcResult(results.geneSymbols)).toEqual(['BRCA1', 'BRCA2'])

    const snvQuery = expectSuccessfulIpcResult(results.snvQuery)
    expect(snvQuery).toMatchObject({
      total_count: 2,
      unfiltered_count: 5,
      data: [
        expect.objectContaining({ gene_symbol: 'BRCA1', variant_type: 'snv' }),
        expect.objectContaining({ gene_symbol: 'BRCA2', variant_type: 'indel' })
      ]
    })
    expect(snvQuery.data[0].internal_af).toBeCloseTo(2 / 3)

    expect(expectSuccessfulIpcResult(results.baseFilterQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', func: 'missense_variant' })]
    })

    expect(expectSuccessfulIpcResult(results.numericFilterQuery)).toMatchObject({
      total_count: 2,
      data: expect.arrayContaining([
        expect.objectContaining({ gene_symbol: 'BRCA1' }),
        expect.objectContaining({ gene_symbol: 'DMD' })
      ])
    })

    expect(expectSuccessfulIpcResult(results.columnFilterQuery)).toMatchObject({
      total_count: 2,
      data: expect.arrayContaining([
        expect.objectContaining({ gene_symbol: 'BRCA1' }),
        expect.objectContaining({ gene_symbol: 'DMD' })
      ])
    })

    expect(expectSuccessfulIpcResult(results.internalAfQuery)).toMatchObject({
      total_count: 4,
      data: expect.not.arrayContaining([expect.objectContaining({ gene_symbol: 'BRCA1' })])
    })

    expect(expectSuccessfulIpcResult(results.ftsQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'HTT', variant_type: 'str' })]
    })

    expect(expectSuccessfulIpcResult(results.coordinateQuery)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', pos: 1000 })]
    })
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
```

- [ ] **Step 2: Run the E2E and confirm failure if implementation is incomplete**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-variants-read-dev-mode.e2e.ts
```

Expected:

- PASS after Tasks 2-6 are complete.
- If it fails, fix the implementation or seed data. Do not loosen assertions to hide missing parity.

- [ ] **Step 3: Run existing PostgreSQL gated E2E together**

Run:

```bash
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-variants-schema-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts
make pg-down
```

Expected:

- Cases, metadata, and variant reads all pass against the same Docker backend.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/e2e/postgres-variants-read-dev-mode.e2e.ts
git commit -m "test(e2e): cover postgres variant reads"
```

## Task 9: Final Verification

**Files:**

- No planned source edits

- [ ] **Step 1: Run focused unit coverage**

Run:

```bash
make rebuild-node
npx vitest run \
  tests/main/storage/read-executor-contract.test.ts \
  tests/main/storage/sqlite-read-executor.test.ts \
  tests/main/storage/postgres-read-executor.test.ts \
  tests/main/storage/postgres-storage-session.test.ts \
  tests/main/storage/postgres-variant-read-repository.test.ts \
  tests/main/handlers/variants-logic.test.ts \
  tests/main/handlers/variants-handlers.test.ts \
  tests/shared/types/preload-contract.test.ts
```

Expected:

- All focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
make typecheck
```

Expected:

- PASS.

- [ ] **Step 3: Run Docker validation if Docker is available**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-variants-schema-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts
make pg-down
```

Expected:

- PASS. If Docker is unavailable, state that Docker-backed validation was not run.

- [ ] **Step 4: Run local minimum CI**

Run:

```bash
make ci
```

Expected:

- PASS before claiming Phase 7 implementation complete.

## Scope Guardrails

- Do not implement PostgreSQL import/export/delete/rebuild in this phase.
- Do not implement `cohort:*` channels.
- Do not implement `database:overview`.
- Do not expose renderer PostgreSQL settings.
- Do not silently ignore unsupported filters.
- Do not add `console.*` calls.
- Do not weaken Electron security settings.
- Do not commit generated `.planning/artifacts/perf/phase1/` output.
