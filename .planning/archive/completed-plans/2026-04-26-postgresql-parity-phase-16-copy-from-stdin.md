# PostgreSQL Parity Phase 16: VCF Import via COPY FROM STDIN — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Proposed

**Goal:** PostgreSQL VCF imports via `COPY FROM STDIN` (text format, `pg-copy-streams`), layered with `SET LOCAL synchronous_commit = OFF` per per-batch transaction and a bracket-transaction trigger-defer pattern with startup recovery shim, so PostgreSQL VCF imports become **strictly faster than SQLite** on the GIAB HG002 v4.2.1 fixture (current ratio 3.09× — PG 170.93s vs SQLite 52.88s).

**Architecture:** Net-additive at the schema level (three new `compute_*_search_document(row)` SQL functions; the three existing trigger functions rewritten to call them — no schema change). Net-replace at the worker / repository level (swap the per-batch `INSERT...SELECT...jsonb_to_recordset` path for COPY across `variants` + four extension tables; pre-reserve BIGSERIAL IDs via `nextval(pg_get_serial_sequence(...))` with explicit ordinal ordering; bracket the per-batch loop with leading DISABLE / trailing ENABLE transactions for the three FTS triggers, plus a startup recovery shim that re-enables idempotently). Per-batch `COMMIT; BEGIN;` cycle PRESERVED — load-bearing for the 1 GB heap budget on WGS. Cancellation between batches preserves Phase 9's partial-committed-state semantics. JSON path explicitly out of scope: `PostgresJsonImportRepository` is **unchanged**.

**Tech Stack:** Electron 40 main IPC, TypeScript 6, `pg` (pure JS), `pg-copy-streams` (^7.x, NEW runtime dep), `node:stream.pipeline()`, Node `worker_threads`, PostgreSQL Docker dev workflow, GIAB HG002 fixture (existing), Vitest, `fast-check` (^4.x, NEW dev dep), Playwright Electron E2E, `make rebuild-node`, `make typecheck`, `make ci`, `make ci-full`.

---

## Reference Documents

- Spec: `.planning/specs/2026-04-26-postgresql-parity-phase-16-copy-from-stdin-design.md` (locked decisions; revised after first technical review).
- Phase 9 spec (parent): `.planning/archive/completed-specs/2026-04-25-postgresql-parity-phase-9-vcf-import-and-import-worker.md`.
- Phase 9.1 spec (coord_hash): `.planning/archive/completed-specs/2026-04-25-phase-9.1-large-variant-index-design.md`.
- Phase 9 plan (template followed by this plan): `.planning/archive/completed-plans/2026-04-25-postgresql-parity-phase-9-vcf-import-and-import-worker.md`.
- Phase 7 (variant reads): `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`.
- Code review (recommends Phase 16 as Priority F): `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md`.
- Live schema: `scripts/postgres/init-db/12-phase7-variants.sql` lines 4-48 (variants table), 102-138 (variant_sv, variant_str), 139-167 (trigger functions), 169-182 (trigger declarations), 184-201 (indexes).
- Worker baseline (per-batch commit shape — load-bearing): `src/main/workers/postgres-import-worker.ts` lines 335-345.
- VCF repository baseline: `src/main/storage/postgres/PostgresVcfImportRepository.ts`.
- Cancellation contract: `tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts`.
- WGS perf comparison artifact (current baseline): `.planning/artifacts/perf/wgs-import/2026-04-26T07-01-37-561Z-comparison.md`.
- AGENTS.md WGS subsection (must be updated post-phase).

## Branch and PR

Phase 16 work lives on a dedicated branch. Per AGENTS.md, all implementation work happens on a branch and is shipped via a single PR. The spec was committed to `main` as documentation/archive housekeeping; from here on, every commit goes on the branch.

```bash
git switch -c feat/postgres-parity-phase-16-copy-from-stdin
git status --short --branch
# expect: ## feat/postgres-parity-phase-16-copy-from-stdin
```

The single PR for Phase 16 will include this plan, all source/test changes, the new SQL migration, and the post-phase AGENTS.md WGS update.

## Parallelization Plan

Use `superpowers:subagent-driven-development` after Task 5 lands (the encoder + bulk-write helper). Earlier tasks must be sequential because they establish the contract everything else uses.

| Lane | Starts after | Owned files | Notes |
|---|---|---|---|
| A — Foundation | none | `package.json` deps, branch, baseline tests | Sequential through Task 2. |
| B — Migration | Task 1 | `scripts/postgres/init-db/16-phase16-search-document-fns.sql` | Independent — additive SQL only. Can run in parallel with C/D once Task 1 lands, but must complete before Task 9 (worker changes). |
| C — Encoder | Task 2 | `src/main/storage/postgres/copy-text-encoder.ts`, `tests/storage/postgres/copy-text-encoder.test.ts` | Pure module, no other file dependencies. |
| D — Bulk-write helper | Task 5 (encoder API stable) | `src/main/storage/postgres/postgres-bulk-write.ts`, tests | Depends on C's exported types. |
| E — Repository swap | Tasks B + D | `src/main/storage/postgres/PostgresVcfImportRepository.ts`, `src/main/storage/postgres/postgres-import-columns.ts`, repo unit tests | Touches the largest TS file in scope. |
| F — Worker changes | Tasks B + E | `src/main/workers/postgres-import-worker.ts`, recovery test | Owns the bracket-transaction shape; must serialize with E through the repository call sites. |
| G — Integration tests | Task F | `tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts`, `tests/storage/postgres/postgres-import-worker.recovery.test.ts` | Docker-gated. |
| H — E2E + perf + docs | Task G | `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts`, `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts`, WGS comparison artifact, AGENTS.md | Final lane. |

Do not run two workers on `src/main/workers/postgres-import-worker.ts`, `src/main/storage/postgres/PostgresVcfImportRepository.ts`, or `src/main/storage/postgres/postgres-import-columns.ts` simultaneously.

## File Structure

### New Files

- `scripts/postgres/init-db/16-phase16-search-document-fns.sql` — Idempotent migration. Creates `compute_variants_search_document(variants)`, `compute_variant_sv_search_document(variant_sv)`, `compute_variant_str_search_document(variant_str)`. Rewrites `update_variants_search_document()`, `update_variant_sv_search_document()`, `update_variant_str_search_document()` as one-liners that delegate to the corresponding `compute_*` function. Additive only — no column / row / trigger changes.
- `src/main/storage/postgres/copy-text-encoder.ts` — Pure encoder. Per-type functions (`encodeText`, `encodeInteger`, `encodeFloat`, `encodeBoolean`, `encodeJsonb`, `encodeBytea`, `encodeArray`), the `encodeRowsToCopyText` async generator, and the `EncoderInvalidValueError` class. No `pg` import.
- `src/main/storage/postgres/postgres-bulk-write.ts` — `runBulkCopy({ client, sql, columns, rows })`. The single place in the codebase that imports `pg-copy-streams`.
- `tests/storage/postgres/copy-text-encoder.test.ts` — Boundary + `fast-check` property tests; reference COPY-text decoder lives in this file. 100 % line + 100 % branch coverage gate.
- `tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts` — Docker-gated repository integration tests for the new VCF COPY path.
- `tests/storage/postgres/postgres-import-worker.recovery.test.ts` — Postgres-gated test for the worker startup recovery shim (simulates a prior-session leak; asserts the new worker re-enables triggers).
- `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts` — Cancel mid-import; assert partial-committed-state preserved, all three triggers end up enabled, sequence has advanced.
- `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts` — 9.7 KB ALT allele + `info_json` with embedded special characters; assert round-trip.
- `tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz` — New synthetic fixture extending the existing Phase 9.1 large-allele fixture with `info_json`-style INFO fields containing newlines, CRs, tabs, and a backslash. (Reuses Phase 9.1's allele synthesis script if available; otherwise generated inline in the fixture-prep step.)

### Modified Files

- `package.json` — Add `pg-copy-streams: ^7.0.0` to `dependencies`. Add `fast-check: ^4.0.0` to `devDependencies`. (Lockfile regenerated under `.nvmrc`-pinned Node.)
- `src/main/storage/postgres/PostgresVcfImportRepository.ts` — Replace `writeVcfFile` body to use `runBulkCopy` for variants + 4 extension tables; pre-reserve IDs via the new `pg_get_serial_sequence` query; emit per-batch bulk UPDATEs for `search_document` (variants + variant_sv + variant_str) inside the per-batch transaction, scoped by the per-batch ID arrays. Public method signature unchanged. `insertExtensionRows`, `insertExtensionBatch`, and the `jsonb_to_recordset` payload construction are deleted.
- `src/main/storage/postgres/postgres-import-columns.ts` — Delete the `_RECORDSET_TYPES` constants. Add new `_COPY_COLUMNS` constants. The `variants` COPY column list **excludes** `coord_hash` (generated-always) **and** `search_document` (deferred to bulk UPDATE). The `variant_sv` and `variant_str` COPY column lists **exclude** `search_document`. The `variant_transcripts` and `variant_cnv` COPY column lists are unchanged from their existing column projection.
- `src/main/workers/postgres-import-worker.ts` — Add a startup recovery shim (idempotent ENABLE TRIGGER × 3, runs before any import). Per import: leading bracket transaction (DISABLE TRIGGER × 3, commit), per-batch loop with `SET LOCAL synchronous_commit = OFF` + the new repository call shape, trailing bracket transaction (ENABLE TRIGGER × 3, commit) inside a `try/finally`. The per-batch `COMMIT; BEGIN;` cycle at lines 340-341 (current) is **preserved**. Cancellation between batches preserves the existing partial-committed-state semantics.
- `tests/storage/postgres/postgres-vcf-import-repository.test.ts` — Drop tests of the deleted `insertExtensionRows` / `insertExtensionBatch` / `jsonb_to_recordset` payload code. Keep the case-creation, `mode: 'append'`, and Phase 9.1 large-allele tests; rewrite their write-path expectations to match the new COPY shape.
- `vitest.config.ts` — Add a per-file coverage threshold (100 % line + 100 % branch) for `src/main/storage/postgres/copy-text-encoder.ts`.
- `AGENTS.md` — WGS subsection: remove the "Phase 16 escalation" footnote and update the comparison ratio with the post-phase numbers.

### Explicitly Unchanged

- `src/main/storage/postgres/PostgresJsonImportRepository.ts` — JSON import keeps the existing Phase 8 INSERT path. JSON-on-COPY is a separate future phase.
- `src/main/workers/import-worker.ts`, `src/main/workers/import-worker-client.ts` — SQLite worker untouched.
- `src/main/import/vcf/*` — VCF parsing modules consumed unchanged.
- `src/shared/ipc/domains/import.ts` — IPC contract unchanged.
- `src/main/storage/postgres/PostgresImportExecutor.ts`, `PostgresImportWorkerClient.ts` — worker-client / executor / message contract unchanged. Only the worker's transaction-loop body changes.
- `src/main/database/*` — SQLite import path unchanged.
- `scripts/perf/compare-wgs-import.mjs` — comparison harness reused as-is.
- `.planning/code-review/CODEBASE-REVIEW-2026-04-26.md` — left as-is; the next review snapshot will incorporate Phase 16.

---

## Task 0: Branch Setup and Baseline Verification

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
git switch -c feat/postgres-parity-phase-16-copy-from-stdin
git status --short --branch
```

Expected: `## feat/postgres-parity-phase-16-copy-from-stdin`.

- [ ] **Step 2: Confirm Postgres dev container is reset**

```bash
make pg-down
make pg-reset
make pg-up
```

Expected: Postgres 15-alpine container running with the Phase 9.1 schema. `make pg-status` returns healthy.

- [ ] **Step 3: Run the focused regression baseline (current behaviour)**

```bash
make rebuild-node
npx vitest run \
  tests/storage/postgres/postgres-vcf-import-repository.test.ts \
  tests/storage/postgres/postgres-json-import-repository.test.ts \
  tests/storage/postgres/postgres-import-executor.test.ts \
  tests/main/handlers/import-logic.test.ts
```

Expected: all four pass green. They are the regression gate for Tasks 6, 7, 9.

- [ ] **Step 4: Run the existing Phase 9 E2E suite under Postgres**

```bash
make build
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-vcf-*-dev-mode.e2e.ts tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts tests/e2e/postgres-import-renderer-responsive.e2e.ts
```

Expected: the 10 Phase 9 scenarios all pass. They are the E2E gate for Task 12.

- [ ] **Step 5: Capture the pre-Phase-16 WGS baseline**

```bash
scripts/postgres/download-wgs-fixture.sh   # idempotent
make pg-reset && make pg-up
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
node scripts/perf/compare-wgs-import.mjs
make pg-down
```

Expected: a fresh comparison artifact lands in `.planning/artifacts/perf/wgs-import/`. Record the pre-Phase-16 PG and SQLite numbers in your scratch notes — these are the baseline the Task 14 measurement is compared against.

---

## Task 1: Add `pg-copy-streams` and `fast-check` Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (regenerated)

- [ ] **Step 1: Add the deps**

```bash
npm install pg-copy-streams@^7.0.0
npm install --save-dev fast-check@^4.0.0
```

Expected: `package.json` lists `pg-copy-streams` under `dependencies` and `fast-check` under `devDependencies`. `package-lock.json` is updated. No native rebuild needed (`pg-copy-streams` is pure JS).

- [ ] **Step 2: Verify `make rebuild-node` still works**

```bash
make rebuild-node
make typecheck
```

Expected: green. The new deps do not perturb the native module dual-rebuild.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add pg-copy-streams (^7) and fast-check (^4)"
```

---

## Task 2: Add Schema Migration for `compute_*_search_document` Functions

**Files:**
- Create: `scripts/postgres/init-db/16-phase16-search-document-fns.sql`

The migration is additive: it creates three `compute_*_search_document(row)` SQL functions and rewrites the three existing trigger functions to delegate to them. No column / index / trigger declaration changes. Both the trigger path and the bulk-UPDATE path will execute the same function body; drift is structurally impossible.

- [ ] **Step 1: Read the live schema to copy the exact tsvector expressions**

```bash
sed -n '139,167p' scripts/postgres/init-db/12-phase7-variants.sql
```

Expected: confirm the three `to_tsvector('simple', concat_ws(' ', NEW.<col>, ...))` expressions byte-for-byte. They get copied verbatim into the new compute_* functions.

- [ ] **Step 2: Write the migration**

```sql
-- scripts/postgres/init-db/16-phase16-search-document-fns.sql
-- Phase 16: extract trigger expressions into reusable SQL functions
-- so the bulk-UPDATE path (Phase 16) and the trigger path share a single
-- source of truth for `search_document`. Additive only: no column,
-- index, or trigger declaration changes.

CREATE OR REPLACE FUNCTION compute_variants_search_document(v variants)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', v.gene_symbol, v.consequence, v.omim_mim_number, v.func, v.transcript, v.cdna, v.aa_change)
  );
$$;

CREATE OR REPLACE FUNCTION compute_variant_sv_search_document(s variant_sv)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector('simple', concat_ws(' ', s.event_id, s.mate_id));
$$;

CREATE OR REPLACE FUNCTION compute_variant_str_search_document(t variant_str)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    concat_ws(' ', t.repeat_id, t.variant_catalog_id, t.repeat_unit, t.display_repeat_unit, t.str_status, t.disease)
  );
$$;

-- Rewrite the existing trigger functions as one-liners that delegate.
-- Behaviour is byte-for-byte identical to the original trigger functions.

CREATE OR REPLACE FUNCTION update_variants_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variants_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_sv_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variant_sv_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_variant_str_search_document()
RETURNS trigger AS $$
BEGIN
  NEW.search_document := compute_variant_str_search_document(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Apply and verify**

```bash
make pg-reset && make pg-up
psql "$VARLENS_PG_URL" -c "\df compute_variants_search_document"
psql "$VARLENS_PG_URL" -c "\df update_variants_search_document"
```

Expected: both functions exist. The migration is picked up by `init-db/` ordering (file 16 runs after 12).

- [ ] **Step 4: Round-trip equivalence smoke test (manual, before formal repo tests)**

```bash
psql "$VARLENS_PG_URL" -c "
  -- Insert a row through the trigger path (default).
  INSERT INTO cases (id, name) VALUES (1, 'phase16-smoke') ON CONFLICT (id) DO NOTHING;
  INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func)
  VALUES (1, 'chr1', 1000, 'A', 'G', 'BRCA1', 'missense_variant', 'missense');

  -- Compare the trigger-produced value against compute_*.
  SELECT v.id,
         v.search_document = compute_variants_search_document(v) AS matches
  FROM   variants v WHERE v.case_id = 1;
"
```

Expected: `matches = t` for every row. Confirms the rewritten trigger function and the compute_* function produce identical output.

- [ ] **Step 5: Cleanup**

```bash
psql "$VARLENS_PG_URL" -c "DELETE FROM variants WHERE case_id = 1; DELETE FROM cases WHERE id = 1;"
make pg-down
```

- [ ] **Step 6: Commit**

```bash
git add scripts/postgres/init-db/16-phase16-search-document-fns.sql
git commit -m "feat(postgres): extract search_document trigger expressions into reusable SQL functions"
```

---

## Task 3: Encoder Module — Boundary Tests First (Failing)

**Files:**
- Create: `tests/storage/postgres/copy-text-encoder.test.ts`

Write the boundary tests first, before any implementation. The encoder API contract is fixed by the spec ("Encoder rules" section). The tests fail until Task 4 lands the implementation.

- [ ] **Step 1: Create the test file with failing boundary tests**

```typescript
// tests/storage/postgres/copy-text-encoder.test.ts
import { describe, it, expect } from 'vitest'
import {
  encodeText,
  encodeInteger,
  encodeFloat,
  encodeBoolean,
  encodeJsonb,
  encodeBytea,
  encodeArray,
  encodeRowsToCopyText,
  EncoderInvalidValueError,
} from '../../../src/main/storage/postgres/copy-text-encoder'

describe('encodeText', () => {
  it('null → \\N', () => { expect(encodeText(null)).toBe('\\N') })
  it('undefined → \\N', () => { expect(encodeText(undefined)).toBe('\\N') })
  it('empty string → "" (empty, NOT null)', () => { expect(encodeText('')).toBe('') })
  it('plain ASCII → unchanged', () => { expect(encodeText('chr1')).toBe('chr1') })
  it('escapes backslash before other escapes', () => { expect(encodeText('a\\b')).toBe('a\\\\b') })
  it('escapes newline', () => { expect(encodeText('a\nb')).toBe('a\\nb') })
  it('escapes carriage return', () => { expect(encodeText('a\rb')).toBe('a\\rb') })
  it('escapes tab', () => { expect(encodeText('a\tb')).toBe('a\\tb') })
  it('the literal string \\N is escaped to \\\\N (still null when decoded? no — different bytes)', () => {
    expect(encodeText('\\N')).toBe('\\\\N')
  })
  it('throws EncoderInvalidValueError on U+0000', () => {
    expect(() => encodeText('a b')).toThrow(EncoderInvalidValueError)
  })
})

describe('encodeInteger', () => {
  it('null → \\N', () => { expect(encodeInteger(null)).toBe('\\N') })
  it('0 → "0"', () => { expect(encodeInteger(0)).toBe('0') })
  it('positive number → string', () => { expect(encodeInteger(42)).toBe('42') })
  it('negative number → string', () => { expect(encodeInteger(-7)).toBe('-7') })
  it('bigint → string', () => { expect(encodeInteger(9007199254740992n)).toBe('9007199254740992') })
})

describe('encodeFloat', () => {
  it('null → \\N', () => { expect(encodeFloat(null)).toBe('\\N') })
  it('0 → "0"', () => { expect(encodeFloat(0)).toBe('0') })
  it('NaN → "NaN" (Postgres float8 token)', () => { expect(encodeFloat(NaN)).toBe('NaN') })
  it('Infinity → "Infinity"', () => { expect(encodeFloat(Infinity)).toBe('Infinity') })
  it('-Infinity → "-Infinity"', () => { expect(encodeFloat(-Infinity)).toBe('-Infinity') })
})

describe('encodeBoolean', () => {
  it('null → \\N', () => { expect(encodeBoolean(null)).toBe('\\N') })
  it('true → "t"', () => { expect(encodeBoolean(true)).toBe('t') })
  it('false → "f"', () => { expect(encodeBoolean(false)).toBe('f') })
})

describe('encodeJsonb (reserved — no Phase 16 caller, but must be correct)', () => {
  it('null → \\N', () => { expect(encodeJsonb(null)).toBe('\\N') })
  it('strips U+0000 from string values', () => {
    expect(encodeJsonb({ a: 'x y' })).not.toContain(' ')
  })
  it('double-escapes backslashes so wire bytes survive COPY decoder', () => {
    // JSON.stringify({a: '\\'}) = '{"a":"\\\\"}' (a 6-char string)
    // After our double-escape, every \ becomes \\, then the COPY-text \-escape pass
    // produces the wire form below.
    expect(encodeJsonb({ a: '\\' })).toBe('{"a":"\\\\\\\\"}')
  })
})

describe('encodeBytea', () => {
  it('null → \\N', () => { expect(encodeBytea(null)).toBe('\\N') })
  it('Buffer → \\x<hex>', () => {
    expect(encodeBytea(Buffer.from([0xab, 0xcd]))).toBe('\\\\xabcd')
  })
})

describe('encodeArray', () => {
  it('null → \\N', () => { expect(encodeArray(null)).toBe('\\N') })
  it('empty array → "{}"', () => { expect(encodeArray([])).toBe('{}') })
  it('text array → escaped form', () => { expect(encodeArray(['a', 'b'])).toBe('{a,b}') })
})

describe('encodeRowsToCopyText (async generator)', () => {
  it('emits one tab-separated line per row, terminated by \\n', async () => {
    const cols = [
      { name: 'a', encoder: encodeText },
      { name: 'b', encoder: encodeInteger },
    ]
    const rows = [
      { a: 'hello', b: 1 },
      { a: 'world', b: null },
    ]
    let out = ''
    for await (const chunk of encodeRowsToCopyText(cols, rows)) {
      out += chunk.toString('utf8')
    }
    expect(out).toBe('hello\t1\nworld\t\\N\n')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/storage/postgres/copy-text-encoder.test.ts
```

Expected: import fails — module does not exist.

---

## Task 4: Encoder Module — Implementation

**Files:**
- Create: `src/main/storage/postgres/copy-text-encoder.ts`

Pure module. No `pg` import. Round-trip safe with the four canonical COPY-text escapes.

- [ ] **Step 1: Implement the module**

```typescript
// src/main/storage/postgres/copy-text-encoder.ts
//
// Pure encoders for PostgreSQL COPY ... FROM STDIN text format.
// No pg imports — fully unit-testable in isolation.

export class EncoderInvalidValueError extends Error {
  constructor(public readonly column: string | undefined, public readonly reason: string) {
    super(`COPY encoder rejected value: ${reason}${column ? ` (column ${column})` : ''}`)
    this.name = 'EncoderInvalidValueError'
  }
}

export type CopyColumnEncoder = (value: unknown) => string

const NULL_TOKEN = '\\N'

/**
 * Encodes a text value for COPY text format.
 * - null/undefined → \N
 * - empty string  → '' (NOT null)
 * - U+0000        → throws (Postgres `text` cannot store NUL)
 * - Escape order: \ first, then \n, \r, \t.
 */
export const encodeText: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value !== 'string') return encodeText(String(value))
  if (value.indexOf(' ') >= 0) {
    throw new EncoderInvalidValueError(undefined, 'U+0000 not representable in PostgreSQL text')
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export const encodeInteger: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return String(value | 0 === value ? (value | 0) : value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  return String(value)
}

export const encodeFloat: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    return String(value)
  }
  return String(value)
}

export const encodeBoolean: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  return value === true || value === 't' ? 't' : 'f'
}

/**
 * Reserved encoder — no Phase 16 caller (info_json is currently TEXT, not jsonb).
 * Documents the safe path for any future migration.
 */
export const encodeJsonb: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  let s = JSON.stringify(value)
  // Strip U+0000 — JSONB rejects it, and JSON.stringify allows it through.
  s = s.replace(/ /g, '')
  // Double-escape every backslash so the COPY decoder un-escapes back to the
  // JSON-legal form before the JSONB caster sees it.
  s = s.replace(/\\/g, '\\\\')
  // Then escape COPY's transport metacharacters.
  return s
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export const encodeBytea: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (!Buffer.isBuffer(value)) {
    throw new EncoderInvalidValueError(undefined, 'expected Buffer for bytea encoder')
  }
  return '\\\\x' + value.toString('hex')
}

export const encodeArray: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (!Array.isArray(value)) {
    throw new EncoderInvalidValueError(undefined, 'expected array for array encoder')
  }
  if (value.length === 0) return '{}'
  return '{' + value.map((v) => (v === null ? NULL : encodeText(String(v)))).join(',') + '}'
}
const NULL = 'NULL'

export interface CopyColumn {
  name: string
  encoder: CopyColumnEncoder
}

/**
 * Async generator that consumes a row producer and yields COPY text-format Buffers.
 * Each row is encoded as one line of tab-separated tokens terminated by \n.
 */
export async function* encodeRowsToCopyText(
  columns: ReadonlyArray<CopyColumn>,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): AsyncGenerator<Buffer> {
  for await (const row of rows as AsyncIterable<Record<string, unknown>>) {
    const fields: string[] = new Array(columns.length)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      try {
        fields[i] = col.encoder(row[col.name])
      } catch (err) {
        if (err instanceof EncoderInvalidValueError) {
          throw new EncoderInvalidValueError(col.name, err.reason)
        }
        throw err
      }
    }
    yield Buffer.from(fields.join('\t') + '\n', 'utf8')
  }
}
```

- [ ] **Step 2: Run, verify boundary tests pass**

```bash
npx vitest run tests/storage/postgres/copy-text-encoder.test.ts
```

Expected: all boundary tests green.

- [ ] **Step 3: Commit**

```bash
git add src/main/storage/postgres/copy-text-encoder.ts tests/storage/postgres/copy-text-encoder.test.ts
git commit -m "feat(postgres): add copy-text-encoder module with boundary tests"
```

---

## Task 5: Encoder Property Tests via `fast-check`

**Files:**
- Modify: `tests/storage/postgres/copy-text-encoder.test.ts`

Add a small reference COPY-text decoder + property tests proving `decode(encode(v)) === v` for every encoder. Filter U+0000 from the string generator for `encodeText` (which throws). For `encodeJsonb`, the property is `JSON.parse(decode(encode(v))) === stripNul(v)`.

- [ ] **Step 1: Add a JS reference decoder for COPY text format**

Add to the test file (not the production module):

```typescript
import fc from 'fast-check'

/**
 * Reference COPY text-format decoder. Mirrors Postgres' decoding rules.
 * Matches the four mandatory escapes: \\, \n, \r, \t. Treats \N as NULL.
 */
function decodeCopyText(token: string): string | null {
  if (token === '\\N') return null
  let out = ''
  let i = 0
  while (i < token.length) {
    const c = token[i]
    if (c === '\\') {
      const next = token[i + 1]
      if (next === '\\') { out += '\\'; i += 2; continue }
      if (next === 'n')  { out += '\n'; i += 2; continue }
      if (next === 'r')  { out += '\r'; i += 2; continue }
      if (next === 't')  { out += '\t'; i += 2; continue }
      // Any other backslash sequence — Postgres takes the second char literally.
      out += next ?? ''
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}
```

- [ ] **Step 2: Add property tests**

```typescript
describe('property: encodeText round-trip', () => {
  it('decode(encode(v)) === v for every non-NUL string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }).filter((s) => !s.includes(' ')),
        (s) => {
          expect(decodeCopyText(encodeText(s))).toBe(s)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('property: encodeJsonb round-trip', () => {
  it('JSON.parse(decode(encode(v))) === stripNul(v) for arbitrary JSON values', () => {
    const stripNul = (v: unknown): unknown => {
      if (typeof v === 'string') return v.replace(/ /g, '')
      if (Array.isArray(v)) return v.map(stripNul)
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[stripNul(k) as string] = stripNul(val)
        }
        return out
      }
      return v
    }
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const wire = encodeJsonb(v)
        const decoded = decodeCopyText(wire)
        if (decoded === null) return // null → \N path
        expect(JSON.parse(decoded)).toEqual(stripNul(v))
      }),
      { numRuns: 200 },
    )
  })
})

describe('property: encodeInteger / encodeFloat / encodeBoolean round-trip', () => {
  it('integers round-trip via Number(decode(encode(n)))', () => {
    fc.assert(fc.property(fc.integer(), (n) => {
      const t = encodeInteger(n)
      expect(t === '\\N' || Number(t) === n).toBe(true)
    }))
  })
  it('finite floats round-trip', () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
      const t = encodeFloat(n)
      expect(t === '\\N' || Number(t) === n).toBe(true)
    }))
  })
  it('booleans round-trip', () => {
    expect(encodeBoolean(true)).toBe('t')
    expect(encodeBoolean(false)).toBe('f')
  })
})
```

- [ ] **Step 3: Run, verify all pass**

```bash
npx vitest run tests/storage/postgres/copy-text-encoder.test.ts
```

Expected: all property tests green; ≥200 runs each.

- [ ] **Step 4: Add per-file coverage threshold**

In `vitest.config.ts`, under `coverage.thresholds`, add:

```ts
'src/main/storage/postgres/copy-text-encoder.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
```

- [ ] **Step 5: Verify coverage**

```bash
COVERAGE=1 npx vitest run --coverage tests/storage/postgres/copy-text-encoder.test.ts
```

Expected: 100 % across all four metrics on `copy-text-encoder.ts`.

- [ ] **Step 6: Commit**

```bash
git add tests/storage/postgres/copy-text-encoder.test.ts vitest.config.ts
git commit -m "test(postgres): add fast-check property tests + 100% coverage gate for copy-text-encoder"
```

---

## Task 6: Bulk-Write Helper

**Files:**
- Create: `src/main/storage/postgres/postgres-bulk-write.ts`

Single place in the codebase that imports `pg-copy-streams`. Wraps `pipeline()` over the encoder generator and the `copyFrom()` Writable. ~10 lines of body.

- [ ] **Step 1: Implement**

```typescript
// src/main/storage/postgres/postgres-bulk-write.ts
import * as stream from 'node:stream'
import { from as copyFrom } from 'pg-copy-streams'
import type { PoolClient } from 'pg'
import {
  encodeRowsToCopyText,
  type CopyColumn,
} from './copy-text-encoder'

export async function runBulkCopy(params: {
  client: Pick<PoolClient, 'query'>
  sql: string
  columns: ReadonlyArray<CopyColumn>
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
}): Promise<void> {
  // pg-copy-streams' Writable lives on top of the active query session.
  const copyStream = (params.client.query as unknown as (q: unknown) => NodeJS.WritableStream)(
    copyFrom(params.sql),
  )
  await stream.promises.pipeline(
    encodeRowsToCopyText(params.columns, params.rows),
    copyStream,
  )
}
```

- [ ] **Step 2: Smoke-test against Postgres (manual, idempotent)**

```bash
make pg-up
node --input-type=module -e "
import { Client } from 'pg';
import { runBulkCopy } from './src/main/storage/postgres/postgres-bulk-write.js';
import { encodeText, encodeInteger } from './src/main/storage/postgres/copy-text-encoder.js';

const c = new Client({ connectionString: process.env.VARLENS_PG_URL });
await c.connect();
await c.query('BEGIN');
await c.query('CREATE TEMP TABLE bulk_smoke (id int, name text)');
await runBulkCopy({
  client: c,
  sql: 'COPY bulk_smoke (id, name) FROM STDIN',
  columns: [
    { name: 'id', encoder: encodeInteger },
    { name: 'name', encoder: encodeText },
  ],
  rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b\\tc' }],
});
const r = await c.query('SELECT * FROM bulk_smoke ORDER BY id');
console.log(r.rows);
await c.query('ROLLBACK');
await c.end();
"
make pg-down
```

Expected: prints `[ { id: 1, name: 'a' }, { id: 2, name: 'b\\tc' } ]`. The smoke is for the developer's confidence; it is not committed as a test.

- [ ] **Step 3: Typecheck**

```bash
make typecheck
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/main/storage/postgres/postgres-bulk-write.ts
git commit -m "feat(postgres): add runBulkCopy helper wrapping pg-copy-streams + node:stream.pipeline"
```

---

## Task 7: New COPY Column Lists in `postgres-import-columns.ts`

**Files:**
- Modify: `src/main/storage/postgres/postgres-import-columns.ts`

Define the COPY column lists used by Phase 16. Drop the `_RECORDSET_TYPES` constants — they are unused once `jsonb_to_recordset` goes away.

- [ ] **Step 1: Read the current file**

```bash
cat src/main/storage/postgres/postgres-import-columns.ts
```

Expected: see `VARIANT_BASE_COLUMNS`, `VARIANT_TRANSCRIPT_COLUMNS`, `VARIANT_SV_COLUMNS`, `VARIANT_CNV_COLUMNS`, `VARIANT_STR_COLUMNS`, plus the `_RECORDSET_TYPES` maps.

- [ ] **Step 2: Add the new COPY column constants and remove the recordset types**

Modify the file to:

1. Keep the existing column-name constants.
2. Add new constants (alongside the existing ones) for the COPY paths:
   ```typescript
   // Phase 16 — COPY column lists.
   // The variants COPY excludes:
   //   - coord_hash       (GENERATED ALWAYS — Postgres rejects writes)
   //   - search_document  (deferred to bulk UPDATE — see Phase 16 spec)
   // The variant_sv / variant_str COPY excludes:
   //   - search_document  (deferred to bulk UPDATE)
   export const VARIANT_COPY_COLUMNS = [
     'id', 'case_id',
     ...VARIANT_BASE_COLUMNS, // chr, pos, ref, alt, gene_symbol, ... (no coord_hash, no search_document)
   ] as const
   export const VARIANT_TRANSCRIPT_COPY_COLUMNS = ['variant_id', ...VARIANT_TRANSCRIPT_COLUMNS] as const
   export const VARIANT_SV_COPY_COLUMNS  = ['variant_id', ...VARIANT_SV_COLUMNS_NO_SEARCH] as const
   export const VARIANT_CNV_COPY_COLUMNS = ['variant_id', ...VARIANT_CNV_COLUMNS] as const
   export const VARIANT_STR_COPY_COLUMNS = ['variant_id', ...VARIANT_STR_COLUMNS_NO_SEARCH] as const
   ```
   Where `VARIANT_SV_COLUMNS_NO_SEARCH` = existing `VARIANT_SV_COLUMNS` minus `search_document`, and same for `VARIANT_STR_COLUMNS_NO_SEARCH`.

3. Add a **per-column encoder map** (used by callers as `columns.map(name => ({ name, encoder: ENCODERS[name] }))`). Maps the actual column → its `CopyColumnEncoder`. Example:
   ```typescript
   import { encodeText, encodeInteger, encodeFloat, encodeBoolean, type CopyColumnEncoder } from './copy-text-encoder'

   export const VARIANT_COLUMN_ENCODERS: Record<string, CopyColumnEncoder> = {
     id: encodeInteger,
     case_id: encodeInteger,
     chr: encodeText,
     pos: encodeInteger,
     ref: encodeText,
     alt: encodeText,
     // ... continue for every column the COPY paths use
   }
   ```
   The plan-writer's reading pass enumerates every column for every table during implementation; the spec's "Schema Reality Check" identifies the column types from `12-phase7-variants.sql`.

4. Delete:
   - `VARIANT_BATCH_RECORDSET_TYPES`
   - `TRANSCRIPT_RECORDSET_TYPES`
   - `SV_RECORDSET_TYPES`
   - `CNV_RECORDSET_TYPES`
   - `STR_RECORDSET_TYPES`

- [ ] **Step 3: Update consumers (transient — Task 8 finishes this)**

Inside this commit, the deletion of `_RECORDSET_TYPES` will break `PostgresVcfImportRepository.ts` and `PostgresJsonImportRepository.ts`. The clean way:

- Apply the deletion only **after** Task 8 has replaced the VCF repository's `jsonb_to_recordset` call sites (Task 8 owns the repository swap).
- For now, **add the new COPY constants and encoder map but keep the `_RECORDSET_TYPES` constants** so this commit compiles standalone. The deletion follows in Task 8's commit.

- [ ] **Step 4: Typecheck**

```bash
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/postgres-import-columns.ts
git commit -m "feat(postgres): add COPY column lists and encoder map for variants + extension tables"
```

---

## Task 8: Repository Swap — `PostgresVcfImportRepository.writeVcfFile`

**Files:**
- Modify: `src/main/storage/postgres/PostgresVcfImportRepository.ts`
- Modify: `src/main/storage/postgres/postgres-import-columns.ts` (delete `_RECORDSET_TYPES`)
- Modify: `tests/storage/postgres/postgres-vcf-import-repository.test.ts`

Replace the `writeVcfFile` body to use COPY for variants + extensions and run scoped bulk UPDATEs for `search_document`. Public method signature unchanged. Delete `insertExtensionRows`, `insertExtensionBatch`, the `jsonb_to_recordset` payload construction, and the now-unused `_RECORDSET_TYPES` constants.

- [ ] **Step 1: Read the current `writeVcfFile` and surrounding methods to understand the existing contract**

```bash
sed -n '100,260p' src/main/storage/postgres/PostgresVcfImportRepository.ts
```

Expected: the method takes `(client, request)`, where `request.mode` is `'single-file' | 'multi-file' | 'append'`. The case-resolution / case_data_info upsert remains untouched in Phase 16; only the per-batch variant-write path changes.

- [ ] **Step 2: Replace the variant-write body**

Inside `writeVcfFile`, after the case-resolution block and before the return:

```typescript
const N = variants.length
if (N === 0) return { caseId, variantCount: 0 }

// Pre-reserve N IDs with an explicit ordinal column.
const idResult = await client.query<{ ordinal: string; id: string }>(
  `SELECT g.ord                                              AS ordinal,
          nextval(pg_get_serial_sequence($1, 'id'))::bigint  AS id
   FROM   generate_series(0, $2 - 1) AS g(ord)
   ORDER BY g.ord`,
  [`${this.schemaName}.variants`, N]
)
const variantIds: bigint[] = idResult.rows.map(r => BigInt(r.id))

// Build the per-row payload: ordinal alignment with extension rows is preserved
// because the worker already attached `{ ordinal: i, ... }` to each extension row.
const variantsRowsWithIds = variants.map((v, i) => ({
  ...v,
  id: variantIds[i],
  case_id: caseId,
}))

// COPY variants (excludes coord_hash generated, excludes search_document deferred).
await runBulkCopy({
  client,
  sql:
    `COPY ${this.schemaName}."variants" ` +
    `(${VARIANT_COPY_COLUMNS.map(quoteIdentifier).join(', ')}) ` +
    `FROM STDIN`,
  columns: VARIANT_COPY_COLUMNS.map((name) => ({ name, encoder: VARIANT_COLUMN_ENCODERS[name] })),
  rows: variantsRowsWithIds,
})

// COPY extension tables sequentially. Resolve ordinal → variant_id at iterate time.
await this.copyExtensions(client, variantIds, transcripts, sv, cnv, str)

// Per-batch scoped bulk UPDATEs for search_document.
//
// All three triggers are DISABLED at the worker level (bracket transaction
// in postgres-import-worker.ts), so these UPDATEs do NOT retrigger.
await client.query(
  `UPDATE ${this.schemaName}."variants"
   SET    search_document = compute_variants_search_document(variants)
   WHERE  id = ANY($1::bigint[])`,
  [variantIds],
)

if (sv.length > 0) {
  // Build the per-batch SV variant_id array from the resolved ordinals.
  const svVariantIds = sv
    .filter((r) => r.ordinal >= 0 && r.ordinal < variantIds.length)
    .map((r) => variantIds[r.ordinal])
  if (svVariantIds.length > 0) {
    await client.query(
      `UPDATE ${this.schemaName}."variant_sv"
       SET    search_document = compute_variant_sv_search_document(variant_sv)
       WHERE  variant_id = ANY($1::bigint[])`,
      [svVariantIds],
    )
  }
}

if (str.length > 0) {
  const strVariantIds = str
    .filter((r) => r.ordinal >= 0 && r.ordinal < variantIds.length)
    .map((r) => variantIds[r.ordinal])
  if (strVariantIds.length > 0) {
    await client.query(
      `UPDATE ${this.schemaName}."variant_str"
       SET    search_document = compute_variant_str_search_document(variant_str)
       WHERE  variant_id = ANY($1::bigint[])`,
      [strVariantIds],
    )
  }
}

return { caseId, variantCount: N, variantIds }
```

- [ ] **Step 3: Implement `copyExtensions`**

```typescript
private async copyExtensions(
  client: Pick<PoolClient, 'query'>,
  variantIds: bigint[],
  transcripts: VcfTranscriptRow[],
  svRows:      VcfSvRow[],
  cnvRows:     VcfCnvRow[],
  strRows:     VcfStrRow[],
): Promise<void> {
  const helper = async (
    table: string,
    columns: readonly string[],
    rows: ReadonlyArray<{ ordinal: number } & Record<string, unknown>>,
  ): Promise<void> => {
    if (rows.length === 0) return
    const sql =
      `COPY ${this.schemaName}.${quoteIdentifier(table)} ` +
      `(${columns.map(quoteIdentifier).join(', ')}) FROM STDIN`
    function* resolved() {
      for (const row of rows) {
        if (row.ordinal < 0 || row.ordinal >= variantIds.length) continue
        yield { variant_id: variantIds[row.ordinal], ...row }
      }
    }
    await runBulkCopy({
      client,
      sql,
      columns: columns.map((name) => ({ name, encoder: VARIANT_COLUMN_ENCODERS[name] })),
      rows: resolved(),
    })
  }
  await helper('variant_transcripts', VARIANT_TRANSCRIPT_COPY_COLUMNS, transcripts)
  await helper('variant_sv',          VARIANT_SV_COPY_COLUMNS,         svRows)
  await helper('variant_cnv',         VARIANT_CNV_COPY_COLUMNS,        cnvRows)
  await helper('variant_str',         VARIANT_STR_COPY_COLUMNS,        strRows)
}
```

- [ ] **Step 4: Delete the dead methods and the `_RECORDSET_TYPES` constants**

- Remove `insertExtensionRows`, `insertExtensionBatch`, and any `jsonb_to_recordset` helpers in `PostgresVcfImportRepository`.
- Remove `VARIANT_BATCH_RECORDSET_TYPES`, `TRANSCRIPT_RECORDSET_TYPES`, `SV_RECORDSET_TYPES`, `CNV_RECORDSET_TYPES`, `STR_RECORDSET_TYPES` from `postgres-import-columns.ts`.

- [ ] **Step 5: Update the repository unit tests**

In `tests/storage/postgres/postgres-vcf-import-repository.test.ts`:

- Remove tests asserting against `jsonb_to_recordset` payloads or `RETURNING id` ordering.
- Keep the case-creation, `mode: 'append'`, and Phase 9.1 large-allele test bodies; rewrite their write-path expectations to assert against the new COPY shape (the test mock should record COPY calls, not parse `jsonb_to_recordset` arguments).
- Add a test asserting the bulk UPDATEs use `compute_*_search_document` and `WHERE id = ANY($1)` / `WHERE variant_id = ANY($1)`.

- [ ] **Step 6: Run tests + typecheck**

```bash
npx vitest run tests/storage/postgres/postgres-vcf-import-repository.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/postgres/PostgresVcfImportRepository.ts \
        src/main/storage/postgres/postgres-import-columns.ts \
        tests/storage/postgres/postgres-vcf-import-repository.test.ts
git commit -m "feat(postgres): swap VCF import to COPY FROM STDIN with pre-reserved IDs and per-batch search_document UPDATEs"
```

---

## Task 9: Worker Changes — Bracket Transactions, `synchronous_commit`, Recovery Shim

**Files:**
- Modify: `src/main/workers/postgres-import-worker.ts`
- Modify (or stretch new tests): `tests/storage/postgres/postgres-import-worker.recovery.test.ts` (Task 10)

Add the bracket transaction shape, the per-batch `SET LOCAL synchronous_commit = OFF`, and the startup recovery shim. **Preserve the per-batch `COMMIT; BEGIN;` cycle** at lines 340-341 — load-bearing for the heap budget.

- [ ] **Step 1: Add the recovery shim at worker startup**

At the very top of the worker's start handler (before any import logic runs), execute three idempotent `ALTER TABLE ... ENABLE TRIGGER` statements in their own auto-commit transaction:

```typescript
async function recoverTriggersOnStartup(client: PoolClient, schemaName: string): Promise<void> {
  const q = quoteIdentifier
  // Auto-commit (no BEGIN). Idempotent — ENABLE TRIGGER on an already-enabled trigger is a no-op.
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    ENABLE TRIGGER variants_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" ENABLE TRIGGER variant_str_search_document_tg`,
  )
}
```

Call this after the `pg.Client` is connected and before the per-import dispatch.

- [ ] **Step 2: Bracket the per-import flow with DISABLE / ENABLE transactions**

Wrap the per-import body (single-file, multi-file, append) in:

```typescript
async function disableTriggersBeforeImport(client: PoolClient, schemaName: string): Promise<void> {
  const q = quoteIdentifier
  await client.query('BEGIN')
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    DISABLE TRIGGER variants_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  DISABLE TRIGGER variant_sv_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" DISABLE TRIGGER variant_str_search_document_tg`,
  )
  await client.query('COMMIT')
}

async function enableTriggersAfterImport(client: PoolClient, schemaName: string): Promise<void> {
  const q = quoteIdentifier
  await client.query('BEGIN')
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    ENABLE TRIGGER variants_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg`,
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" ENABLE TRIGGER variant_str_search_document_tg`,
  )
  await client.query('COMMIT')
}
```

In the per-import handler:

```typescript
await disableTriggersBeforeImport(client, schemaName)
try {
  // existing per-batch loop runs here, unchanged
} finally {
  await enableTriggersAfterImport(client, schemaName)
}
```

- [ ] **Step 3: Add `SET LOCAL synchronous_commit = OFF` to each per-batch transaction**

The `flush()` function at lines 320-345 commits and reopens the per-batch transaction:

```typescript
await client.query('COMMIT')
await client.query('BEGIN')
// NEW:
await client.query('SET LOCAL synchronous_commit = OFF')
```

Do **not** issue this in the bracket transactions — those should keep the default `synchronous_commit` so the trigger-DISABLE / trigger-ENABLE WAL records are durable.

- [ ] **Step 4: Verify the per-batch commit shape is preserved**

```bash
git diff src/main/workers/postgres-import-worker.ts | grep -E "COMMIT|BEGIN"
```

Expected: the per-batch `COMMIT; BEGIN` at the existing line numbers is intact. New COMMITs/BEGINs only appear in `disableTriggersBeforeImport` / `enableTriggersAfterImport`.

- [ ] **Step 5: Typecheck**

```bash
make typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main/workers/postgres-import-worker.ts
git commit -m "feat(workers): add bracket-transaction trigger defer + synchronous_commit lever to postgres import worker"
```

---

## Task 10: Worker Recovery Shim Test

**Files:**
- Create: `tests/storage/postgres/postgres-import-worker.recovery.test.ts`

Postgres-gated test. Simulates a prior-session leak (DISABLE × 3 with no ENABLE), launches a fresh worker, asserts triggers are re-enabled before any import work begins.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'

describe.skipIf(!RUN)('postgres-import-worker recovery shim', () => {
  let control: Client
  beforeAll(async () => {
    control = new Client({ connectionString: process.env.VARLENS_PG_URL })
    await control.connect()
  })
  afterAll(async () => {
    // Always leave triggers enabled so subsequent tests are not affected.
    await control.query('ALTER TABLE variants    ENABLE TRIGGER variants_search_document_tg')
    await control.query('ALTER TABLE variant_sv  ENABLE TRIGGER variant_sv_search_document_tg')
    await control.query('ALTER TABLE variant_str ENABLE TRIGGER variant_str_search_document_tg')
    await control.end()
  })

  it('a new worker session re-enables all three triggers idempotently', async () => {
    // Simulate prior-session leak.
    await control.query('ALTER TABLE variants    DISABLE TRIGGER variants_search_document_tg')
    await control.query('ALTER TABLE variant_sv  DISABLE TRIGGER variant_sv_search_document_tg')
    await control.query('ALTER TABLE variant_str DISABLE TRIGGER variant_str_search_document_tg')

    // Confirm disabled state.
    const before = await control.query<{ tgname: string; tgenabled: string }>(`
      SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgname IN (
        'variants_search_document_tg',
        'variant_sv_search_document_tg',
        'variant_str_search_document_tg'
      )
    `)
    expect(before.rows.every(r => r.tgenabled === 'D')).toBe(true)

    // Launch the worker (or call the recovery shim function directly if exported).
    const { spawnPostgresImportWorker } = await import(
      '../../../src/main/storage/postgres/PostgresImportWorkerClient'
    )
    const c = await spawnPostgresImportWorker({ /* config */ })
    // Wait for the worker to signal "ready" via its message contract.
    await c.ready()

    // Confirm enabled state.
    const after = await control.query<{ tgname: string; tgenabled: string }>(`
      SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgname IN (
        'variants_search_document_tg',
        'variant_sv_search_document_tg',
        'variant_str_search_document_tg'
      )
    `)
    expect(after.rows.every(r => r.tgenabled === 'O')).toBe(true)

    await c.terminate()
  })
})
```

The exact import path and `ready()` shape match what the existing `PostgresImportWorkerClient` exposes; adapt to the live API at implementation time.

- [ ] **Step 2: Run**

```bash
make pg-up
make rebuild-node
VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/storage/postgres/postgres-import-worker.recovery.test.ts
make pg-down
```

Expected: test passes against the worker change from Task 9.

- [ ] **Step 3: Commit**

```bash
git add tests/storage/postgres/postgres-import-worker.recovery.test.ts
git commit -m "test(workers): add recovery-shim test for postgres import worker"
```

---

## Task 11: Repository Integration Tests (Docker-gated)

**Files:**
- Create: `tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts`

Cover every test bullet in Spec section "Layer 2 — Repository integration tests". Gated by `VARLENS_RUN_POSTGRES_E2E=1`.

- [ ] **Step 1: Write the test file**

Implement the eight bullets from the spec, in order:

- Single-batch round-trip (every column matches).
- Multi-batch within one file (`mode: 'append'`).
- Extension-table FK integrity (variant_transcripts.variant_id matches reserved IDs).
- Trigger-defer correctness across all three tables (golden test against the OLD path on a small fixture in a temp schema).
- COPY column-list regression guard (assert `coord_hash` and `search_document` are absent from the new constants).
- `synchronous_commit` does not leak.
- HLA mega-allele round-trip (reuse the Phase 9.1 9.7 KB ALT fixture).
- Failure path (NOT NULL violation; assert rollback, triggers enabled, sequence advanced, no rows committed).

For the golden test, the safest pattern is to import the same fixture into a temp schema using a manually-restored old INSERT path (kept in git history for the duration of the phase). Compare `search_document` column-by-column for matched (variant_id) pairs.

- [ ] **Step 2: Run**

```bash
make pg-reset && make pg-up
make rebuild-node
VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts
make pg-down
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add tests/storage/postgres/postgres-vcf-import-repository.copy.test.ts
git commit -m "test(postgres): add docker-gated integration tests for VCF COPY repository path"
```

---

## Task 12: Regression — Phase 9 E2E Suite Under New Transport

**Files:** none

The 10 Phase 9 E2E scenarios must pass against the new transport with **no modifications**.

- [ ] **Step 1: Run the full Phase 9 E2E set**

```bash
make build
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test \
  tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts \
  tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts \
  tests/e2e/postgres-import-renderer-responsive.e2e.ts \
  tests/e2e/postgres-vcf-large-allele-dev-mode.e2e.ts \
  tests/e2e/postgres-json-import-dev-mode.e2e.ts
make pg-down
```

Expected: all 10 pass. JSON import remains green because `PostgresJsonImportRepository` is unchanged.

If any fail: stop. Fix in the worker / repository before proceeding.

- [ ] **Step 2: No commit** (this is a verification-only step).

---

## Task 13: New E2E Scenarios — Cancellation + Large Allele

**Files:**
- Create: `tests/e2e/postgres-vcf-copy-cancellation.e2e.ts`
- Create: `tests/e2e/postgres-vcf-copy-large-allele.e2e.ts`
- Create: `tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz` (extends the Phase 9.1 fixture with `info_json`-style INFO containing newlines, CRs, tabs, and a backslash)

- [ ] **Step 1: Generate the new fixture**

Reuse the Phase 9.1 large-allele synthesis script if available; otherwise produce inline:

```bash
# Quick fixture: 100 SNVs + 1 row with a 9.7 KB ALT and a special-char INFO field.
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const big_alt = 'A'.repeat(9700);
const special_info = 'k1=line1\nline2;k2=tab\\there;k3=backslash\\\\;k4=cr\rdone';
let vcf = '##fileformat=VCFv4.2\n##contig=<ID=chr1>\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n';
for (let i = 1; i <= 100; i++) vcf += 'chr1\t' + (1000 + i) + '\t.\tA\tG\t100\tPASS\t.\tGT\t0/1\n';
vcf += 'chr1\t99999\t.\tA\t' + big_alt + '\t100\tPASS\t' + special_info + '\tGT\t0/1\n';
writeFileSync('tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz', gzipSync(Buffer.from(vcf, 'utf8')));
"
```

- [ ] **Step 2: Write the cancellation E2E**

Mirrors `postgres-import-cancellation-dev-mode.e2e.ts` but starts an import using the new fixture, cancels mid-import, and asserts:
- partial-committed-state preserved (committed batches durable);
- all three triggers `tgenabled = 'O'` after cancellation;
- sequence has advanced;
- no rows for the in-flight cancelled batch.

- [ ] **Step 3: Write the large-allele E2E**

Imports the new fixture and asserts:
- the 9.7 KB ALT row round-trips (REF/ALT bytes match);
- `coord_hash` matches the JS reference encoding;
- `search_document` is populated for every variant;
- the special-character INFO content is byte-identical in `info_json`.

- [ ] **Step 4: Run**

```bash
make build
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test \
  tests/e2e/postgres-vcf-copy-cancellation.e2e.ts \
  tests/e2e/postgres-vcf-copy-large-allele.e2e.ts
make pg-down
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/postgres-vcf-copy-cancellation.e2e.ts \
        tests/e2e/postgres-vcf-copy-large-allele.e2e.ts \
        tests/test-data/vcf/large-allele-9.7kb-with-special-info.vcf.gz
git commit -m "test(e2e): add postgres VCF COPY cancellation + large-allele scenarios"
```

---

## Task 14: WGS Perf Comparison — The Success Gate

**Files:**
- Will write: `.planning/artifacts/perf/wgs-import/<timestamp>-comparison.md` (gitignored — not committed)

Run the WGS comparison harness against the post-Phase-16 build. The hard gate is **PG wall time strictly less than SQLite wall time**.

- [ ] **Step 1: Pre-Phase-16 baseline (already captured in Task 0 Step 5)**

Confirm the artifact captured in Task 0 is still readable:

```bash
ls -la .planning/artifacts/perf/wgs-import/*comparison.md
```

- [ ] **Step 2: Post-Phase-16 measurement**

```bash
make build
make pg-reset && make pg-up
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
node scripts/perf/compare-wgs-import.mjs
make pg-down
```

Expected: a fresh `<timestamp>-comparison.md` artifact is written.

- [ ] **Step 3: Verify the success gate**

Open the comparison artifact and confirm:

- PG wall time < SQLite wall time (hard gate).
- Peak Node heap on the WGS fixture stays ≤ 1 GB (Acceptance Criteria #2).
- Per-batch worker memory profile stable (no growth across batches).

If PG ≥ SQLite: **STOP**. Do not commit. Open Phase 16.1 with the diagnosis (which lever underdelivered).

- [ ] **Step 4: Capture the post-Phase-16 numbers in scratch notes**

These get pasted into the PR description and the AGENTS.md update (Task 15).

- [ ] **Step 5: No commit** (artifacts are gitignored; PR description carries the diff inline).

---

## Task 15: AGENTS.md Update

**Files:**
- Modify: `AGENTS.md` (WGS subsection)

- [ ] **Step 1: Update the WGS subsection**

Replace the line that records the current PG/SQLite ratio (3.09×) with the post-Phase-16 numbers from Task 14. Remove the "Phase 16 escalation" footnote — the escalation has shipped.

```diff
- VarLens is now functionally at backend parity for VCF imports across SQLite and PostgreSQL...
- The remaining postgres-side perf work is the COPY-FROM-STDIN escalation, not the schema or worker shape.
+ VarLens VCF imports are now strictly faster on PostgreSQL than on SQLite. Post-Phase-16 WGS comparison
+ on the GIAB HG002 v4.2.1 fixture: PG <X> s vs SQLite <Y> s, ratio <Z>×.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): update WGS subsection with post-Phase-16 PG-faster-than-SQLite numbers"
```

---

## Task 16: Final CI + Hard-Cutover Proof

**Files:** none

- [ ] **Step 1: Run the full local mirror of CI**

```bash
make ci-full
```

Expected: green. Includes startup smoke, packaged-binary smoke (Linux), lint, format, typecheck, test, build.

- [ ] **Step 2: Confirm the hard-cutover proof**

```bash
git grep "jsonb_to_recordset" -- "src/main/storage/postgres/PostgresVcfImportRepository.ts"
git grep "RECORDSET_TYPES" -- "src/main/storage/postgres/postgres-import-columns.ts"
```

Expected: both return zero matches. (`PostgresJsonImportRepository.ts` still uses `jsonb_to_recordset` — intentional, JSON is out of scope for Phase 16.)

- [ ] **Step 3: Confirm the per-batch commit shape is preserved**

```bash
grep -E "COMMIT|BEGIN" src/main/workers/postgres-import-worker.ts | head -20
```

Expected: a per-batch `await client.query('COMMIT')` immediately followed by `await client.query('BEGIN')` in `flush()`, mirroring the pre-Phase-16 baseline.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/postgres-parity-phase-16-copy-from-stdin
gh pr create --title "feat(import): postgres VCF import via COPY FROM STDIN (Phase 16)" --body "$(cat <<'EOF'
## Summary

PostgreSQL VCF imports now use `COPY FROM STDIN` (text format, `pg-copy-streams`) layered with `SET LOCAL synchronous_commit = OFF` per per-batch transaction and a bracket-transaction trigger defer for the three FTS triggers (`variants_search_document_tg`, `variant_sv_search_document_tg`, `variant_str_search_document_tg`) plus a startup recovery shim.

Per-batch `COMMIT; BEGIN;` cycle preserved (load-bearing for 1 GB heap budget on WGS).
JSON import path unchanged (separate future phase).

## WGS perf

| Metric | Pre-Phase-16 | Post-Phase-16 |
|---|---|---|
| PG wall time | 170.93 s | <X> s |
| SQLite wall time | 52.88 s | <Y> s |
| Ratio (PG : SQLite) | 3.09× | <Z>× |
| Peak Node heap | < 1 GB | < 1 GB |

## Test plan

- [ ] `make ci-full` green
- [ ] All 10 inherited Phase 9 E2E scenarios pass against the new transport
- [ ] Two new E2E scenarios pass (cancellation + large-allele)
- [ ] Encoder unit tests at 100 % line + 100 % branch coverage
- [ ] Repository integration tests pass against fresh `make pg-reset && make pg-up`
- [ ] Worker recovery shim test passes
- [ ] WGS perf comparison artifact shows PG strictly faster than SQLite

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Final commit (if any cleanup needed)**

If `make ci-full` surfaced any small fixes: address inline, run again, commit, push.

---

## Acceptance Checklist (mirrors Spec section "Acceptance Criteria")

- [ ] WGS PG import wall time < SQLite baseline (currently 52.88 s)
- [ ] Peak Node heap on WGS fixture ≤ 1 GB
- [ ] Per-batch `COMMIT; BEGIN` cycle preserved (Task 16 Step 3 confirms)
- [ ] Encoder coverage 100 % line + 100 % branch
- [ ] Worker recovery shim test passes
- [ ] All repository integration tests pass against fresh `pg-reset`
- [ ] All 10 inherited Phase 9 E2E scenarios pass plus the two new scenarios
- [ ] Trigger-defer golden test confirms `compute_*` output equals trigger output
- [ ] `git grep` finds no `jsonb_to_recordset` in `PostgresVcfImportRepository.ts` and no `RECORDSET_TYPES` constants
- [ ] `make ci-full` passes locally and on `build.yml`
- [ ] `AGENTS.md` WGS subsection updated with the post-Phase-16 numbers
