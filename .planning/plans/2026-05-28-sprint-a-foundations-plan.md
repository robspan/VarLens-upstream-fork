# Sprint A — Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [.planning/specs/2026-05-28-sprint-a-foundations.md](../specs/2026-05-28-sprint-a-foundations.md)

**Predecessor plan template:** [.planning/plans/2026-05-26-pre-060-hardening-plan.md](2026-05-26-pre-060-hardening-plan.md) (Sprint 0, four-PR shape mirrored here)

**Goal:** Land the foundations that unblock 1000-genome scale across four independently shippable PRs: PR-1 (renderer perf foundations — A1-A4), PR-2 (Postgres named/prepared statements — B1-B4), PR-3 (materialised PG cohort summary — C1, C2, C2a, C3, C4, C5, C5a, C6, C7, C8), PR-4 (JobRunner tracking-wrapper skeleton + multi-project design doc — D1-D5). Sprint exit tag is **0.68.0**.

**Architecture:** Four independent PRs on four branches. Each task is atomic (≤ one file's worth of changes plus its test), TDD where a behaviour gate exists, and ends with a single Conventional Commit. The plan is ordered for `superpowers:subagent-driven-development` — dispatch a fresh implementer per task, run two-stage review (spec compliance, then code quality) before marking the task complete. Do not start the next task while either review has open issues.

**Tech Stack:** Electron 40, Vue 3 + Vuetify 4, TypeScript 6 strict, Vitest, Playwright `_electron`, better-sqlite3-multiple-ciphers (SQLCipher), PostgreSQL (pg + pg-copy-streams), Zod, electron-log, GitHub Actions.

**Codebase reality checks (verified against `sprint-a/spec` at plan-authoring time):**
1. **Current PG migration head is `0008_create_users_and_settings.sql`** (matches spec). PR-1's covering-index PG migration is `0009_idx_variants_coords.sql`; PR-3's cohort summary is `0010_cohort_summary.sql`; PR-4's projects registry is `0011_projects_registry.sql`. **Re-verify the next available number at each PR's first migration task** — if other work has landed in the interim, the numbers shift uniformly.
2. **Current SQLite head is `PRAGMA user_version = 28`** (`src/main/database/migrations.ts:1728`). PR-1's covering-index SQLite migration is v29; PR-4's `projects` table is v30. Re-verify.
3. **The `--bootstrap-postgres-baseline` flag does NOT exist** in `scripts/check-agent-health.mjs` today — PR-2's first task implements it before running it.
4. **A2's "four consumer files" basenames map to these real paths**:
   - `src/renderer/src/components/variant-table/useVariantData.ts` (NOT `src/renderer/src/composables/useVariantData.ts` — that path doesn't exist)
   - `src/renderer/src/composables/useCohortData.ts`
   - `src/renderer/src/components/FilterToolbar.vue`
   - `src/renderer/src/components/cohort/CohortFilterBar.vue`
   Plus the shared-module contract target per Pass-9 #4: `src/shared/filters/filterSerialization.ts`. And the existing re-export shim at `src/renderer/src/utils/cloneForIpc.ts` that today re-exports `src/shared/utils/cloneForIpc.ts`.
5. **Test paths are flat** under `tests/main/storage/` (e.g. `tests/main/storage/postgres-annotations-repository.test.ts`) — there is no `tests/main/storage/postgres/` subdirectory. Per Pass-8 #10.
6. **Single-flight guards in `PostgresImportExecutor` live at `:46-49` and `:79-80`** with messages "An import is already in progress". Association engine guard at `cohort-logic.ts:315` with "An association analysis is already running". Batch import message "A batch import is already in progress" is in `batch-import-logic.ts:88` (verify at PR-4 D2).
7. **Web track location is `src/web/`** (Fastify app + routes shipped 0.60-0.65). Web parity gate is `VARLENS_WEB=1 make ci`.

**Branch discipline:** Per `AGENTS.md`, never commit feature work directly to `main`. Each PR has its own branch (see "Branch convention" below). Worktrees are recommended if multiple PRs run in parallel (`superpowers:using-git-worktrees`).

---

## Pre-flight (controller, before dispatching any subagent)

- [ ] **Confirm branch hygiene.** From `main`, ensure working tree is clean: `git status` and `git fetch origin && git rev-list --left-right --count origin/main...main` (expect `0 0`).
- [ ] **Read the spec.** [.planning/specs/2026-05-28-sprint-a-foundations.md](../specs/2026-05-28-sprint-a-foundations.md). Note the four PR groupings, the 14 acceptance gates (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10a, 10b, 10c, 11, 12, 13, 14 — 17 numbered items, mapped 1:1 to verification steps below). Settled cross-AI review findings (Passes 1-9) must NOT be re-litigated during execution.
- [ ] **Verify clean baseline.** Run `make ci` once on `main` to confirm a green starting point. If it fails, fix or surface to the user before starting Phase 1 work.

```bash
git checkout main && git pull --ff-only
make ci
VARLENS_WEB=1 make ci   # web parity must also be green
```

Expected: both exit 0. Surface failures before starting any task.

- [ ] **Capture renderer-perf-phase1 baseline (Gate 3).** This MUST be captured IMMEDIATELY before PR-1's first commit so the comparison is honest.

```bash
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls -lt .planning/artifacts/perf/phase1/ | head -5
```

Note the most recent artifact filename — that is the **before** baseline for Gate 3. Record the filename in the PR-1 description placeholder. Artifacts directory is gitignored; the comparison numbers live in the PR body.

---

## Branch convention

| PR | Branch | Tag target |
|---|---|---|
| PR-1 | `perf/renderer-foundations` | 0.66.0 |
| PR-2 | `perf/postgres-named-statements` | 0.66.x or 0.67.0 |
| PR-3 | `feat/pg-cohort-summary` | 0.67.0 |
| PR-4 | `feat/job-runner` | 0.68.0 |

Create each branch from `main` immediately before that PR's first task. PR-1 and PR-2 are independent and can land in either order. PR-3 captures its perf baseline against post-PR-1 + post-PR-2 `main`. PR-4 lands last.

```bash
git checkout main && git pull --ff-only
git checkout -b perf/renderer-foundations
```

---

# PR-1 — `perf(renderer): annotation N+1, ipc clone, filter toolbar visibility, shallowRef audit`

**Branch:** `perf/renderer-foundations`
**Tasks:** A1 (with PG+SQLite covering-index prereq), A2, A3 (Case + Cohort parity), A4
**Audit refs:** §3.4, §3.9, BP-05 §6, was-QW-5
**Lands first or alongside PR-2. Tag target:** `0.66.0`.

---

### Task PR1-0: Branch + renderer-perf baseline freeze

- [ ] **Step 1: Cut the branch from `main`.**

```bash
git checkout main && git pull --ff-only
git checkout -b perf/renderer-foundations
```

- [ ] **Step 2: Confirm the perf baseline filename from Pre-flight.** Record it in a TODO at the top of the PR draft description; it will be referenced by Gate 3 after PR-1's last commit.

```bash
ls -lt .planning/artifacts/perf/phase1/ | head -3
```

No commit yet — first commit comes from PR1-1.

---

### Task PR1-1 (A1-prereq, risk-table mitigation): Add `idx_variants_coords` covering index — PG migration

**Files:**
- Create: `src/main/storage/postgres/migrations/sql/0009_idx_variants_coords.sql`
- Modify: `src/main/storage/postgres/migrations/definitions.ts` — append to `MIGRATION_FILES`.

**Context:** The risk table calls this out as A1's prerequisite: `getBatch` JOINs `variants` against a coordinate tuple list. The existing PG index `(case_id, chr, pos, ref, alt)` can't serve a case-less coordinate scan (cohort/global batch path). The covering index `(chr, pos, ref, alt)` makes the JOIN plan use an index-only scan. Same shape required on SQLite (PR1-2).

**Re-verify the next available migration number** before writing: `ls src/main/storage/postgres/migrations/sql/ | sort | tail -3`. Use whatever number is one greater than the current head.

- [ ] **Step 1: Create the SQL file with `__schema__` placeholder quoting.**

`src/main/storage/postgres/migrations/sql/0009_idx_variants_coords.sql`:

```sql
-- Sprint A PR-1 A1-prereq (risk-table mitigation): cover the global / case-less
-- (chr, pos, ref, alt) lookup path used by AnnotationRepository.getBatch and the
-- A1 batched IN-list JOINs. The existing variants index (case_id, chr, pos, ref, alt)
-- cannot serve a case-less lookup as a leading-column scan.
--
-- "__schema__" is the migration-runner template placeholder (see 0001_create_cases.sql).

CREATE INDEX IF NOT EXISTS variants_coords
  ON "__schema__"."variants" (chr, pos, ref, alt);
```

- [ ] **Step 2: Register the migration in `definitions.ts`.**

Append to `MIGRATION_FILES`:

```typescript
  {
    version: '0009',
    name: 'idx_variants_coords',
    fileName: '0009_idx_variants_coords.sql'
  }
```

- [ ] **Step 3: Run the PG migration suite + integration tests.**

```bash
make pg-reset && make pg-up
make rebuild-node && npx vitest run tests/main/storage/postgres-migrations-registration.test.ts tests/main/storage/postgres-migration-runner.test.ts tests/main/storage/postgres-startup-migrations.test.ts
make pg-down
```

Expected: pass. The migration runs as part of the bootstrap sequence, no regressions.

- [ ] **Step 4: Capture `EXPLAIN ANALYZE` before/after on the parity-harness PG fixture** (for PR description, Gate 3 narrative — record in PR body):

```bash
make pg-up
# Load the 8-case parity fixture (see scripts/perf/build-100-case-fixture.mjs prereqs).
# For PR-1 use whatever PG fixture already exists; the 100-case fixture is PR-3.
psql "$VARLENS_PG_URL" -c "EXPLAIN ANALYZE SELECT v.chr, v.pos, v.ref, v.alt FROM variants v WHERE (v.chr, v.pos, v.ref, v.alt) IN (('chr1', 12345, 'A', 'G'), ('chr2', 67890, 'C', 'T'));"
make pg-down
```

Record the planner choice (Bitmap Index Scan on `variants_coords` expected after; Seq Scan or per-case index scan before).

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/migrations/sql/0009_idx_variants_coords.sql \
        src/main/storage/postgres/migrations/definitions.ts
git commit -m "perf(pg): add (chr, pos, ref, alt) covering index on variants

Sprint A PR-1 A1-prereq (risk-table mitigation). Required so
AnnotationRepository.getBatch's case-less batched coord JOIN can index-scan
rather than table-scan — the existing (case_id, chr, pos, ref, alt) index
cannot serve a case-less leading-column scan.

Migration 0009 follows the existing __schema__ placeholder pattern.

Refs spec PR-1 A1, risk table row 1."
```

---

### Task PR1-2 (A1-prereq, risk-table mitigation): Add `idx_variants_coords` — SQLite migration v29

**Files:**
- Modify: `src/main/database/migrations.ts` — append v29 block after the existing v28.

**Context:** Same rationale as PR1-1 but for the SQLite backend. Existing migration head is v28 (`migrations.ts:1728`). Re-verify with `grep -n "PRAGMA user_version" src/main/database/migrations.ts | tail -3` before writing.

- [ ] **Step 1: Read the v28 block as a structural template.**

```bash
sed -n '1718,1735p' src/main/database/migrations.ts
```

The file uses a flat sequential `if`-chain on `user_version`, not a registry array.

- [ ] **Step 2: Append v29 in the same idiom.**

After the v28 `db.exec('PRAGMA user_version = 28')` line:

```typescript
  // Migration v29: covering index on variants(chr, pos, ref, alt)
  // Sprint A PR-1 A1-prereq (risk-table mitigation). Mirrors PG 0009.
  // Required so the case-less coordinate JOIN in AnnotationRepository.getBatch
  // can index-scan rather than table-scan.
  if (currentVersion < 29) {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_variants_coords ON variants(chr, pos, ref, alt)'
    )
    db.exec('PRAGMA user_version = 29')
  }
```

- [ ] **Step 3: If any test asserts the highest expected `user_version`, bump it.**

```bash
grep -rn "user_version\|toBe(28)\|toBe(29)" tests/main/database/ 2>&1 | head -20
```

If `migrations.test.ts` or similar asserts `expect(version).toBe(28)`, bump to 29.

- [ ] **Step 4: Run the SQLite database test suite.**

```bash
make rebuild-node
npx vitest run tests/main/database/
```

Expected: pass. The migration runs idempotently against existing DBs and on fresh DBs.

- [ ] **Step 5: Capture EXPLAIN QUERY PLAN before/after** on the dev DB (for PR body):

```bash
sqlite3 ~/.config/varlens/varlens.db "EXPLAIN QUERY PLAN SELECT chr, pos, ref, alt FROM variants WHERE (chr, pos, ref, alt) IN (('chr1', 12345, 'A', 'G'));"
```

Run once on `main` (before migration), once on this branch (after). Expected: SEARCH using `idx_variants_coords` after.

- [ ] **Step 6: Commit.**

```bash
git add src/main/database/migrations.ts
git commit -m "perf(db): add idx_variants_coords covering index — sqlite v29

Sprint A PR-1 A1-prereq (risk-table mitigation). Mirrors PG migration 0009.

EXPLAIN QUERY PLAN before/after captured in PR description.

Refs spec PR-1 A1, risk table row 1."
```

---

### Task PR1-3 (A1): Annotation `getBatch` N+1 fix — call-count test FIRST (TDD)

**Files:**
- Create: `tests/main/database/annotation-repository-batch.test.ts`

**Context (Gate 4):** Today `AnnotationRepository.getBatch(caseId, variantKeys)` (SQLite) and `PostgresAnnotationsRepository.getBatch` execute one prepared-statement per key (N=50 → ~150 calls including the per-case + global pair × 50 lookups + a meta call, per audit §3.4 / Perf-01). After A1 lands, exactly **2 prepared-statement executions per N=50 call** — one global-coord batched SELECT and one per-case batched SELECT (or just one if `caseId === null`). This test is the gate; write it now and fail.

The IPC contract `src/shared/ipc/domains/annotations.ts:42` defines:
- `batchGet(caseId: number | null, variantKeys: BatchAnnotationKey[]): Promise<IpcResult<Record<string, VariantAnnotationsResult>>>`
- `VariantAnnotationsResult = { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }`
- Result keys are `${chr}:${pos}:${ref}:${alt}` strings.

`BatchAnnotationKey` becomes `VariantKey & { variantId?: number }` (Pass-8 #1: variantId OPTIONAL).

- [ ] **Step 1: Write the failing call-count test.**

`tests/main/database/annotation-repository-batch.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'

describe('AnnotationRepository.getBatch — call-count guarantee (Sprint A A1)', () => {
  let db: Database.Database
  let repo: AnnotationRepository
  const prepareSpy = vi.fn()

  beforeEach(() => {
    db = new Database(':memory:')
    // Minimal schema to satisfy the queries. Read the v29 migration tail
    // (variants + variant_annotations + case_variant_annotations) for the
    // exact columns. Truncated here for plan brevity; the implementer copies
    // the relevant CREATE TABLE statements from src/main/database/migrations.ts.
    db.exec(`
      CREATE TABLE cases (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY,
        case_id INTEGER,
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT,
        variant_type TEXT DEFAULT 'snv'
      );
      CREATE TABLE variant_annotations (
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT,
        starred INTEGER DEFAULT 0,
        comment TEXT,
        PRIMARY KEY (chr, pos, ref, alt)
      );
      CREATE TABLE case_variant_annotations (
        case_id INTEGER, variant_id INTEGER,
        starred INTEGER DEFAULT 0,
        comment TEXT,
        acmg_class TEXT,
        UNIQUE(case_id, variant_id)
      );
      CREATE INDEX idx_variants_coords ON variants(chr, pos, ref, alt);
    `)

    // Wrap db.prepare so we can count statement preparations. A1's invariant:
    // exactly 2 prepares per getBatch invocation (one global, one per-case)
    // when caseId !== null; exactly 1 when caseId === null.
    const realPrepare = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      prepareSpy(sql)
      return realPrepare(sql)
    }) as typeof db.prepare

    // Seed: 1 case + 50 variants + 50 per-case annotations.
    db.exec("INSERT INTO cases (id, name) VALUES (1, 'C1')")
    const insertVariant = realPrepare(
      'INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (?, 1, ?, ?, ?, ?)'
    )
    const insertCva = realPrepare(
      'INSERT INTO case_variant_annotations (case_id, variant_id, starred) VALUES (1, ?, 1)'
    )
    for (let i = 0; i < 50; i++) {
      insertVariant.run(i + 1, 'chr1', 10000 + i, 'A', 'G')
      insertCva.run(i + 1)
    }

    repo = new AnnotationRepository(db)
    prepareSpy.mockClear()
  })

  it('runs exactly 1 prepared statement when caseId === null (global only)', () => {
    const keys = Array.from({ length: 50 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G'
    }))
    repo.getBatch(null, keys)
    expect(prepareSpy.mock.calls.length).toBe(1)
  })

  it('runs exactly 2 prepared statements when caseId !== null (global + per-case)', () => {
    const keys = Array.from({ length: 50 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G',
      variantId: i + 1
    }))
    repo.getBatch(1, keys)
    expect(prepareSpy.mock.calls.length).toBe(2)
  })

  it('returns a coordinate-keyed map matching the IPC contract shape', () => {
    const keys = Array.from({ length: 3 }, (_, i) => ({
      chr: 'chr1',
      pos: 10000 + i,
      ref: 'A',
      alt: 'G',
      variantId: i + 1
    }))
    const result = repo.getBatch(1, keys)
    expect(Object.keys(result).sort()).toEqual(
      ['chr1:10000:A:G', 'chr1:10001:A:G', 'chr1:10002:A:G']
    )
    expect(result['chr1:10000:A:G']).toEqual({
      global: null,
      perCase: expect.objectContaining({ starred: 1 })
    })
  })

  it('ignores a renderer-spoofed variantId pointing to another case', () => {
    // Pass-8 #2 defensive-join check: variantId 1 actually belongs to case 1.
    // If we lie and pass caseId=999, the join must fail to match.
    db.exec("INSERT INTO cases (id, name) VALUES (999, 'Other')")
    const keys = [{ chr: 'chr1', pos: 10000, ref: 'A', alt: 'G', variantId: 1 }]
    const result = repo.getBatch(999, keys)
    expect(result['chr1:10000:A:G']).toEqual({ global: null, perCase: null })
  })
})
```

- [ ] **Step 2: Run — expect failures.**

```bash
make rebuild-node
npx vitest run tests/main/database/annotation-repository-batch.test.ts
```

Expected: all four tests fail (current implementation is N+1 OR is at least using a different code path; the call-count assertion is the load-bearing one).

- [ ] **Step 3: Commit the failing test (TDD discipline — separate commit so the regression is recoverable).**

```bash
git add tests/main/database/annotation-repository-batch.test.ts
git commit -m "test(db): assert AnnotationRepository.getBatch runs 1 or 2 prepares (Gate 4)

Sprint A PR-1 Gate 4 (Pass-9 #10 — coordinate-keyed result map per IPC contract).
TDD: implementation in next commit will make these pass.

Refs spec PR-1 A1, gate 4."
```

---

### Task PR1-4 (A1): Implement SQLite `AnnotationRepository.getBatch` batched SELECT

**Files:**
- Modify: `src/shared/ipc/domains/annotations.ts` — extend `BatchAnnotationKey` with optional `variantId`.
- Modify: `src/shared/types/api.ts` — keep `BatchAnnotationKey` re-export in sync if it lives there.
- Modify: `src/main/database/AnnotationRepository.ts` — replace per-key loop with two batched SELECTs (composite-tuple IN form).
- Modify (if it exists): `src/main/ipc/handlers/annotations.ts` or domain-module equivalent to thread variantId through.

**Context:** Per spec A1 + Pass-8 #1/#2 + Pass-9 #10. Result type is `Record<string, VariantAnnotationsResult>` (coord-keyed), NOT `Map<…>` or a custom `AnnotationPayload`. SQL shapes:

**Global (caseId === null OR variantId omitted):**
```sql
SELECT chr, pos, ref, alt, starred, comment, ...
FROM variant_annotations
WHERE (chr, pos, ref, alt) IN ((?, ?, ?, ?), (?, ?, ?, ?), ...)
```

**Per-case with defensive variantId join (caseId !== null AND variantId provided):**
```sql
SELECT v.chr, v.pos, v.ref, v.alt, cva.*
FROM case_variant_annotations cva
JOIN variants v ON v.id = cva.variant_id
WHERE cva.case_id = ?
  AND v.case_id = ?
  AND (v.chr, v.pos, v.ref, v.alt) IN ((?, ?, ?, ?), ...)
  AND v.id IN (?, ?, ...)
```

The dual `cva.case_id = ? AND v.case_id = ?` predicate is intentional — `case_variant_annotations.UNIQUE(case_id, variant_id)` exists but the FKs are independent, so a renderer-spoofed variantId pointing to another case must be rejected.

- [ ] **Step 1: Extend the IPC contract.**

`src/shared/ipc/domains/annotations.ts`:

```typescript
// Existing
export interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

// NEW: variantId is OPTIONAL (Pass-8 #1). Cohort/global batch path omits it;
// per-case path includes it for the defensive join (Pass-8 #2). Renderer code
// MUST pass variantId when caseId !== null; the server-side join validates that
// the variantId actually belongs to caseId — a spoofed variantId returns null.
export type BatchAnnotationKey = VariantKey & { variantId?: number }
```

- [ ] **Step 2: Replace `AnnotationRepository.getBatch` body** (SQLite).

Read the existing method first:

```bash
grep -n "getBatch\|prepare" src/main/database/AnnotationRepository.ts | head -20
```

Replace per-key looping with two prepared statements built once per call. Build the IN-list SQL textually from `keys.length` (acceptable for SQLite — node-postgres prepared-statement caching does NOT apply here). The variadic-tuple form `(?, ?, ?, ?), (?, ?, ?, ?), ...` is the canonical batched-IN shape.

```typescript
import type { BatchAnnotationKey } from '../../shared/ipc/domains/annotations'

export class AnnotationRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Sprint A A1: batched annotation lookup.
   *
   * Returns a coordinate-keyed map `${chr}:${pos}:${ref}:${alt}` →
   * { global, perCase } per the IPC contract (annotations.ts:42).
   *
   * Call-count invariant (Gate 4):
   *   - caseId === null  → 1 prepared statement (global SELECT only)
   *   - caseId !== null  → 2 prepared statements (global + per-case)
   *
   * Per-case SELECT defensively joins on cva.case_id AND v.case_id even when
   * a variantId is supplied — case_variant_annotations.UNIQUE(case_id,
   * variant_id) is enforced but FKs are independent, so a renderer-spoofed
   * variantId could otherwise read another case's annotation. Pass-8 #2.
   */
  getBatch(
    caseId: number | null,
    keys: BatchAnnotationKey[]
  ): Record<string, VariantAnnotationsResult> {
    const out: Record<string, VariantAnnotationsResult> = {}
    if (keys.length === 0) return out
    for (const k of keys) {
      out[`${k.chr}:${k.pos}:${k.ref}:${k.alt}`] = { global: null, perCase: null }
    }

    // Global lookup — always runs.
    const coordPlaceholders = keys.map(() => '(?, ?, ?, ?)').join(', ')
    const coordParams: (string | number)[] = []
    for (const k of keys) coordParams.push(k.chr, k.pos, k.ref, k.alt)

    const globalRows = this.db
      .prepare(
        `SELECT chr, pos, ref, alt, starred, comment FROM variant_annotations
         WHERE (chr, pos, ref, alt) IN (${coordPlaceholders})`
      )
      .all(...coordParams) as Array<{
      chr: string
      pos: number
      ref: string
      alt: string
      starred: number
      comment: string | null
    }>
    for (const row of globalRows) {
      const key = `${row.chr}:${row.pos}:${row.ref}:${row.alt}`
      out[key].global = { chr: row.chr, pos: row.pos, ref: row.ref, alt: row.alt, starred: row.starred, comment: row.comment }
    }

    // Per-case lookup — only when caseId !== null.
    if (caseId !== null) {
      const variantIds = keys.map((k) => k.variantId).filter((v): v is number => typeof v === 'number')
      const idClause = variantIds.length > 0
        ? ` AND v.id IN (${variantIds.map(() => '?').join(', ')})`
        : ''
      const perCaseRows = this.db
        .prepare(
          `SELECT v.chr, v.pos, v.ref, v.alt, cva.starred, cva.comment, cva.acmg_class
           FROM case_variant_annotations cva
           JOIN variants v ON v.id = cva.variant_id
           WHERE cva.case_id = ?
             AND v.case_id = ?
             AND (v.chr, v.pos, v.ref, v.alt) IN (${coordPlaceholders})${idClause}`
        )
        .all(caseId, caseId, ...coordParams, ...variantIds) as Array<{
        chr: string
        pos: number
        ref: string
        alt: string
        starred: number
        comment: string | null
        acmg_class: string | null
      }>
      for (const row of perCaseRows) {
        const key = `${row.chr}:${row.pos}:${row.ref}:${row.alt}`
        out[key].perCase = {
          chr: row.chr, pos: row.pos, ref: row.ref, alt: row.alt,
          case_id: caseId,
          starred: row.starred, comment: row.comment, acmg_class: row.acmg_class
        }
      }
    }

    return out
  }
}
```

The exact field names on `VariantAnnotation` / `CaseVariantAnnotation` must match the shapes currently produced by `getBatch`; read the existing implementation and the IPC contract once before pasting. Do not invent fields.

- [ ] **Step 3: Run the call-count test from PR1-3.**

```bash
make rebuild-node
npx vitest run tests/main/database/annotation-repository-batch.test.ts
```

Expected: all four tests pass.

- [ ] **Step 4: Run the full annotation + IPC suite for regressions.**

```bash
npx vitest run tests/main/database/ tests/shared/types/preload-contract.test.ts
```

Expected: pass. If the preload-contract test fails because `BatchAnnotationKey` shape changed, update its assertions (Gate 10a will tighten this in a later task).

- [ ] **Step 5: Commit.**

```bash
git add src/shared/ipc/domains/annotations.ts \
        src/main/database/AnnotationRepository.ts
git commit -m "perf(db): batch AnnotationRepository.getBatch into 1-or-2 SELECTs

Sprint A PR-1 A1 (SQLite half). Replaces per-key prepared-statement loop with
two composite-tuple IN SELECTs:
  - Global SELECT always runs (variant_annotations by (chr,pos,ref,alt)).
  - Per-case SELECT runs when caseId !== null, defensively joining on
    BOTH cva.case_id and v.case_id so a renderer-spoofed variantId cannot
    read another case's annotation (Pass-8 #2).

BatchAnnotationKey extended with optional variantId (Pass-8 #1).
Result is coordinate-keyed Record<string, VariantAnnotationsResult>
per the existing IPC contract (Pass-9 #10).

Closes audit §3.4 (SQLite half)."
```

---

### Task PR1-5 (A1): Implement `PostgresAnnotationsRepository.getBatch` mirror

**Files:**
- Modify: `src/main/storage/postgres/PostgresAnnotationsRepository.ts` — mirror SQLite A1 with PG-native UNNEST-array bindings.

**Context:** Per Pass-9 #1: PG batched IN-lists must use fixed-text UNNEST-array binding, NOT variadic placeholders. This makes the SQL text invariant regardless of batch size and qualifies the statement for `runNamed` in PR-2 B2.

**PG global SQL (fixed text, four parallel arrays):**
```sql
SELECT chr, pos, ref, alt, starred, comment
FROM variant_annotations
WHERE (chr, pos, ref, alt) = ANY (
  SELECT chr, pos, ref, alt
  FROM UNNEST($1::text[], $2::int[], $3::text[], $4::text[]) AS k(chr, pos, ref, alt)
)
```

**PG per-case SQL (fixed text, four arrays + optional variantId array):**
```sql
SELECT v.chr, v.pos, v.ref, v.alt, cva.starred, cva.comment, cva.acmg_class
FROM case_variant_annotations cva
JOIN variants v ON v.id = cva.variant_id
WHERE cva.case_id = $1
  AND v.case_id = $1
  AND (v.chr, v.pos, v.ref, v.alt) = ANY (
    SELECT chr, pos, ref, alt
    FROM UNNEST($2::text[], $3::int[], $4::text[], $5::text[]) AS k(chr, pos, ref, alt)
  )
  AND (cardinality($6::int[]) = 0 OR v.id = ANY ($6::int[]))
```

The `cardinality($6) = 0` short-circuit lets a single SQL text serve both with-variantId and without-variantId paths.

- [ ] **Step 1: Read the existing PG getBatch.**

```bash
grep -n "getBatch\|batchGet\|UNNEST" src/main/storage/postgres/PostgresAnnotationsRepository.ts | head -20
```

- [ ] **Step 2: Replace with the two-query batched form** using the SQL above. Use `pool.query` for now — PR-2 B2 will retrofit `runNamed`. Field shapes must match the SQLite half exactly so the coordinate-keyed result map is identical.

- [ ] **Step 3: Write a PG-equivalent of the SQLite call-count test, scoped to PG.**

`tests/main/storage/postgres-annotations-batch.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'
import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

// Skip when PG is unavailable — mirrors existing pg test patterns.
// Read an existing tests/main/storage/postgres-*.test.ts (e.g.
// postgres-annotations-repository.test.ts) for the canonical fixture-setup
// pattern (createTestPool, seed schema, etc.).

describe('PostgresAnnotationsRepository.getBatch — call-count guarantee', () => {
  // Spy on pool.query to count round-trips. The PG invariant matches SQLite:
  // 1 query when caseId === null, 2 queries when caseId !== null.

  it.todo('runs exactly 1 query when caseId === null')
  it.todo('runs exactly 2 queries when caseId !== null')
  it.todo('returns coordinate-keyed Record<string, VariantAnnotationsResult>')
  it.todo('ignores spoofed variantId pointing to another case')
})
```

Replace each `it.todo` with a real test that mirrors the SQLite shape — the implementer copies the seed pattern from an existing PG repo test in `tests/main/storage/` and counts `pool.query` calls via `vi.spyOn`.

- [ ] **Step 4: Run.**

```bash
make pg-reset && make pg-up
make rebuild-node
npx vitest run tests/main/storage/postgres-annotations-batch.test.ts \
              tests/main/storage/postgres-annotations-repository.test.ts
make pg-down
```

Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/PostgresAnnotationsRepository.ts \
        tests/main/storage/postgres-annotations-batch.test.ts
git commit -m "perf(pg): batch PostgresAnnotationsRepository.getBatch via UNNEST arrays

Sprint A PR-1 A1 (PG mirror). Mirrors the SQLite A1 batched form using
PG-native UNNEST(text[], int[], text[], text[]) bindings so the SQL text is
invariant regardless of batch size (Pass-9 #1) — qualifies for runNamed in
PR-2 B2. Defensive join on both cva.case_id AND v.case_id to reject any
spoofed variantId crossing a case boundary (Pass-8 #2).

Closes audit §3.4 (PG half)."
```

---

### Task PR1-6 (A1, Gate 10a): Preload-contract test extension for `BatchAnnotationKey`

**Files:**
- Modify: `tests/shared/types/preload-contract.test.ts`

**Context:** Gate 10a — assert the optional `variantId` field is part of `BatchAnnotationKey` in the locked preload surface. Existing tests already check the `annotations:batchGet` channel shape; extend rather than rewrite.

- [ ] **Step 1: Read the existing preload-contract assertion for `annotations`.**

```bash
grep -n "annotations\|batchGet\|BatchAnnotationKey" tests/shared/types/preload-contract.test.ts | head -20
```

- [ ] **Step 2: Add (or extend) the assertion.**

```typescript
import type { BatchAnnotationKey } from '../../../src/shared/ipc/domains/annotations'

describe('annotations.batchGet — A1 contract extension', () => {
  it('BatchAnnotationKey carries optional variantId (Pass-8 #1)', () => {
    const coordsOnly: BatchAnnotationKey = { chr: 'chr1', pos: 1, ref: 'A', alt: 'G' }
    const withId: BatchAnnotationKey = { chr: 'chr1', pos: 1, ref: 'A', alt: 'G', variantId: 42 }
    // Compile-time assertion: both shapes type-check. Runtime no-op.
    expect(coordsOnly.chr).toBe('chr1')
    expect(withId.variantId).toBe(42)
  })
})
```

- [ ] **Step 3: Run.**

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit.**

```bash
git add tests/shared/types/preload-contract.test.ts
git commit -m "test(ipc): lock BatchAnnotationKey.variantId? in preload contract (Gate 10a)

Sprint A PR-1 Gate 10a. Asserts the A1 contract extension — variantId is
optional on the wire so cohort/global batch path callers stay unchanged."
```

---

### Task PR1-7 (A2): Create `src/renderer/src/utils/stripVueProxies.ts`

**Files:**
- Create: `src/renderer/src/utils/stripVueProxies.ts`
- Create: `tests/renderer/utils/stripVueProxies.test.ts`

**Context:** Per A2: a renderer-only utility that strips Vue `reactive()`/`ref()` proxies AND deep-clones in one pass, preserving JSON-round-trip semantics. This replaces the renderer-side calls to `cloneForIpc` (which today is itself a JSON round-trip — see `src/renderer/src/utils/cloneForIpc.ts:1` which re-exports the shared module).

- [ ] **Step 1: Write the failing test.**

`tests/renderer/utils/stripVueProxies.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'
import { stripVueProxies } from '../../../src/renderer/src/utils/stripVueProxies'

describe('stripVueProxies — Sprint A A2', () => {
  it('strips reactive proxy and deep-clones', () => {
    const input = reactive({ a: 1, b: { c: 2 } })
    const out = stripVueProxies(input)
    expect(out).toEqual({ a: 1, b: { c: 2 } })
    expect(out).not.toBe(input)
    expect(out.b).not.toBe(input.b)
  })

  it('unwraps ref values transparently', () => {
    const input = reactive({ x: ref(42), y: { z: ref('hello') } })
    const out = stripVueProxies(input)
    expect(out).toEqual({ x: 42, y: { z: 'hello' } })
  })

  it('handles arrays', () => {
    const input = reactive([1, { n: 2 }, [3, 4]])
    const out = stripVueProxies(input)
    expect(out).toEqual([1, { n: 2 }, [3, 4]])
  })

  it('handles null/undefined/primitives', () => {
    expect(stripVueProxies(null)).toBe(null)
    expect(stripVueProxies(undefined)).toBe(undefined)
    expect(stripVueProxies(42)).toBe(42)
    expect(stripVueProxies('s')).toBe('s')
  })

  it('does not throw DataCloneError on Vue proxies (the cloneForIpc regression)', () => {
    const input = reactive({ filters: reactive({ nested: ref([1, 2]) }) })
    expect(() => stripVueProxies(input)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run — expect import failure (module doesn't exist).**

```bash
npx vitest run tests/renderer/utils/stripVueProxies.test.ts
```

- [ ] **Step 3: Implement.**

`src/renderer/src/utils/stripVueProxies.ts`:

```typescript
import { isRef, toRaw, unref } from 'vue'

/**
 * Sprint A A2: strip Vue reactive()/ref() proxies and deep-clone in one pass.
 *
 * Replaces renderer-side cloneForIpc — `structuredClone` throws DataCloneError
 * on Vue proxies; JSON round-trip works but is opaque. This walker handles
 * proxies natively, then returns plain JS that is safe to ship over IPC.
 *
 * Cross-process / main-side callers should use `cloneForIpc` (now backed by
 * structuredClone — see the shared util) on already-plain input.
 */
export function stripVueProxies<T>(value: T): T {
  return stripInner(value, new WeakMap()) as T
}

function stripInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value
  if (isRef(value)) return stripInner(unref(value), seen)
  if (typeof value !== 'object') return value

  const raw = toRaw(value as object)
  const cached = seen.get(raw)
  if (cached) return cached

  if (Array.isArray(raw)) {
    const arr: unknown[] = []
    seen.set(raw, arr)
    for (const item of raw) arr.push(stripInner(item, seen))
    return arr
  }

  const out: Record<string, unknown> = {}
  seen.set(raw, out)
  for (const k of Object.keys(raw)) {
    out[k] = stripInner((raw as Record<string, unknown>)[k], seen)
  }
  return out
}
```

- [ ] **Step 4: Run — expect pass.**

```bash
npx vitest run tests/renderer/utils/stripVueProxies.test.ts
```

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/src/utils/stripVueProxies.ts \
        tests/renderer/utils/stripVueProxies.test.ts
git commit -m "feat(renderer): add stripVueProxies utility for IPC param sanitisation

Sprint A PR-1 A2. Walks reactive()/ref() proxies and returns plain JS in one
pass, replacing the JSON-round-trip in cloneForIpc for renderer callers.
Handles cycles via WeakMap, unwraps refs transparently."
```

---

### Task PR1-8 (A2): Rewrite shared `cloneForIpc` body to use `structuredClone`

**Files:**
- Modify: `src/shared/utils/cloneForIpc.ts` — body becomes `return structuredClone(value)`.
- Create: `tests/main/utils/cloneForIpc.test.ts` — assert `structuredClone` semantics + `DataCloneError` on Vue proxies.

**Context:** Per A2 + Gate 5: `cloneForIpc` is now the cross-process / main-side helper for *already plain* input. `structuredClone` is faster and preserves structured-clone-algorithm semantics (Dates, Maps, etc.); the test ensures it throws on a renderer Vue proxy so anyone misusing it from the renderer gets a loud failure pointing them at `stripVueProxies`.

- [ ] **Step 1: Read the current implementation.**

```bash
cat src/shared/utils/cloneForIpc.ts
```

- [ ] **Step 2: Replace the body.**

```typescript
/**
 * Sprint A A2: cross-process / main-side deep clone.
 *
 * Use this when input is ALREADY plain JS (i.e. no Vue reactive()/ref()
 * proxies). For renderer state that may contain proxies, use
 * `src/renderer/src/utils/stripVueProxies.ts` — it strips and clones in one
 * pass; `structuredClone` would throw DataCloneError on a Vue proxy, which
 * is the loud failure mode we want when this helper is misused.
 */
export function cloneForIpc<T>(value: T): T {
  return structuredClone(value)
}
```

- [ ] **Step 3: Write the new shared-util test.**

`tests/main/utils/cloneForIpc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { cloneForIpc } from '../../../src/shared/utils/cloneForIpc'

describe('cloneForIpc — Sprint A A2', () => {
  it('deep-clones plain objects', () => {
    const input = { a: 1, b: { c: 2 }, d: [3, 4] }
    const out = cloneForIpc(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(out.b).not.toBe(input.b)
    expect(out.d).not.toBe(input.d)
  })

  it('preserves Date instances (structuredClone semantics, not JSON)', () => {
    const d = new Date('2026-05-28T00:00:00Z')
    const out = cloneForIpc({ d })
    expect(out.d).toBeInstanceOf(Date)
    expect(out.d.getTime()).toBe(d.getTime())
  })

  it('preserves Map / Set (structuredClone semantics)', () => {
    const m = new Map([['k', 1]])
    const s = new Set([1, 2])
    const out = cloneForIpc({ m, s })
    expect(out.m).toBeInstanceOf(Map)
    expect(out.m.get('k')).toBe(1)
    expect(out.s).toBeInstanceOf(Set)
    expect(out.s.has(2)).toBe(true)
  })

  it('throws on non-cloneable values (functions) — loud failure for misuse', () => {
    expect(() => cloneForIpc({ fn: () => 1 } as unknown as { fn: unknown })).toThrow(
      /DataCloneError|could not be cloned/i
    )
  })
})
```

- [ ] **Step 4: Run + the existing renderer cloneForIpc test.**

```bash
make rebuild-node
npx vitest run tests/main/utils/cloneForIpc.test.ts tests/renderer/utils/cloneForIpc.test.ts
```

The existing `tests/renderer/utils/cloneForIpc.test.ts` may start failing because it asserted JSON-round-trip semantics on Vue proxies. **Do not delete it** — convert each assertion: any test that exercised the "proxy strip" property migrates into `tests/renderer/utils/stripVueProxies.test.ts` (PR1-7 — extend if needed); any test that exercised "deep clone of plain JSON" stays valid against the new structuredClone body. The end state of `tests/renderer/utils/cloneForIpc.test.ts` should either be empty (delete it) or contain only assertions specific to the renderer re-export shim.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/utils/cloneForIpc.ts \
        tests/main/utils/cloneForIpc.test.ts \
        tests/renderer/utils/cloneForIpc.test.ts
git commit -m "refactor(shared): cloneForIpc body → structuredClone

Sprint A PR-1 A2. Cross-process / main-side cloneForIpc is now backed by
structuredClone — faster than JSON, preserves Date/Map/Set semantics, and
loudly throws DataCloneError on Vue proxies so anyone calling this helper
from the renderer is pointed at stripVueProxies instead.

Renderer-side test split: proxy-strip assertions migrated to
stripVueProxies.test.ts (PR1-7); plain-JSON assertions kept here."
```


---

### Task PR1-9 (A2): Migrate the four renderer consumers from `cloneForIpc` to `stripVueProxies`

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts:10` — replace import + call sites.
- Modify: `src/renderer/src/composables/useCohortData.ts:25` and `:323` — replace import + call sites.
- Modify: `src/renderer/src/components/FilterToolbar.vue:180` and `:460` — replace import + call sites.
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue:162` — replace import + call sites.
- Modify: `src/renderer/src/utils/cloneForIpc.ts` — convert from re-export shim to re-export of `stripVueProxies` (transitional) OR delete entirely if no consumers remain after this commit.

**Context:** Per A2 — these are the four renderer consumers. After this task, `grep -rln "from.*cloneForIpc" src/renderer/` returns zero hits other than re-export shims (Gate 5).

- [ ] **Step 1: Audit the call sites before editing.**

```bash
grep -rn "cloneForIpc" src/renderer/ 2>&1
```

Expected: imports + call sites in the four files above + the shim file. If anything else appears, surface to the controller.

- [ ] **Step 2: Migrate `useVariantData.ts`.**

```typescript
// Before
import { cloneForIpc } from '../../utils/cloneForIpc'
// ... cloneForIpc(filter.value)

// After
import { stripVueProxies } from '../../utils/stripVueProxies'
// ... stripVueProxies(filter.value)
```

- [ ] **Step 3: Migrate `useCohortData.ts`** (both lines 25 and 323).

```typescript
// Before
import { cloneForIpc } from '../utils/cloneForIpc'
// ... ipcParams.column_filters = cloneForIpc(params.column_filters)

// After
import { stripVueProxies } from '../utils/stripVueProxies'
// ... ipcParams.column_filters = stripVueProxies(params.column_filters)
```

- [ ] **Step 4: Migrate `FilterToolbar.vue`** (lines 180 + 460).

```vue
<script setup lang="ts">
// Before:
import { cloneForIpc } from '../utils/cloneForIpc'
// const plainFilters = cloneForIpc(filters.value)

// After:
import { stripVueProxies } from '../utils/stripVueProxies'
// const plainFilters = stripVueProxies(filters.value)
</script>
```

- [ ] **Step 5: Migrate `CohortFilterBar.vue`** (line 162).

Same shape: replace import + call.

- [ ] **Step 6: Delete the renderer shim** `src/renderer/src/utils/cloneForIpc.ts` only if `grep -rn "from.*renderer/src/utils/cloneForIpc\|from '\.\./.*cloneForIpc'" src/renderer/` returns zero hits. Otherwise leave the shim as a re-export of `stripVueProxies` with a deprecation TSDoc, scheduled for removal in a follow-up.

```bash
grep -rn "renderer/src/utils/cloneForIpc\|from.*['\"].*cloneForIpc['\"]" src/renderer/ 2>&1
```

If zero hits remain after the four migrations: `git rm src/renderer/src/utils/cloneForIpc.ts`.

- [ ] **Step 7: Verify Gate 5 grep.**

```bash
grep -rln "from.*cloneForIpc" src/renderer/
```

Expected: zero output (the shim was deleted) OR only the shim itself (if kept). The four consumer files MUST be absent.

- [ ] **Step 8: Run typecheck + the affected renderer test suites.**

```bash
make typecheck
make rebuild-node
npx vitest run tests/renderer/
```

Expected: pass. If any renderer test imported `cloneForIpc` directly, migrate it to `stripVueProxies` in the same commit.

- [ ] **Step 9: Commit.**

```bash
git add src/renderer/src/components/variant-table/useVariantData.ts \
        src/renderer/src/composables/useCohortData.ts \
        src/renderer/src/components/FilterToolbar.vue \
        src/renderer/src/components/cohort/CohortFilterBar.vue \
        src/renderer/src/utils/cloneForIpc.ts \
        tests/renderer/
git commit -m "refactor(renderer): migrate 4 cloneForIpc consumers to stripVueProxies

Sprint A PR-1 A2 (Gate 5). Replaces renderer-side cloneForIpc imports in:
  - components/variant-table/useVariantData.ts
  - composables/useCohortData.ts
  - components/FilterToolbar.vue
  - components/cohort/CohortFilterBar.vue

stripVueProxies handles Vue reactive/ref proxies natively in one pass; the
shared cloneForIpc is now reserved for already-plain (cross-process) input.

grep -rln 'from.*cloneForIpc' src/renderer/ → empty."
```

---

### Task PR1-10 (A2, Pass-9 #4): Centralise strip-proxy inside filter serialization

**Files:**
- Modify: `src/shared/filters/filterSerialization.ts` — the three exported APIs (`buildFilterIpcParams`, `buildVariantFilterFromState`, `buildIpcParams`) begin with `stripVueProxies` internally rather than relying on each caller to strip first.
- Create: `tests/renderer/utils/filters/filterSerialization-reactive-input.test.ts` — asserts reactive input produces structurally-identical output to plain JS input.

**Context:** Per Pass-9 #4. The current contract was "callers strip first" — brittle because multiple call sites in `useFilterState.ts:104` and `useFilters.ts:304` would need to remember. Centralise the strip-proxy step inside each function.

Note: `src/shared/filters/filterSerialization.ts` imports `cloneForIpc` from `../utils/cloneForIpc` (which is now `structuredClone`-backed). It needs to additionally import `stripVueProxies` — but `stripVueProxies` is renderer-only (depends on Vue). To keep the shared module renderer-safe AND main-safe, we have two options:
  1. Move `filterSerialization.ts` into renderer-only (`src/renderer/src/utils/filters/filterSerialization.ts`). It's already imported via `src/renderer/src/utils/filters/index.ts:19-20` from there as a re-export. Check whether the main process imports it directly.
  2. Inject `stripVueProxies` via the function signature, defaulting to identity for main-side callers.

**Read first to pick the right path:**

```bash
grep -rn "filterSerialization\|buildFilterIpcParams\|buildVariantFilterFromState\|buildIpcParams" src/main/ src/web/ 2>&1 | head
grep -n "stripVueProxies\|cloneForIpc" src/shared/filters/filterSerialization.ts | head
```

If `src/main/` or `src/web/` does NOT import these three functions, **option 1** (move to renderer-only) is the cleaner answer. If they do, take **option 2** (parameterise).

- [ ] **Step 1: Decide and document the path in the commit message.**

- [ ] **Step 2: Write the failing test.**

`tests/renderer/utils/filters/filterSerialization-reactive-input.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'
import {
  buildFilterIpcParams,
  buildVariantFilterFromState,
  buildIpcParams
} from '../../../../src/renderer/src/utils/filters/filterSerialization'

describe('filterSerialization — reactive input handling (Pass-9 #4)', () => {
  const baseState = {
    columnFilters: { gnomad_af: { max: 0.01 }, cadd: { min: 20 } },
    searchQuery: 'BRCA1'
  }

  it('buildFilterIpcParams handles reactive input and produces identical output to plain', () => {
    const reactiveState = reactive({ ...baseState, columnFilters: reactive(baseState.columnFilters) })
    const fromReactive = buildFilterIpcParams(reactiveState)
    const fromPlain = buildFilterIpcParams(baseState)
    expect(fromReactive).toEqual(fromPlain)
    expect(() => JSON.stringify(fromReactive)).not.toThrow()
  })

  it('buildVariantFilterFromState handles reactive input', () => {
    const reactiveState = reactive({ ...baseState, columnFilters: reactive(baseState.columnFilters) })
    const fromReactive = buildVariantFilterFromState(reactiveState, 'snv')
    const fromPlain = buildVariantFilterFromState(baseState, 'snv')
    expect(fromReactive).toEqual(fromPlain)
  })

  it('buildIpcParams handles reactive nested with ref()', () => {
    const reactiveState = reactive({
      ...baseState,
      columnFilters: reactive({ gnomad_af: { max: ref(0.01) } })
    })
    expect(() => buildIpcParams(reactiveState)).not.toThrow()
  })
})
```

- [ ] **Step 3: Run — expect failure.**

```bash
make rebuild-node
npx vitest run tests/renderer/utils/filters/filterSerialization-reactive-input.test.ts
```

Expected: fail (possibly DataCloneError or reactivity leak into IPC params).

- [ ] **Step 4: Implement.** In the chosen `filterSerialization.ts` location, at the top of each exported function:

```typescript
import { stripVueProxies } from '../stripVueProxies'  // adjust import path

export function buildFilterIpcParams(state: FilterState): IpcParams {
  const plainState = stripVueProxies(state) as FilterState
  // ... existing body, but operate on plainState throughout
}

export function buildVariantFilterFromState(state: FilterState, type: VariantType): VariantFilter {
  const plainState = stripVueProxies(state) as FilterState
  // ... existing body against plainState
}

export function buildIpcParams(state: FilterStateWithSearch): IpcParams {
  const plainState = stripVueProxies(state) as FilterStateWithSearch
  // ... existing body against plainState
}
```

If option 1 (move to renderer-only): `git mv src/shared/filters/filterSerialization.ts src/renderer/src/utils/filters/filterSerialization.ts` and update imports — the re-export at `src/renderer/src/utils/filters/index.ts:19-20` already points there logically.

- [ ] **Step 5: Run — expect pass.**

```bash
npx vitest run tests/renderer/utils/filters/ tests/renderer/
```

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/utils/filters/ src/shared/filters/ \
        tests/renderer/utils/filters/filterSerialization-reactive-input.test.ts
git commit -m "fix(renderer): centralise stripVueProxies inside filter serialization

Sprint A PR-1 A2 (Pass-9 #4). buildFilterIpcParams,
buildVariantFilterFromState, and buildIpcParams now strip Vue proxies
internally so callers in useFilterState.ts:104 and useFilters.ts:304 can
pass reactive input directly without remembering to strip first.

[Document the option chosen: moved to renderer-only / parameterised /
inlined import — based on grep of main/web call sites.]"
```

---

### Task PR1-11 (A2, optional polish): Add memoised `clonedFilter` to `useVariantFilters`

**Files:**
- Modify: `src/renderer/src/composables/useVariantFilters.ts` (if it exists) — add `clonedFilter = computed(() => stripVueProxies(filter.value))` keyed by `filterKey`.

**Context:** Per A2 final paragraph. Page-flip + prefetch share the cloned object so we don't re-strip on every IPC round-trip.

```bash
ls src/renderer/src/composables/useVariantFilters.ts 2>&1
grep -n "filterKey\|filter.value\|cloneForIpc\|stripVueProxies" src/renderer/src/composables/useVariantFilters.ts 2>&1 | head -20
```

**If the file does not exist, skip this task** — the spec calls out this composable by name; if it has been renamed since the spec was written, surface to the controller. The memoisation is opportunistic; the A2 gate (Gate 5 grep + the filterSerialization tests) is already satisfied by PR1-9 + PR1-10.

- [ ] **Step 1: Confirm the file exists.** Skip the rest if not.
- [ ] **Step 2: Add the memoised computed.**

```typescript
import { computed } from 'vue'
import { stripVueProxies } from '../utils/stripVueProxies'

// ... inside the composable body, after filter + filterKey are defined
const clonedFilter = computed(() => stripVueProxies(filter.value))
```

Expose `clonedFilter` so the consumers that previously called `stripVueProxies(filter.value)` per use can read it instead.

- [ ] **Step 3: Run renderer tests.**

```bash
npx vitest run tests/renderer/
```

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/src/composables/useVariantFilters.ts
git commit -m "perf(renderer): memoise clonedFilter in useVariantFilters

Sprint A PR-1 A2 (polish). Page-flip + prefetch share a single
stripVueProxies result keyed by filterKey — no re-strip on every IPC."
```

---

### Task PR1-12 (A3): FilterToolbar deferred mount — CaseView (Pass-9 #3)

**Files:**
- Modify: `src/renderer/src/views/CaseView.vue` around `:360-367` (the per-type-region block).
- Modify: `src/renderer/src/composables/useFilterLifecycle.ts` (if it exists) — gate `loadFilterOptions` watcher behind a `visibleRef: Ref<boolean>` argument.

**Context:** Per A3 + Pass-9 #3. **DO NOT swap `v-show` for `v-if` on the outer region** — the inline comment at `CaseView.vue:362` explicitly requires `v-show` to preserve VariantTable selection/scroll/expansion across Shortlist toggling. Gate ONLY the inner FilterToolbar with `v-if="firstActivated"`.

Flip condition: `firstActivated` becomes true when `typeCountsLoaded && selectedVariantType !== 'shortlist'`. Once true, never resets.

- [ ] **Step 1: Read the existing block.**

```bash
sed -n '355,380p' src/renderer/src/views/CaseView.vue
grep -n "typeCounts\|selectedVariantType\|firstActivated" src/renderer/src/views/CaseView.vue | head -20
grep -n "loadFilterOptions\|useFilterLifecycle" src/renderer/src/composables/useFilterLifecycle.ts 2>&1 | head
```

- [ ] **Step 2: Add the activation state.**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'

// ... existing state including typeCounts, typeCountsLoaded (or equivalent),
// and selectedVariantType.

const firstActivated = ref(false)

// Pass-8 fit-to-100% + Pass-9 #3: flips true when typeCountsLoaded becomes
// true AND we are not on the shortlist tab. Once true, never resets — the
// user can toggle freely between filter and shortlist without remounting.
watch(
  [typeCountsLoaded, selectedVariantType],
  ([loaded, type]) => {
    if (loaded && type !== 'shortlist' && !firstActivated.value) {
      firstActivated.value = true
    }
  },
  { immediate: true }
)
</script>
```

If the existing state uses a different sentinel for "type counts have arrived" (e.g. `typeCounts.value !== null` rather than a separate `typeCountsLoaded`), use that — the spec's flip condition is *semantic* ("typeCounts is populated"), not name-bound.

- [ ] **Step 3: Gate ONLY the inner FilterToolbar with `v-if="firstActivated"`. Leave the outer per-type region on `v-show` unchanged.**

```vue
<!-- outer region: v-show preserved (do NOT change to v-if) -->
<div v-show="selectedVariantType !== 'shortlist'" class="per-type-region">
  <div class="filter-bar-container">
    <FilterToolbar v-if="firstActivated" :filters="filters" ... />
  </div>
  <VariantTable :rows="rows" ... />  <!-- always mounted -->
</div>
```

- [ ] **Step 4: Update `useFilterLifecycle` to gate `loadFilterOptions` on the visibility ref.**

```typescript
import type { Ref } from 'vue'

export function useFilterLifecycle({
  caseId,
  visibleRef
}: {
  caseId: Ref<number>
  visibleRef?: Ref<boolean>
}): /* ... */ {
  // ... existing setup
  watch(
    [caseId, visibleRef ?? ref(true)],
    ([id, visible]) => {
      if (!visible) return
      loadFilterOptions(id)
    },
    { immediate: true }
  )
  // ... rest
}
```

CaseView passes `firstActivated` as `visibleRef`. If `useFilterLifecycle` has a different shape, adapt — the principle is "do not fire `loadFilterOptions` until firstActivated".

- [ ] **Step 5: Build + smoke in dev.**

```bash
make typecheck
make rebuild-node
npx vitest run tests/renderer/
```

For a real UI smoke (mandatory because A3 is a UX change), launch the dev app and verify:
- Open a case → filter toolbar appears once type counts arrive (one tick after mount).
- Switch to Shortlist → VariantTable persists (selection/scroll preserved). Switch back → no remount.

```bash
make dev   # in a separate terminal; verify the two flows above manually
```

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/views/CaseView.vue \
        src/renderer/src/composables/useFilterLifecycle.ts
git commit -m "perf(renderer): defer FilterToolbar mount until type counts load

Sprint A PR-1 A3 (CaseView half, Pass-9 #3). Outer per-type region keeps
v-show (preserves VariantTable selection/scroll across Shortlist toggling
per the existing inline comment). FilterToolbar wrapped in v-if=firstActivated
flips on typeCountsLoaded && !shortlist; never resets.

Closes audit §3.9 (CaseView half)."
```

---

### Task PR1-13 (A3): FilterToolbar deferred mount — CohortView parity (mandatory same-PR)

**Files:**
- Modify: `src/renderer/src/views/CohortView.vue` (or the cohort root) — apply the same `firstActivated` pattern to the cohort filter toolbar.

**Context:** Per A3 final sentence: "Cohort-view parity: same pattern applied to `CohortView`'s filter toolbar in the same PR." This is non-negotiable per `feedback_cohort_parity.md` — every filter/sort/search/column-meta change ships cohort parity in the same PR.

- [ ] **Step 1: Locate the cohort filter region.**

```bash
grep -rn "CohortFilterBar\|firstActivated\|typeCounts\|loadFilterOptions" src/renderer/src/views/CohortView.vue src/renderer/src/views/cohort/ 2>&1 | head -20
```

- [ ] **Step 2: Apply the same `firstActivated` gate.** The cohort view does not have a "shortlist tab" toggle, but the principle is "don't mount the filter toolbar until cohort metadata has arrived." Use whatever the cohort equivalent of `typeCountsLoaded` is (e.g. `cohortColumnMetaLoaded`, `getColumnMeta` resolved). If no such signal exists, fall back to `cohortLoaded` or the first successful cohort fetch.

```vue
<div class="cohort-filter-container">
  <CohortFilterBar v-if="firstActivated" :filters="filters" ... />
</div>
<CohortVariantTable :rows="rows" ... />
```

- [ ] **Step 3: Run + smoke.**

```bash
make typecheck
npx vitest run tests/renderer/
make dev   # verify cohort view: FilterBar arrives after metadata loads
```

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/src/views/CohortView.vue \
        src/renderer/src/views/cohort/
git commit -m "perf(renderer): defer CohortFilterBar mount — A3 cohort parity

Sprint A PR-1 A3 (CohortView half). Mirrors the CaseView pattern: cohort
filter bar is gated v-if=firstActivated and flips on cohort-metadata load.

Required by feedback_cohort_parity.md — every filter/sort change ships
cohort parity in the same PR."
```

---

### Task PR1-14 (A4): shallowRef + markRaw conversion for `useShortlistQuery.ts:66`

**Files:**
- Modify: `src/renderer/src/composables/useShortlistQuery.ts` around line 66 — convert the row buffer from `ref<Row[]>` to `shallowRef<Row[]>` and `markRaw` each ingested row.

**Context:** Per A4 + Pass-9 #10. Most renderer row holders already use `shallowRef`/`markRaw`; the audit-confirmed remaining target is `useShortlistQuery.ts:66`. A grep at PR-creation time may surface more — if so, each conversion gets its own commit.

- [ ] **Step 1: Run the audit grep at PR-execution time.**

```bash
rg "ref<.*Variant.*\[\]>|ref<Row\[\]>|ref<.*Cohort.*\[\]>" src/renderer/src/composables src/renderer/src/stores
```

Add a one-task-per-hit follow-up to this task list if anything beyond `useShortlistQuery.ts:66` appears. The spec's "freeze today's `useShortlistQuery.ts:66` as the known target" rule still applies — this task only handles that one file.

- [ ] **Step 2: Read the current shape.**

```bash
sed -n '60,80p' src/renderer/src/composables/useShortlistQuery.ts
```

- [ ] **Step 3: Convert.**

```typescript
// Before
import { ref } from 'vue'
const rows = ref<Row[]>([])
// rows.value = fetchedRows

// After
import { shallowRef, markRaw } from 'vue'
const rows = shallowRef<Row[]>([])
// rows.value = fetchedRows.map((r) => markRaw(r))
```

Every assignment site for `rows.value` must `.map((r) => markRaw(r))` the incoming rows. Insertions (push/splice) also `markRaw` the new item.

- [ ] **Step 4: Capture renderer-perf before/after** (per A4 process rule):

```bash
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls -lt .planning/artifacts/perf/phase1/ | head -2
```

Record the artifact name; the comparison goes in the PR body as evidence for Gate 3.

- [ ] **Step 5: Run.**

```bash
make typecheck
make rebuild-node
npx vitest run tests/renderer/
```

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/src/composables/useShortlistQuery.ts
git commit -m "perf(renderer): shallowRef + markRaw for shortlist row buffer

Sprint A PR-1 A4 (Pass-9 #10). useShortlistQuery row buffer converted from
ref<Row[]> to shallowRef<Row[]> with markRaw on each ingested row, cutting
Vue's per-row proxy overhead on the shortlist hot path.

Before/after renderer-perf-phase1 artifacts captured in PR description."
```

---

### PR-1 acceptance gates

Before opening the PR, run the gate checks. Each maps 1:1 to the spec.

- [ ] **Gate 1 — `make ci-full` green.**

```bash
make ci-full
```

- [ ] **Gate 2 — `VARLENS_WEB=1 make ci` green.**

```bash
VARLENS_WEB=1 make ci
```

- [ ] **Gate 3 — renderer-perf-phase1 ≥ 20% improvement on geometric mean of `case-select-visible-rows` and `page-next-prev`, both non-regressed (Pass-9 #10).**

```bash
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls -lt .planning/artifacts/perf/phase1/ | head -5
```

Compare the latest artifact against the PR-1 baseline captured during Pre-flight. Compute geometric mean of medians for the two workflows. If improvement < 20%, the PR is not ready — investigate before opening. If either individual workflow regressed, the PR is not ready.

- [ ] **Gate 4 — `tests/main/database/annotation-repository-batch.test.ts` green with N=50 → 2 prepares.**

```bash
make rebuild-node
npx vitest run tests/main/database/annotation-repository-batch.test.ts
```

- [ ] **Gate 5 — `cloneForIpc` migration grep returns zero hits in `src/renderer/`** other than re-export shims.

```bash
grep -rln "from.*cloneForIpc" src/renderer/
```

Expected: zero output, or only `src/renderer/src/utils/cloneForIpc.ts` itself if it survived as a deprecation shim.

- [ ] **Gate 10a — preload-contract test for `BatchAnnotationKey.variantId?` green.**

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

- [ ] **Open the PR with the prescribed title.**

```bash
gh pr create --title "perf(renderer): annotation N+1, ipc clone, filter toolbar visibility, shallowRef audit" \
  --body "$(cat <<'EOF'
## Summary

Sprint A PR-1 — renderer perf foundations. Four sub-items per the spec:

- **A1** AnnotationRepository.getBatch N+1 → 2 batched SELECTs (SQLite) + UNNEST-array mirror (PG). New covering index `idx_variants_coords` on both backends (PG migration 0009, SQLite v29). BatchAnnotationKey gains optional `variantId` with defensive `cva.case_id = $caseId AND v.case_id = $caseId` join (Pass-8 #2).
- **A2** Renderer `stripVueProxies` utility + shared `cloneForIpc` → `structuredClone`. 4 consumer migrations + Pass-9 #4 centralisation inside `buildFilterIpcParams` / `buildVariantFilterFromState` / `buildIpcParams`.
- **A3** FilterToolbar deferred mount on **CaseView AND CohortView** (cohort parity per `feedback_cohort_parity.md`). Outer per-type region keeps `v-show` (preserves VariantTable selection/scroll — Pass-9 #3).
- **A4** `useShortlistQuery.ts:66` row buffer → `shallowRef` + `markRaw` (Pass-9 #10).

Spec: `.planning/specs/2026-05-28-sprint-a-foundations.md`

## Verification

- [x] Gate 1 — `make ci-full` green
- [x] Gate 2 — `VARLENS_WEB=1 make ci` green
- [x] Gate 3 — renderer-perf-phase1 ≥ 20% improvement on geomean of `case-select-visible-rows` + `page-next-prev` medians (paste numbers below)
- [x] Gate 4 — `tests/main/database/annotation-repository-batch.test.ts` — exactly 2 prepares for N=50
- [x] Gate 5 — `grep -rln "from.*cloneForIpc" src/renderer/` → zero hits
- [x] Gate 10a — preload-contract test for `BatchAnnotationKey.variantId?` green

### Renderer perf comparison

Before (pre-PR-1 main): `<paste artifact filename + medians>`
After (PR-1 tip):       `<paste artifact filename + medians>`
Geometric mean of medians improvement: `<XX.X%>`

### EXPLAIN ANALYZE — `idx_variants_coords` (Gate 3 narrative)

PG before: `<paste planner choice>`
PG after:  `<paste — expect Bitmap Index Scan on variants_coords>`

SQLite before: `<paste EXPLAIN QUERY PLAN>`
SQLite after:  `<paste — expect SEARCH idx_variants_coords>`
EOF
)"
```

After PR-1 merges, the **0.66.0** tag can be cut per the runbook (promote `[Unreleased]`, bump `package.json`, tag).

---

# PR-2 — `perf(postgres): named/prepared statement rollout for top-20 read sites`

**Branch:** `perf/postgres-named-statements`
**Tasks:** B0 (bootstrap-baseline prereq), B1, B3 (counters first), B2, B4 (enforcement), B-coverage (gate 6)
**Audit ref:** §3.6
**Independent of PR-1. Tag target:** `0.66.x` or `0.67.0`.

**Why B3 comes before B2 in this plan:** B2's rollout depends on the counter proxy existing so its impact is measurable. Spec lists them B1-B4 by sub-item label, not by build order.

---

### Task PR2-0: Branch + baseline freeze

- [ ] **Step 1: Cut the branch from `main`** (post-PR-1 if PR-1 has landed; otherwise from `main` directly — PR-1 and PR-2 are independent per spec).

```bash
git checkout main && git pull --ff-only
git checkout -b perf/postgres-named-statements
```

No commit yet.

---

### Task PR2-1 (B4-prereq): Add `--bootstrap-postgres-baseline` flag to `check-agent-health.mjs`

**Files:**
- Modify: `scripts/check-agent-health.mjs` — add CLI flag + grep impl + JSON output writer.
- Create: `scripts/agent-health-postgres-baseline.json` — committed by Step 4 below; numbers come from running the new flag.

**Context:** Per B4. The first PR-2 commit must implement the flag, then run it to capture the current `pool.query(<literal string>)` violation count in PG repositories, then commit the resulting JSON as the baseline. The baseline shrinks naturally as B2 lands; the enforcement step (PR2-11) hooks the diff.

The grep heuristic per B4: any `src/main/storage/postgres/**/*Repository.ts` file that calls `pool.query(` with a string-literal first argument (i.e. `pool.query('SELECT ...')` or `pool.query(\`SELECT ...\``) and does NOT route through `runNamed` / `runNamedDynamic`.

- [ ] **Step 1: Read the existing `check-agent-health.mjs` to match style.**

```bash
sed -n '1,60p' scripts/check-agent-health.mjs
grep -n "process.argv\|--bootstrap\|baseline" scripts/check-agent-health.mjs | head
```

- [ ] **Step 2: Add the new CLI branch + function.**

Append near the top-level dispatch:

```javascript
const args = process.argv.slice(2)
if (args.includes('--bootstrap-postgres-baseline')) {
  await bootstrapPostgresBaseline()
  process.exit(0)
}

async function bootstrapPostgresBaseline() {
  const { readdirSync, readFileSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const repoDir = 'src/main/storage/postgres'
  const violations = []
  for (const f of readdirSync(repoDir)) {
    if (!f.endsWith('Repository.ts')) continue
    const text = readFileSync(join(repoDir, f), 'utf-8')
    const lines = text.split('\n')
    lines.forEach((line, idx) => {
      // Match pool.query('...') OR pool.query(`...`) OR client.query('...')
      // that is NOT inside a runNamed / runNamedDynamic call. Heuristic: the
      // call begins with pool.query or client.query, followed immediately by
      // a string literal opener.
      const m = line.match(/\b(pool|client)\.query\(\s*['"`]/)
      if (m) {
        violations.push({ file: f, line: idx + 1, snippet: line.trim().slice(0, 120) })
      }
    })
  }
  const baseline = {
    generatedAt: new Date().toISOString(),
    count: violations.length,
    violations: violations.sort((a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line
    )
  }
  writeFileSync(
    'scripts/agent-health-postgres-baseline.json',
    JSON.stringify(baseline, null, 2) + '\n'
  )
  console.log(`Bootstrap baseline: ${baseline.count} violations across ${new Set(violations.map((v) => v.file)).size} files`)
  console.log(`Wrote scripts/agent-health-postgres-baseline.json`)
}
```

The heuristic is intentionally permissive — false positives are acceptable in the baseline because PR-2 will retire violations, not add them. False negatives are the failure mode to avoid (a real `pool.query('SELECT ...')` that the grep misses).

- [ ] **Step 3: Run the flag.**

```bash
node scripts/check-agent-health.mjs --bootstrap-postgres-baseline
cat scripts/agent-health-postgres-baseline.json | head -30
```

Expected: a JSON file with a `count: N` and an array of violations. **Record `N` here**: this is the baseline. PR-2 must not increase it; ideally it shrinks toward zero as B2 lands.

- [ ] **Step 4: Commit both — the flag impl + the baseline JSON.**

```bash
git add scripts/check-agent-health.mjs scripts/agent-health-postgres-baseline.json
git commit -m "chore(agent-check): add --bootstrap-postgres-baseline flag

Sprint A PR-2 B4 prereq. Generates scripts/agent-health-postgres-baseline.json
listing every pool.query(<literal>) site in PG repositories at PR-creation
time. PR-2's B1-B3 rollout shrinks this set; the agent-check enforcement
(PR2-11) hooks the count and refuses any new violation.

Initial count: $(node -p \"require('./scripts/agent-health-postgres-baseline.json').count\") (recorded for spec traceability)."
```

(Substitute the actual count in the commit message manually — the heredoc-substitution form above is illustrative.)

---

### Task PR2-2 (B1): Implement `runNamed` + `runNamedDynamic` helpers

**Files:**
- Create: `src/main/storage/postgres/named-query.ts`
- Create: `tests/main/storage/postgres-named-query.test.ts`

**Context:** Per B1 + Pass-3 MED #4 + Pass-6 MED-LOW #5 + Pass-9 #2.

Effective prepared-statement name: `${name}@${schemaToken(schema)}` for `runNamed`; `${baseName}:t${sha1(text).slice(0,8)}@${schemaToken(schema)}` for `runNamedDynamic`.

`schemaToken(schema)`: `${slug}_${hash6}` where `slug = schema.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)`, `hash6 = sha1(schema).slice(0, 6)`. Hash tail ALWAYS appended (avoids `Case Lab`/`case-lab`/`case_lab` slug collisions).

Process-level effective-name cap for `runNamedDynamic` only: maintain a global `Set<string>` of all effective names ever issued; when size exceeds `Math.max(64, 16 * top20Size)`, new dynamic calls fall back to unnamed `pool.query(text, values)` and log once at WARN.

Wrapper catches PG error codes `26000` / `42704` and retries once unnamed. Does NOT swallow node-postgres's CLIENT-side "Prepared statements must be unique" — that surfaces with a hint about the version-suffix rule.

- [ ] **Step 1: Write the failing tests.**

`tests/main/storage/postgres-named-query.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  runNamed,
  runNamedDynamic,
  schemaToken
} from '../../../src/main/storage/postgres/named-query'

describe('schemaToken — Sprint A B1 (Pass-3 MED #4)', () => {
  it('always appends the hash6 tail', () => {
    expect(schemaToken('public')).toMatch(/^public_[0-9a-f]{6}$/)
  })

  it('disambiguates Case Lab vs case-lab vs case_lab', () => {
    const a = schemaToken('Case Lab')
    const b = schemaToken('case-lab')
    const c = schemaToken('case_lab')
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
  })

  it('accepts quoted/weird schema names without producing PG-illegal identifiers', () => {
    const t = schemaToken('"weird-schema"')
    expect(t).toMatch(/^[a-z0-9_]+_[0-9a-f]{6}$/)
  })

  it('caps slug to 24 chars before the hash', () => {
    const longSchema = 'a'.repeat(100)
    const t = schemaToken(longSchema)
    // slug 24 + '_' + hash6 = 31 chars
    expect(t.length).toBe(31)
  })
})

describe('runNamed — Sprint A B1', () => {
  it('builds effective name as `${name}@${schemaToken}`', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamed(pool, {
      name: 'variants:query:v1',
      text: 'SELECT 1',
      values: [],
      schema: 'public'
    })

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^variants:query:v1@public_[0-9a-f]{6}$/),
      text: 'SELECT 1',
      values: []
    }))
  })

  it('forbids "@" in logical name', async () => {
    const pool = { query: vi.fn() } as unknown as Pool
    await expect(
      runNamed(pool, {
        name: 'variants:bad@name',
        text: 'SELECT 1',
        values: [],
        schema: 'public'
      })
    ).rejects.toThrow(/logical name.*must not contain.*@/i)
  })

  it('retries unnamed on PG error 26000 (Pass-6 MED-LOW #5 server-side path)', async () => {
    let call = 0
    const queryMock = vi.fn().mockImplementation(async (q: { name?: string }) => {
      call++
      if (call === 1) {
        const err = new Error('prepared statement does not exist') as Error & { code: string }
        err.code = '26000'
        throw err
      }
      return { rows: [{ ok: true }], rowCount: 1 }
    })
    const pool = { query: queryMock } as unknown as Pool

    const result = await runNamed(pool, {
      name: 'foo:bar:v1', text: 'SELECT 1', values: [], schema: 'public'
    })

    expect(call).toBe(2)
    expect(queryMock.mock.calls[1][0]).not.toHaveProperty('name')
    expect(result.rows[0]).toEqual({ ok: true })
  })

  it('does NOT swallow client-side "Prepared statements must be unique"', async () => {
    const queryMock = vi.fn().mockRejectedValue(
      new Error("Prepared statements must be unique - 'foo:bar:v1@public_abc123' was used for a different statement")
    )
    const pool = { query: queryMock } as unknown as Pool

    await expect(
      runNamed(pool, { name: 'foo:bar:v1', text: 'SELECT 1', values: [], schema: 'public' })
    ).rejects.toThrow(/Prepared statements must be unique/i)
    expect(queryMock).toHaveBeenCalledOnce()  // no retry on client-side error
  })
})

describe('runNamedDynamic — Sprint A B1 (Pass-8 #3)', () => {
  it('appends a :t<sha1-8> tail to the base name', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamedDynamic(pool, {
      baseName: 'variants:queryVariants',
      text: 'SELECT * FROM variants WHERE id = $1',
      values: [1],
      schema: 'public'
    })

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^variants:queryVariants:t[0-9a-f]{8}@public_[0-9a-f]{6}$/),
      text: 'SELECT * FROM variants WHERE id = $1'
    }))
  })

  it('produces distinct effective names for distinct SQL text', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamedDynamic(pool, {
      baseName: 'q', text: 'SELECT 1', values: [], schema: 'public'
    })
    await runNamedDynamic(pool, {
      baseName: 'q', text: 'SELECT 2', values: [], schema: 'public'
    })
    const n1 = queryMock.mock.calls[0][0].name as string
    const n2 = queryMock.mock.calls[1][0].name as string
    expect(n1).not.toBe(n2)
  })

  it('falls back to unnamed once the effective-name cap is exceeded (Pass-9 #2)', async () => {
    // Implementation detail: cap is process-level, configurable via a test-only
    // setter exposed by the module (e.g. __setCapForTests(n)). Set a small cap
    // and overflow it.
    const { __setCapForTests, __resetCapForTests } = await import(
      '../../../src/main/storage/postgres/named-query'
    )
    __setCapForTests(2)
    try {
      const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      const pool = { query: queryMock } as unknown as Pool
      for (let i = 0; i < 5; i++) {
        await runNamedDynamic(pool, {
          baseName: 'q', text: `SELECT ${i}`, values: [], schema: 'public'
        })
      }
      // First two calls are named; remaining fall back to unnamed.
      const namedCalls = queryMock.mock.calls.filter((c) => c[0].name).length
      expect(namedCalls).toBe(2)
    } finally {
      __resetCapForTests()
    }
  })
})
```

- [ ] **Step 2: Run — expect import failures.**

```bash
make rebuild-node
npx vitest run tests/main/storage/postgres-named-query.test.ts
```

- [ ] **Step 3: Implement `src/main/storage/postgres/named-query.ts`.**

```typescript
import { createHash } from 'crypto'
import type { Pool, QueryResult } from 'pg'
import { mainLogger } from '../../services/MainLogger'

/**
 * Sprint A PR-2 B1 — named/prepared statement helpers.
 *
 * `runNamed`: static-SQL call sites. SQL text is constant per logical name.
 * `runNamedDynamic`: dynamic-SQL call sites (queryVariants etc.). SQL text
 *   varies; the effective name carries a :t<sha1-8> tail keyed by text.
 *
 * Effective name format:
 *   runNamed:        `${name}@${schemaToken(schema)}`
 *   runNamedDynamic: `${baseName}:t${sha1(text).slice(0,8)}@${schemaToken(schema)}`
 *
 * Why `@${schemaToken}`: PG repositories interpolate the schema name into the
 * SQL text via the `"__schema__"."<table>"` placeholder — the same logical
 * query against two schemas has different text after interpolation. Without
 * per-schema name isolation, a connection that has prepared `foo:v1` against
 * schema A errors or mis-resolves when re-used against schema B (Codex Pass-1
 * #3 + Pass-2 verdict #2).
 *
 * Why `schemaToken` ALWAYS appends hash6: `Case Lab`/`case-lab`/`case_lab`
 * slug to the same `case_lab` (Pass-3 MED #4). The hash disambiguates.
 *
 * Version-suffix rule: when a `runNamed` call's SQL text changes, bump the
 * `name` (e.g. `foo:bar:v1` → `foo:bar:v2`). node-postgres CLIENT-side
 * `parsedStatements[name]` check at `pg/lib/query.js:156` rejects same-name
 * different-text BEFORE the server sees the query — the wrapper's
 * 26000/42704 retry cannot save you. Enforced by an agent-check grep
 * (PR2-11 adds the rule).
 *
 * `runNamedDynamic` cap: process-level effective-name Set. When size exceeds
 * `Math.max(64, 16 * top20Size)`, new dynamic calls fall back to unnamed
 * pool.query and log once at WARN (Pass-9 #2).
 */

const seenDynamicNames = new Set<string>()
const TOP20_SIZE_DEFAULT = 20
let dynamicNameCap = Math.max(64, 16 * TOP20_SIZE_DEFAULT)
let dynamicCapLogged = false

export function schemaToken(schema: string): string {
  const slug = schema.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)
  const hash6 = createHash('sha1').update(schema).digest('hex').slice(0, 6)
  return `${slug}_${hash6}`
}

export interface RunNamedSpec {
  name: string
  text: string
  values: unknown[]
  schema: string
}

export interface RunNamedDynamicSpec {
  baseName: string
  text: string
  values: unknown[]
  schema: string
}

export async function runNamed<R>(
  pool: Pool,
  spec: RunNamedSpec
): Promise<QueryResult<R>> {
  if (spec.name.includes('@')) {
    throw new Error(
      `runNamed: logical name "${spec.name}" must not contain "@" (reserved as the schema-token separator).`
    )
  }
  const effectiveName = `${spec.name}@${schemaToken(spec.schema)}`
  return executeWithFallback(pool, effectiveName, spec.text, spec.values)
}

export async function runNamedDynamic<R>(
  pool: Pool,
  spec: RunNamedDynamicSpec
): Promise<QueryResult<R>> {
  if (spec.baseName.includes('@')) {
    throw new Error(
      `runNamedDynamic: baseName "${spec.baseName}" must not contain "@".`
    )
  }
  const textHash = createHash('sha1').update(spec.text).digest('hex').slice(0, 8)
  const effectiveName = `${spec.baseName}:t${textHash}@${schemaToken(spec.schema)}`

  if (seenDynamicNames.size >= dynamicNameCap && !seenDynamicNames.has(effectiveName)) {
    if (!dynamicCapLogged) {
      mainLogger.warn(
        `runNamedDynamic cap exceeded (${seenDynamicNames.size}); falling back to unnamed queries`,
        'postgres-named-query'
      )
      dynamicCapLogged = true
    }
    return pool.query(spec.text, spec.values as unknown[]) as Promise<QueryResult<R>>
  }
  seenDynamicNames.add(effectiveName)
  return executeWithFallback(pool, effectiveName, spec.text, spec.values)
}

async function executeWithFallback<R>(
  pool: Pool,
  name: string,
  text: string,
  values: unknown[]
): Promise<QueryResult<R>> {
  try {
    return (await pool.query({ name, text, values: values as unknown[] })) as QueryResult<R>
  } catch (err) {
    const code = (err as { code?: string }).code
    const message = (err as Error).message ?? ''
    if (/Prepared statements must be unique/i.test(message)) {
      throw new Error(
        `${message} — bump the version suffix on the logical name (e.g. foo:bar:v1 → v2).`
      )
    }
    if (code === '26000' || code === '42704') {
      return (await pool.query(text, values as unknown[])) as QueryResult<R>
    }
    throw err
  }
}

// Test-only helpers — do not call from production code.
export function __setCapForTests(n: number): void {
  dynamicNameCap = n
  dynamicCapLogged = false
}

export function __resetCapForTests(): void {
  dynamicNameCap = Math.max(64, 16 * TOP20_SIZE_DEFAULT)
  seenDynamicNames.clear()
  dynamicCapLogged = false
}
```

- [ ] **Step 4: Run — expect pass.**

```bash
make rebuild-node
npx vitest run tests/main/storage/postgres-named-query.test.ts
```

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/named-query.ts \
        tests/main/storage/postgres-named-query.test.ts
git commit -m "feat(pg): add runNamed + runNamedDynamic + schemaToken helpers

Sprint A PR-2 B1. Two wrappers around pg's named-statement protocol:
  - runNamed: static SQL; effective name = '\${name}@\${schemaToken(schema)}'
  - runNamedDynamic: dynamic SQL; ':t<sha1-8>' tail keyed by SQL text;
    process-level effective-name cap with unnamed fallback (Pass-9 #2)

schemaToken ALWAYS appends a 6-char sha1 tail so 'Case Lab'/'case-lab'/
'case_lab' don't collide (Pass-3 MED #4). Logical names forbid '@'.

Wrapper retries server-side 26000/42704 unnamed (Pass-6 MED-LOW #5); does
NOT swallow client-side 'Prepared statements must be unique' — surfaces it
with a version-suffix-rule hint instead.

Closes audit §3.6 (wrapper half)."
```


---

### Task PR2-3 (B3 part 1): Implement `wrapPoolForCounters(pool)`

**Files:**
- Create: `src/main/storage/postgres/query-counters.ts`
- Create: `tests/main/storage/postgres-query-counters.test.ts`

**Context:** Per B3 + Pass-6 MED #4 + Pass-7 MED #3. The proxy is the **sole counter owner** — `runNamed` does NOT count itself; the proxy increments named/unnamed based on the call shape (`{ name, text, values }` → named; `(text, values?)` → unnamed). Wraps `Pool.query` AND `PoolClient.query` from `pool.connect()`.

Counter state lives module-local with a getter + reset. Both used by the `debug:queryCounters:get` / `debug:queryCounters:reset` IPC handlers (PR2-4) and the coverage script (PR2-10).

- [ ] **Step 1: Write the failing tests.**

`tests/main/storage/postgres-query-counters.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  wrapPoolForCounters,
  getCounters,
  resetCounters
} from '../../../src/main/storage/postgres/query-counters'

describe('wrapPoolForCounters — Sprint A PR-2 B3', () => {
  beforeEach(() => resetCounters())

  it('counts named pool.query calls under their effective name', async () => {
    const inner = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn()
    } as unknown as Pool
    const wrapped = wrapPoolForCounters(inner)

    await wrapped.query({ name: 'foo:bar:v1@public_abc123', text: 'SELECT 1', values: [] })
    await wrapped.query({ name: 'foo:bar:v1@public_abc123', text: 'SELECT 1', values: [] })

    const counters = getCounters()
    expect(counters.named['foo:bar:v1@public_abc123']).toBe(2)
    expect(counters.unnamed).toBe(0)
  })

  it('counts unnamed string-form pool.query calls', async () => {
    const inner = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn()
    } as unknown as Pool
    const wrapped = wrapPoolForCounters(inner)

    await wrapped.query('SELECT 1', [])
    await wrapped.query('SELECT 2')

    const counters = getCounters()
    expect(counters.unnamed).toBe(2)
    expect(Object.keys(counters.named).length).toBe(0)
  })

  it('proxies pool.connect() and wraps client.query the same way', async () => {
    const innerClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn()
    } as unknown as PoolClient
    const inner = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(innerClient)
    } as unknown as Pool

    const wrapped = wrapPoolForCounters(inner)
    const client = await wrapped.connect()
    await client.query({ name: 'baz:qux:v1@public_abc123', text: 'SELECT 1', values: [] })
    await client.query('SELECT 2')

    const counters = getCounters()
    expect(counters.named['baz:qux:v1@public_abc123']).toBe(1)
    expect(counters.unnamed).toBe(1)
  })

  it('resetCounters clears state', () => {
    resetCounters()
    const c = getCounters()
    expect(c.unnamed).toBe(0)
    expect(Object.keys(c.named).length).toBe(0)
  })
})
```

- [ ] **Step 2: Run — expect import failures.**

```bash
npx vitest run tests/main/storage/postgres-query-counters.test.ts
```

- [ ] **Step 3: Implement.**

```typescript
import type { Pool, PoolClient, QueryConfig } from 'pg'

interface CounterState {
  named: Record<string, number>
  unnamed: number
}

const state: CounterState = { named: {}, unnamed: 0 }

export function getCounters(): { named: Record<string, number>; unnamed: number } {
  return { named: { ...state.named }, unnamed: state.unnamed }
}

export function resetCounters(): void {
  state.unnamed = 0
  for (const k of Object.keys(state.named)) delete state.named[k]
}

function increment(arg: unknown): void {
  if (
    typeof arg === 'object' &&
    arg !== null &&
    typeof (arg as QueryConfig).name === 'string'
  ) {
    const name = (arg as QueryConfig).name as string
    state.named[name] = (state.named[name] ?? 0) + 1
  } else {
    state.unnamed += 1
  }
}

/**
 * Sprint A PR-2 B3 — Pool counter proxy.
 *
 * Sole owner of named/unnamed query counters (Pass-7 MED #3). runNamed and
 * runNamedDynamic dispatch through this proxy and are counted here, not in
 * the helpers themselves — otherwise named calls would be counted twice.
 *
 * Install site: createPostgresStorageSession.ts:12, between the migration
 * runner and the PostgresStorageSession constructor (Pass-8 #4). Wrapping
 * after migrations avoids polluting counters with one-off DDL traffic.
 */
export function wrapPoolForCounters(pool: Pool): Pool {
  const proxiedPool: Pool = Object.create(pool)
  proxiedPool.query = ((arg: unknown, values?: unknown) => {
    increment(arg)
    return (pool.query as (...a: unknown[]) => Promise<unknown>)(arg, values)
  }) as Pool['query']

  proxiedPool.connect = (async (...args: unknown[]) => {
    const client = await (pool.connect as (...a: unknown[]) => Promise<PoolClient>)(...args)
    const proxiedClient: PoolClient = Object.create(client)
    proxiedClient.query = ((arg: unknown, vs?: unknown) => {
      increment(arg)
      return (client.query as (...a: unknown[]) => Promise<unknown>)(arg, vs)
    }) as PoolClient['query']
    return proxiedClient
  }) as Pool['connect']

  return proxiedPool
}
```

- [ ] **Step 4: Wire the proxy in at `createPostgresStorageSession.ts:12`.**

Read first:

```bash
sed -n '1,30p' src/main/storage/postgres/createPostgresStorageSession.ts
```

Modify:

```typescript
import { Pool } from 'pg'
import { wrapPoolForCounters } from './query-counters'
// ... existing imports

export async function createPostgresStorageSession(
  config: PostgresConfig
): Promise<PostgresStorageSession> {
  const pool = new Pool(buildPostgresPoolConfig(config))
  const migrationResult = await runPostgresMigrations(pool, config.schema)
  const wrappedPool = wrapPoolForCounters(pool)
  return new PostgresStorageSession({
    config,
    pool: wrappedPool,
    migrationResult
  })
}
```

The exact existing call signature may differ — match the existing constructor args while inserting the wrap step between migration completion and session construction.

- [ ] **Step 5: Run.**

```bash
make rebuild-node
npx vitest run tests/main/storage/postgres-query-counters.test.ts \
              tests/main/storage/postgres-startup-migrations.test.ts
```

- [ ] **Step 6: Commit.**

```bash
git add src/main/storage/postgres/query-counters.ts \
        src/main/storage/postgres/createPostgresStorageSession.ts \
        tests/main/storage/postgres-query-counters.test.ts
git commit -m "feat(pg): wrapPoolForCounters — sole owner of named/unnamed counters

Sprint A PR-2 B3. Proxies Pool.query AND PoolClient.query so both runNamed
calls (named branch) and direct pool.query callers (unnamed branch) are
counted, with no double-counting (Pass-7 MED #3).

Install site is createPostgresStorageSession.ts AFTER the migration runner
and BEFORE the session constructor — avoids polluting counters with one-off
DDL traffic (Pass-8 #4).

Counters back the debug:queryCounters:* IPC channels (next task) and the
coverage measurement script (B-coverage)."
```

---

### Task PR2-4 (B3 part 2, Gate 10c): New `debug` IPC domain — full checklist

**Files:**
- Create: `src/shared/ipc/domains/debug.ts` — typed contract.
- Create: `src/main/ipc/domains/debug.ts` — handler registration.
- Create: `src/preload/domains/debug.ts` — preload binding.
- Modify: `src/preload/window-api/create-window-api.ts` — assemble `debug` into the WindowAPI.
- Modify: `src/shared/types/api.ts` — add `debug` top-level key to `WindowAPI` interface.
- Modify: tests/**/mocks/window-api.* — extend the mock with a `debug` shape.
- Modify: `tests/shared/types/preload-contract.test.ts` — add Gate 10c assertions.

**Context:** Per B3 + Pass-4 LOW #7 + Pass-5 LOW #2 + Gate 10c. New top-level `debug` domain (NOT bolted onto `system:*`). Two channels: `debug:queryCounters:get` and `debug:queryCounters:reset`. **Handlers are always registered** (preload-contract stable across env configs); the runtime check on `VARLENS_DEBUG_QUERY_COUNTERS === '1'` lives inside each handler body — when unset, returns safe-empty results.

- [ ] **Step 1: Read the existing domain-module pattern.**

```bash
cat src/shared/ipc/domains/cohort.ts | head -30
cat src/main/ipc/domains/cases.ts 2>&1 | head -30
cat src/preload/domains/cases.ts 2>&1 | head -30
```

The shape: `<Domain>Api` interface in `shared/ipc/domains/<name>.ts`, `register<Domain>Handlers(deps)` in `main/ipc/domains/<name>.ts`, `create<Domain>Api(invoke)` in `preload/domains/<name>.ts`.

- [ ] **Step 2: Create `src/shared/ipc/domains/debug.ts`.**

```typescript
import type { IpcResult } from '../../types/errors'

export interface QueryCountersResult {
  /** Per effective prepared-statement name → execution count. */
  named: Record<string, number>
  /** Total executions that went through the unnamed code path. */
  unnamed: number
  /**
   * True when VARLENS_DEBUG_QUERY_COUNTERS=1. False means the handler
   * intentionally returned safe-empty values; the channel is always wired
   * so the preload contract is stable.
   */
  enabled: boolean
}

export interface DebugApi {
  /** `debug:queryCounters:get` — returns the current named/unnamed counts. */
  queryCountersGet(): Promise<IpcResult<QueryCountersResult>>
  /** `debug:queryCounters:reset` — zeroes the counters. */
  queryCountersReset(): Promise<IpcResult<{ enabled: boolean }>>
}

export const DEBUG_CHANNELS = {
  queryCountersGet: 'debug:queryCounters:get',
  queryCountersReset: 'debug:queryCounters:reset'
} as const
```

- [ ] **Step 3: Create `src/main/ipc/domains/debug.ts`.**

```typescript
import { ipcMain } from 'electron'
import { DEBUG_CHANNELS } from '../../../shared/ipc/domains/debug'
import {
  getCounters,
  resetCounters
} from '../../storage/postgres/query-counters'
import { wrapHandler } from '../errorHandler'

function isEnabled(): boolean {
  return process.env.VARLENS_DEBUG_QUERY_COUNTERS === '1'
}

export function registerDebugHandlers(): void {
  ipcMain.handle(DEBUG_CHANNELS.queryCountersGet, async () =>
    wrapHandler(async () => {
      if (!isEnabled()) return { named: {}, unnamed: 0, enabled: false }
      const c = getCounters()
      return { ...c, enabled: true }
    })
  )
  ipcMain.handle(DEBUG_CHANNELS.queryCountersReset, async () =>
    wrapHandler(async () => {
      if (!isEnabled()) return { enabled: false }
      resetCounters()
      return { enabled: true }
    })
  )
}
```

Register `registerDebugHandlers()` from `src/main/ipc/index.ts` next to the other domain registrations.

- [ ] **Step 4: Create `src/preload/domains/debug.ts`.**

```typescript
import { ipcRenderer } from 'electron'
import {
  DEBUG_CHANNELS,
  type DebugApi
} from '../../shared/ipc/domains/debug'

export function createDebugApi(): DebugApi {
  return {
    queryCountersGet: () => ipcRenderer.invoke(DEBUG_CHANNELS.queryCountersGet),
    queryCountersReset: () => ipcRenderer.invoke(DEBUG_CHANNELS.queryCountersReset)
  }
}
```

- [ ] **Step 5: Wire into `create-window-api.ts` + `WindowAPI` interface.**

`src/preload/window-api/create-window-api.ts`:

```typescript
import { createDebugApi } from '../domains/debug'

export function createWindowApi(): WindowAPI {
  return {
    // ... existing domains
    debug: createDebugApi()
  }
}
```

`src/shared/types/api.ts` — add to the `WindowAPI` interface:

```typescript
import type { DebugApi } from '../ipc/domains/debug'

export interface WindowAPI {
  // ... existing domain keys
  debug: DebugApi
}
```

- [ ] **Step 6: Extend the window-api mock(s).** Locate them:

```bash
grep -rln "window-api\|WindowAPI" tests/ 2>&1 | grep -i "mock" | head
```

Add a `debug: { queryCountersGet: vi.fn(), queryCountersReset: vi.fn() }` field to every mock.

- [ ] **Step 7: Extend `tests/shared/types/preload-contract.test.ts` for Gate 10c.**

```typescript
import { DEBUG_CHANNELS } from '../../../src/shared/ipc/domains/debug'

describe('debug domain — Sprint A PR-2 Gate 10c', () => {
  it('exposes queryCountersGet + queryCountersReset', () => {
    expect(DEBUG_CHANNELS.queryCountersGet).toBe('debug:queryCounters:get')
    expect(DEBUG_CHANNELS.queryCountersReset).toBe('debug:queryCounters:reset')
  })

  it('WindowAPI carries a debug top-level key', () => {
    // Compile-time check via type assertion; runtime no-op.
    const api: import('../../../src/shared/types/api').WindowAPI = {
      // ... fill out other required keys via the existing fixture
    } as never
    expect(typeof api.debug.queryCountersGet).toBe('function')
  })

  it('is no-op (enabled:false) when VARLENS_DEBUG_QUERY_COUNTERS unset', async () => {
    delete process.env.VARLENS_DEBUG_QUERY_COUNTERS
    // Integration test — call the registered handler via ipcMain test harness
    // (mirror the pattern used by other domain handler tests in tests/main/ipc/).
    // Assertion: result is { named: {}, unnamed: 0, enabled: false }
  })
})
```

- [ ] **Step 8: Run.**

```bash
make typecheck
make rebuild-node
npx vitest run tests/shared/types/preload-contract.test.ts tests/main/ipc/
```

- [ ] **Step 9: Commit.**

```bash
git add src/shared/ipc/domains/debug.ts \
        src/main/ipc/domains/debug.ts \
        src/preload/domains/debug.ts \
        src/preload/window-api/create-window-api.ts \
        src/shared/types/api.ts \
        tests/shared/types/preload-contract.test.ts \
        tests/
git commit -m "feat(ipc): add debug domain for query-counter observability

Sprint A PR-2 B3 + Gate 10c. Full domain-module checklist applied (Pass-4
LOW #7): typed contract, main handler, preload binding, window-api
assembly, WindowAPI interface extension, mock extension, preload-contract
test assertions.

Channels: debug:queryCounters:get / debug:queryCounters:reset.

Always registered (Pass-5 LOW #2). Runtime check on
VARLENS_DEBUG_QUERY_COUNTERS=1 lives inside each handler body — unset
returns { named: {}, unnamed: 0, enabled: false } so the contract is
stable in production."
```

---

### Task PR2-5 (B2 part 1): Rollout to truly-static-SQL targets via `runNamed`

**Files:**
- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts` (`getVariantTypeCounts:330-343`, `getGeneSymbols`).
- Modify: `src/main/storage/postgres/PostgresOverviewRepository.ts` (`:42-60` total_cases, total_variants, unique_variants, genes_with_variants).
- Modify: `src/main/storage/postgres/PostgresAnnotationsRepository.ts` (`upsertGlobalAnnotation`, `upsertPerCaseAnnotation`, `deleteGlobalAnnotation`, `deletePerCaseAnnotation`).
- Modify: `src/main/storage/postgres/PostgresCaseListRepository.ts` (list-cases when no filter applied).
- Modify: `src/main/storage/postgres/PostgresCasesQueryRepository.ts` (`getCaseById`, count).
- Modify: `src/main/storage/postgres/PostgresFilterPresetsRepository.ts` (`list`, `save`).

**Context:** Per B2 Pass-9 #1 reclassification — these are the SQL sites whose text is *invariant per logical name* (only parameter values vary). Each gets a unique logical `name` (e.g. `variants:type_counts:v1`, `overview:total_cases:v1`, `annotations:upsert_global:v1`, …).

**Convention:** logical names follow `<domain>:<purpose>:vN`. Bump `vN` on any SQL text edit (B4 grep enforces).

- [ ] **Step 1: Migrate one repository at a time** to keep commits atomic. Start with `PostgresOverviewRepository` (smallest surface). Pattern:

```typescript
// Before
const result = await this.pool.query(
  `SELECT COUNT(*)::int AS n FROM "${this.schema}"."cases"`
)

// After
import { runNamed } from './named-query'

const result = await runNamed<{ n: number }>(this.pool, {
  name: 'overview:total_cases:v1',
  text: `SELECT COUNT(*)::int AS n FROM "${this.schema}"."cases"`,
  values: [],
  schema: this.schema
})
```

Apply to every named target in PostgresOverviewRepository. Run the repo test:

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-final-parity.test.ts \
              tests/main/storage/postgres-cohort-repository.test.ts
make pg-down
```

Commit one repository per commit:

```bash
git add src/main/storage/postgres/PostgresOverviewRepository.ts
git commit -m "perf(pg): runNamed rollout — PostgresOverviewRepository (B2 part 1a)

Sprint A PR-2 B2 (Pass-9 #1 truly-static SQL targets). Four overview
counters (total_cases, total_variants, unique_variants, genes_with_variants)
named under overview:<purpose>:v1."
```

- [ ] **Step 2: Migrate `PostgresVariantReadRepository.getVariantTypeCounts` (`:330-343`) + `getGeneSymbols`.**

Commit:

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts
git commit -m "perf(pg): runNamed rollout — type_counts + gene_symbols (B2 part 1b)"
```

- [ ] **Step 3: Migrate `PostgresAnnotationsRepository` four upsert/delete methods.**

Commit:

```bash
git add src/main/storage/postgres/PostgresAnnotationsRepository.ts
git commit -m "perf(pg): runNamed rollout — annotations upsert/delete (B2 part 1c)"
```

- [ ] **Step 4: Migrate `PostgresCaseListRepository` + `PostgresCasesQueryRepository` + `PostgresFilterPresetsRepository`.**

Commit each separately:

```bash
git add src/main/storage/postgres/PostgresCaseListRepository.ts
git commit -m "perf(pg): runNamed rollout — case list (no-filter shape, B2 part 1d)"

git add src/main/storage/postgres/PostgresCasesQueryRepository.ts
git commit -m "perf(pg): runNamed rollout — getCaseById + count (B2 part 1e)"

git add src/main/storage/postgres/PostgresFilterPresetsRepository.ts
git commit -m "perf(pg): runNamed rollout — filter presets list/save (B2 part 1f)"
```

- [ ] **Step 5: Full PG suite check.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/
make pg-down
```

Expected: all PG tests pass.

---

### Task PR2-6 (B2 part 2): Rollout to dynamic-SQL targets via `runNamedDynamic`

**Files:**
- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts` — `queryVariants` COUNT + data halves, `searchVariants` (`:377`), `getVariantTypesPresent` (`:352-359`), `getColumnMeta` (`:464`).

**Context:** Per B2 Pass-9 #1. SQL text varies per call (different WHERE clause shapes, different column projections). `runNamedDynamic` text-hashes the name so each distinct text gets its own prepared-statement slot per connection.

- [ ] **Step 1: Migrate `queryVariants` COUNT half.**

```typescript
import { runNamedDynamic } from './named-query'

// Inside queryVariants, where buildQueryParts produces the COUNT SQL text:
const countResult = await runNamedDynamic<{ total: number }>(this.pool, {
  baseName: 'variants:query_count',
  text: countSql,
  values: countValues,
  schema: this.schema
})
```

- [ ] **Step 2: Migrate `queryVariants` data half** similarly with `baseName: 'variants:query_page'`.

- [ ] **Step 3: Migrate `searchVariants` with `baseName: 'variants:search'`.**

- [ ] **Step 4: Migrate `getVariantTypesPresent` with `baseName: 'variants:types_present'`** — its single-case vs multi-case branches both flow through the same baseName; the SQL-text hash disambiguates.

- [ ] **Step 5: Migrate `getColumnMeta` with `baseName: 'variants:column_meta'`** — each `columnKey` produces a distinct text, distinct hashed name. (Note: C4 in PR-3 narrows the read path for the per-case scope to read from `cohort_column_meta`; this PR-2 task still names the live path so PG repositories that survive to Sprint B benefit too.)

- [ ] **Step 6: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-variant-read-repository.test.ts \
              tests/main/storage/postgres-final-parity.test.ts
make pg-down
```

- [ ] **Step 7: Commit.**

```bash
git add src/main/storage/postgres/PostgresVariantReadRepository.ts
git commit -m "perf(pg): runNamedDynamic rollout — queryVariants, search, types, column_meta (B2 part 2)

Sprint A PR-2 B2 (Pass-9 #1). Dynamic-SQL targets in PostgresVariantReadRepository:
  - queryVariants COUNT + data halves (baseName variants:query_count, variants:query_page)
  - searchVariants (variants:search)
  - getVariantTypesPresent (variants:types_present)
  - getColumnMeta (variants:column_meta)

runNamedDynamic appends :t<sha1-8> per text so distinct WHERE/projection
shapes each get their own prepared-statement slot per connection."
```

---

### Task PR2-7 (B2 part 3): Rewrite batch-IN-list SQL to UNNEST array bindings

**Files:**
- Modify: `src/main/storage/postgres/PostgresAnnotationsRepository.ts:getBatch` — apply the fixed-text UNNEST pattern landed in PR1-5; promote it from `pool.query` to `runNamed` with a single fixed `annotations:get_batch_global:v1` / `annotations:get_batch_per_case:v1` name.

**Context:** Per Pass-9 #1. PR1-5 already converted the SQL to UNNEST-array form; now the text is invariant per logical name and qualifies for `runNamed`.

- [ ] **Step 1: Read the PR1-5 implementation.** Confirm SQL text is constant (only param arrays vary).
- [ ] **Step 2: Replace `pool.query(...)` with `runNamed({ name: 'annotations:get_batch_global:v1', text, values, schema })`** for the global SELECT and `runNamed({ name: 'annotations:get_batch_per_case:v1', text, values, schema })` for the per-case SELECT.
- [ ] **Step 3: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-annotations-batch.test.ts \
              tests/main/storage/postgres-annotations-repository.test.ts
make pg-down
```

- [ ] **Step 4: Commit.**

```bash
git add src/main/storage/postgres/PostgresAnnotationsRepository.ts
git commit -m "perf(pg): name getBatch's two UNNEST SELECTs (B2 part 3)

Sprint A PR-2 B2 (Pass-9 #1). PR1-5 made the SQL text invariant via UNNEST
array bindings; this task promotes the calls from pool.query to runNamed
under annotations:get_batch_global:v1 / annotations:get_batch_per_case:v1."
```

---

### Task PR2-8 (B-coverage): Create `scripts/perf/measure-named-statement-coverage.mjs`

**Files:**
- Create: `scripts/perf/measure-named-statement-coverage.mjs`

**Context:** Per B3 final paragraph + Gate 6. Launches the app via Playwright `_electron` with `VARLENS_DEBUG_QUERY_COUNTERS=1`, calls `reset`, runs a scripted exercise (open parity-harness fixture project, navigate cases ×10, page-flip ×20, open cohort view ×3), reads counters, computes coverage = `sum(top-20 named) / (sum(named) + unnamed)`. Exit-code gate enforces ≥ 80%.

- [ ] **Step 1: Define the top-20 named logical names** (from PR2-5 + PR2-6 + PR2-7):

```javascript
const TOP_20_LOGICAL_NAMES = [
  'overview:total_cases:v1',
  'overview:total_variants:v1',
  'overview:unique_variants:v1',
  'overview:genes_with_variants:v1',
  'variants:type_counts:v1',
  'variants:gene_symbols:v1',
  'annotations:upsert_global:v1',
  'annotations:upsert_per_case:v1',
  'annotations:delete_global:v1',
  'annotations:delete_per_case:v1',
  'annotations:get_batch_global:v1',
  'annotations:get_batch_per_case:v1',
  'cases:list_no_filter:v1',
  'cases:get_by_id:v1',
  'cases:count:v1',
  'filter_presets:list:v1',
  'filter_presets:save:v1',
  'variants:query_count',   // dynamic baseName — matches multiple text hashes
  'variants:query_page',
  'variants:search'
]
```

Adapt to the actual logical names committed across PR2-5/6/7. Effective names include the `@${schemaToken}` suffix; the script matches by logical-portion prefix.

- [ ] **Step 2: Implement the script.**

```javascript
#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TOP_20_LOGICAL_NAMES = [/* per Step 1 */]
const ARTIFACT_DIR = '.planning/artifacts/perf/postgres-named-coverage'
const COVERAGE_FLOOR = 0.80

async function main() {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, VARLENS_DEBUG_QUERY_COUNTERS: '1' }
  })
  const window = await app.firstWindow()

  await window.evaluate(() => window.api.debug.queryCountersReset())

  // Scripted exercise — adapt to the parity-harness fixture project.
  // The exact selectors come from existing renderer-perf-phase1 helpers.
  // navigate cases ×10:
  for (let i = 0; i < 10; i++) {
    await window.click('[data-test="case-list-item"]:nth-child(' + ((i % 8) + 1) + ')')
    await window.waitForLoadState('networkidle')
  }
  // page-flip ×20:
  for (let i = 0; i < 20; i++) {
    await window.click('[data-test="page-next"]')
    await window.waitForTimeout(100)
  }
  // open cohort view ×3:
  for (let i = 0; i < 3; i++) {
    await window.click('[data-test="cohort-view-link"]')
    await window.waitForLoadState('networkidle')
    await window.goBack()
  }

  const result = await window.evaluate(() => window.api.debug.queryCountersGet())
  await app.close()

  const named = result.named ?? {}
  const unnamed = result.unnamed ?? 0

  const inTop20 = (effectiveName) =>
    TOP_20_LOGICAL_NAMES.some(
      (logical) => effectiveName === logical || effectiveName.startsWith(`${logical}@`) || effectiveName.startsWith(`${logical}:t`)
    )
  let top20Sum = 0
  let totalNamed = 0
  for (const [eff, n] of Object.entries(named)) {
    totalNamed += n
    if (inTop20(eff)) top20Sum += n
  }
  const coverage = top20Sum / (totalNamed + unnamed)

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const artifact = {
    capturedAt: new Date().toISOString(),
    coverage,
    coverageFloor: COVERAGE_FLOOR,
    pass: coverage >= COVERAGE_FLOOR,
    top20Sum,
    totalNamed,
    unnamed,
    counters: named
  }
  const path = join(ARTIFACT_DIR, `coverage-${ts}.json`)
  writeFileSync(path, JSON.stringify(artifact, null, 2))

  console.log(JSON.stringify(artifact, null, 2))
  console.log(`Artifact: ${path}`)

  if (coverage < COVERAGE_FLOOR) {
    console.error(`::error::named-statement coverage ${(coverage * 100).toFixed(1)}% < floor ${(COVERAGE_FLOOR * 100).toFixed(0)}%`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
```

- [ ] **Step 3: Smoke-test locally.**

```bash
make pg-reset && make pg-up
make build
node scripts/perf/measure-named-statement-coverage.mjs
make pg-down
```

Expected: artifact written under `.planning/artifacts/perf/postgres-named-coverage/`; coverage ≥ 80%; exit 0.

If coverage < 80%, the script exits 1 and the top counters surface in stdout — investigate which unnamed sites are still firing and add them to PR2-5/6/7.

- [ ] **Step 4: Commit.**

```bash
git add scripts/perf/measure-named-statement-coverage.mjs
git commit -m "ci(perf): add named-statement coverage gate script (Gate 6)

Sprint A PR-2 Gate 6. Playwright _electron harness with
VARLENS_DEBUG_QUERY_COUNTERS=1 runs a scripted exercise (cases ×10, page-flip
×20, cohort ×3), reads debug:queryCounters:get, computes
sum(top-20 named) / (named + unnamed), exits non-zero below 80%.

Artifact under .planning/artifacts/perf/postgres-named-coverage/. No
pg_stat_statements dependency; counters come from the proxy in
query-counters.ts (Pass-7 MED #3)."
```

---

### Task PR2-9 (Gate 7): Wrapper fallback safety test

**Files:**
- Modify: `tests/main/storage/postgres-named-query.test.ts` — already has the 26000 retry test (PR2-2). Extend with an explicit Gate 7 assertion if not yet present, AND with an integration-shape test that exercises the retry against a real PG (optional, gated on availability).

**Context:** Per Gate 7. The unit test in PR2-2 already covers 26000; this task is a checkpoint to confirm it's still green at PR creation time and to add 42704 coverage if missing.

- [ ] **Step 1: Confirm coverage exists.**

```bash
grep -n "26000\|42704\|prepared statement does not exist\|undefined object" tests/main/storage/postgres-named-query.test.ts
```

If 42704 is not yet covered, add a copy of the 26000 test with the alternate code.

- [ ] **Step 2: Run.**

```bash
make rebuild-node
npx vitest run tests/main/storage/postgres-named-query.test.ts
```

- [ ] **Step 3: Commit only if changes were made.**

```bash
git add tests/main/storage/postgres-named-query.test.ts
git commit -m "test(pg): extend named-query fallback to cover PG 42704 (Gate 7)"
```

---

### Task PR2-10 (B4 part 2): Wire agent-check enforcement

**Files:**
- Modify: `scripts/check-agent-health.mjs` — add a default-run grep that diffs current violations against the baseline.

**Context:** Per B4. The baseline was generated by PR2-1; this task adds the enforcement step so subsequent commits in PR-2 (and beyond) cannot ADD new violations.

- [ ] **Step 1: Add the default-run check function.**

```javascript
async function checkPostgresBaseline() {
  const { readFileSync, existsSync } = await import('node:fs')
  const baselinePath = 'scripts/agent-health-postgres-baseline.json'
  if (!existsSync(baselinePath)) {
    console.warn(`(skip) ${baselinePath} not found — run --bootstrap-postgres-baseline to seed`)
    return
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))

  // Re-run the same grep as bootstrapPostgresBaseline to get the current set.
  const current = await collectPostgresViolations()  // refactor the bootstrap impl into this helper

  if (current.length > baseline.count) {
    console.error(`::error::pool.query(<literal>) violations increased from ${baseline.count} to ${current.length}`)
    const baselineSet = new Set(baseline.violations.map((v) => `${v.file}:${v.line}`))
    const newOnes = current.filter((v) => !baselineSet.has(`${v.file}:${v.line}`))
    for (const v of newOnes) {
      console.error(`  + ${v.file}:${v.line}  ${v.snippet}`)
    }
    process.exit(1)
  }
  console.log(`postgres baseline: ${current.length}/${baseline.count} violations remain`)
}
```

Hook `checkPostgresBaseline()` into the main run path so `make agent-check` picks it up.

- [ ] **Step 2: Run `make agent-check`.**

```bash
make agent-check
```

Expected: pass; count should be lower than baseline because B2 has retired sites.

- [ ] **Step 3: Commit.**

```bash
git add scripts/check-agent-health.mjs
git commit -m "ci(agent-check): enforce monotonic decrease of postgres baseline (B4)

Sprint A PR-2 B4. make agent-check now diffs current pool.query(<literal>)
sites against scripts/agent-health-postgres-baseline.json and fails if any
new violation appears (Pass-8 fit-to-100% — baseline generated at PR
creation, not hardcoded)."
```

---

### Task PR2-11 (B4 part 3): Add the `name` version-suffix grep guard

**Files:**
- Modify: `scripts/check-agent-health.mjs` — add a grep that requires `runNamed` / `runNamedDynamic` call objects to carry a `name` matching `:v\d+` OR a `baseName` (the dynamic helper version-keys via text hash, not name).

**Context:** Per B1 risk row + Pass-2 verdict #2. The version-suffix rule is the only protection against node-postgres's client-side "Prepared statements must be unique" error.

- [ ] **Step 1: Add the grep.**

```javascript
async function checkRunNamedVersionSuffix() {
  // Find every `runNamed(... { name: 'foo:bar:v1' ... })` or `name: \`...\`` form.
  // Reject any name lacking a :vN suffix (logical portion only).
  // runNamedDynamic uses baseName, which doesn't require a suffix.
  // Pattern: name:\s*['"`]([^'"`@]+)['"`]
  // and check that the captured logical name ends with :v\d+
  // ... implement and fail on violations.
}
```

- [ ] **Step 2: Run.**

```bash
make agent-check
```

Expected: pass — every `runNamed` call from PR2-5/6/7 already carries `:v1`. If anything fails, fix the offending name in-place (the agent-check is the trip-wire we want).

- [ ] **Step 3: Commit.**

```bash
git add scripts/check-agent-health.mjs
git commit -m "ci(agent-check): require :vN suffix on runNamed logical names (B4)

Sprint A PR-2 B4 (Pass-2 verdict #2). The version suffix is the only
protection against node-postgres's client-side 'Prepared statements must be
unique' error from pg/lib/query.js:156 — the wrapper's 26000/42704 retry
cannot save same-name-different-text on a single connection.
runNamedDynamic uses baseName + text hash and is exempt."
```


---

### PR-2 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 2.** `VARLENS_WEB=1 make ci` exits 0.
- [ ] **Gate 6.** `scripts/perf/measure-named-statement-coverage.mjs` exits 0 with coverage ≥ 80%.

```bash
make pg-reset && make pg-up
make build
node scripts/perf/measure-named-statement-coverage.mjs
make pg-down
```

Capture the latest artifact filename + coverage % for the PR body.

- [ ] **Gate 7.** `tests/main/storage/postgres-named-query.test.ts` green; 26000 retry + 42704 retry + client-side-error non-retry assertions all present.
- [ ] **Gate 10c.** `tests/shared/types/preload-contract.test.ts` green with `debug:queryCounters:*` assertions.
- [ ] **`make agent-check` green** (B4 baseline diff + version-suffix grep).

- [ ] **Open the PR.**

```bash
gh pr create --title "perf(postgres): named/prepared statement rollout for top-20 read sites" \
  --body "$(cat <<'EOF'
## Summary

Sprint A PR-2 — Postgres named/prepared statement coverage. Four sub-items:

- **B1** `runNamed` (static SQL) + `runNamedDynamic` (dynamic SQL, text-hashed name suffix) helpers. Effective name `${name}@${schemaToken(schema)}` with schemaToken always hash6-tail-suffixed (Pass-3 MED #4). Wrapper retries server-side 26000/42704 unnamed; surfaces client-side "Prepared statements must be unique" with version-suffix hint (Pass-6 MED-LOW #5).
- **B2** Top-20 rollout split by SQL-text stability (Pass-9 #1). Truly-static targets → `runNamed`. Dynamic targets (queryVariants, search, types, column_meta) → `runNamedDynamic`. Batch-IN-list paths rewritten to fixed-text UNNEST array bindings so the SQL text is invariant per batch size.
- **B3** `wrapPoolForCounters` sole-owner proxy (Pass-7 MED #3) installed at `createPostgresStorageSession.ts:12` after migrations (Pass-8 #4). New typed `debug` IPC domain (full checklist per Pass-4 LOW #7).
- **B4** `--bootstrap-postgres-baseline` flag generates baseline at PR creation; `make agent-check` enforces monotonic decrease (Pass-8 fit-to-100%). Version-suffix grep guard added.

Spec: `.planning/specs/2026-05-28-sprint-a-foundations.md`

## Verification

- [x] Gate 1 — `make ci-full` green
- [x] Gate 2 — `VARLENS_WEB=1 make ci` green
- [x] Gate 6 — coverage ≥ 80%: `<paste coverage % + artifact filename>`
- [x] Gate 7 — `tests/main/storage/postgres-named-query.test.ts` green (26000 + 42704 + client-side-error coverage)
- [x] Gate 10c — preload-contract test for `debug:queryCounters:*` channels green
- [x] `make agent-check` green; baseline diff: `<paste before/after counts>`
EOF
)"
```

After PR-2 merges, decide tag cadence: `0.66.x` patch alongside PR-1 or roll into `0.67.0` with PR-3.

---

# PR-3 — `feat(postgres): materialised cohort + column-meta summary with incremental add/remove`

**Branch:** `feat/pg-cohort-summary`
**Tasks:** C1, C2, C2a, C5a (write-hooks, before C3 uses them), C3, C4, C5, C6, C7, C8
**Audit refs:** §3.3, Sch-03 F6
**Lands after PR-1 + PR-2. Tag target:** `0.67.0`.

**Note on task ordering:** the spec lists sub-items C1, C2, C2a, C3, C4, C5, C5a, C6, C7, C8. **C5a (annotation-flag write-hooks) is built BEFORE C3 in this plan** because C3 step 2 invokes the case-delete write-hook variant. C4 + C5 follow after C3 (they consume the staleness state that C3 maintains).

---

### Task PR3-0: Branch + cohort perf baseline freeze

PR-1 + PR-2 must be on `main`. From `main`:

```bash
git checkout main && git pull --ff-only
git checkout -b feat/pg-cohort-summary
```

The PR-3 perf gate (Gate 8) is `p95 < 500 ms` for cohort page-load warm on the 100-case fixture. The fixture is built by C6 (PR3-13) so the baseline cannot be captured here — Gate 8 is satisfied by the warm-perf test itself, not a before/after comparison. No pre-flight perf capture required.

---

### Task PR3-1 (C1): Migration `0010_cohort_summary.sql` + `MIGRATION_FILES` registration

**Files:**
- Create: `src/main/storage/postgres/migrations/sql/0010_cohort_summary.sql`
- Modify: `src/main/storage/postgres/migrations/definitions.ts` — append the entry to `MIGRATION_FILES`.
- Create: `tests/main/storage/postgres-cohort-summary-migration.test.ts` — asserts the table + index set + conditional seed behaviour.

**Context:** Per C1. **Re-verify the next available migration number** at execution time:

```bash
ls src/main/storage/postgres/migrations/sql/ | sort | tail -3
```

If PR-1 has landed, head is `0009_idx_variants_coords.sql` and this migration is `0010`. If PR-2 added any migration (it should not), the number shifts.

Migration contents per spec C1 + Pass-9 #5 (conditional seed) + Pass-7 MED #4 (stale_reason/stale_at) + Codex finding 1 (PK includes variant_type + genome_build) + Pass-3 LOW #7 (index set mirrors SQLite v25 exactly) + Pass-8 #5 (end_pos column).

- [ ] **Step 1: Write the migration SQL.**

`src/main/storage/postgres/migrations/sql/0010_cohort_summary.sql`:

```sql
-- Sprint A PR-3 C1 — materialised cohort summary + per-case column metas +
-- singleton staleness state. Mirrors SQLite v25 schema (src/main/database/
-- migrations.ts around v25) and the index set at :1545.

-- cohort_variant_summary: deduped (chr, pos, ref, alt, variant_type,
-- genome_build) aggregate of the variants table. Used by C4 read-side switch.
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_variant_summary" (
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  end_pos INTEGER NULL,                    -- Pass-8 #5: required for C4 panel-interval predicate
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  variant_type TEXT NOT NULL DEFAULT 'snv',
  genome_build TEXT NOT NULL DEFAULT 'GRCh38',
  gene_symbol TEXT,
  cdna TEXT,
  aa_change TEXT,
  consequence TEXT,
  func TEXT,
  clinvar TEXT,
  gnomad_af DOUBLE PRECISION,
  cadd DOUBLE PRECISION,
  transcript TEXT,
  omim_mim_number TEXT,
  carrier_count INTEGER NOT NULL DEFAULT 0,
  het_count INTEGER NOT NULL DEFAULT 0,
  hom_count INTEGER NOT NULL DEFAULT 0,
  variant_key TEXT,
  has_star BOOLEAN NOT NULL DEFAULT false,
  has_comment BOOLEAN NOT NULL DEFAULT false,
  acmg_best TEXT NULL,
  cohort_frequency DOUBLE PRECISION,
  PRIMARY KEY (chr, pos, ref, alt, variant_type, genome_build)
);

-- Index set mirrors SQLite v25 exactly (Pass-3 LOW #7). No plain (gene_symbol)
-- or (consequence) singletons — SQLite retired those in v25 in favour of the
-- covering pairs below.
CREATE INDEX IF NOT EXISTS idx_cvs_carrier
  ON "__schema__"."cohort_variant_summary" (carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_filters
  ON "__schema__"."cohort_variant_summary" (gnomad_af, cadd);
CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq
  ON "__schema__"."cohort_variant_summary" (cohort_frequency);
CREATE INDEX IF NOT EXISTS idx_cvs_covering_common
  ON "__schema__"."cohort_variant_summary" (consequence, gnomad_af, carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_gene_covering
  ON "__schema__"."cohort_variant_summary" (gene_symbol, carrier_count);
CREATE INDEX IF NOT EXISTS idx_cvs_type_build
  ON "__schema__"."cohort_variant_summary" (variant_type, genome_build);

-- cohort_column_meta: per-case filter metadata cache. Powers CaseView's
-- FilterToolbar via getFilterOptions(caseId) → getColumnMeta (C4).
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_column_meta" (
  case_id INTEGER NOT NULL REFERENCES "__schema__"."cases"(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  min_value JSONB,
  max_value JSONB,
  distinct_count INTEGER NOT NULL DEFAULT 0,
  distinct_values JSONB NULL,
  PRIMARY KEY (case_id, column_name)
);

-- cohort_summary_state: singleton row with staleness flags + timestamps
-- (Pass-7 MED #4 columns: stale_reason, stale_at).
CREATE TABLE IF NOT EXISTS "__schema__"."cohort_summary_state" (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_stale BOOLEAN NOT NULL DEFAULT false,
  stale_reason TEXT NULL,
  stale_at TIMESTAMPTZ NULL,
  last_rebuilt_at TIMESTAMPTZ NULL,
  last_incremental_at TIMESTAMPTZ NULL
);

-- Conditional seed (Pass-9 #5): fresh schemas → is_stale=false (no variants
-- → no work). Existing-data schemas → is_stale=true with explicit reason so
-- the next cohort read triggers rebuild.
INSERT INTO "__schema__"."cohort_summary_state" (id, is_stale, stale_reason, stale_at)
SELECT 1,
       EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1),
       CASE WHEN EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1)
            THEN 'migration_initial_existing_data'
            ELSE NULL END,
       CASE WHEN EXISTS (SELECT 1 FROM "__schema__"."variants" LIMIT 1)
            THEN now()
            ELSE NULL END
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Register in `definitions.ts`.**

Append to `MIGRATION_FILES`:

```typescript
  {
    version: '0010',
    name: 'cohort_summary',
    fileName: '0010_cohort_summary.sql'
  }
```

**This step is load-bearing per Pass-8 #7** — `MIGRATION_FILES` is manual, not auto-discovered.

- [ ] **Step 3: Write the migration test** (asserts conditional seed semantics).

`tests/main/storage/postgres-cohort-summary-migration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// Use the existing tests/main/storage/postgres-migration-runner.test.ts
// pattern for fixture setup (createTestPool, runMigrations, etc.).

describe('cohort_summary migration — Sprint A C1', () => {
  it('creates cohort_variant_summary with the v25-mirroring index set', async () => {
    // Apply migrations on a fresh schema. Assert all six indexes exist:
    // idx_cvs_carrier, idx_cvs_filters, idx_cvs_cohort_freq,
    // idx_cvs_covering_common, idx_cvs_gene_covering, idx_cvs_type_build.
  })

  it('seeds cohort_summary_state with is_stale=false on a fresh schema (no variants)', async () => {
    // Apply on empty schema. Assert SELECT is_stale, stale_reason FROM
    // cohort_summary_state WHERE id=1 returns (false, NULL).
  })

  it('seeds cohort_summary_state with is_stale=true on an existing-data schema (Pass-9 #5)', async () => {
    // Apply 0001-0009 first, INSERT one row into variants, THEN apply 0010.
    // Assert is_stale=true AND stale_reason='migration_initial_existing_data'.
  })

  it('PK includes variant_type AND genome_build (Codex finding 1)', async () => {
    // Query pg_constraint or information_schema to confirm the PK columns.
  })
})
```

- [ ] **Step 4: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-cohort-summary-migration.test.ts \
              tests/main/storage/postgres-migration-runner.test.ts \
              tests/main/storage/postgres-migrations-registration.test.ts
make pg-down
```

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/migrations/sql/0010_cohort_summary.sql \
        src/main/storage/postgres/migrations/definitions.ts \
        tests/main/storage/postgres-cohort-summary-migration.test.ts
git commit -m "feat(pg): add cohort_variant_summary + cohort_column_meta + cohort_summary_state (C1)

Sprint A PR-3 C1. Three tables, six indexes mirroring SQLite v25 exactly
(Pass-3 LOW #7). PK on cohort_variant_summary includes (variant_type,
genome_build) so SNV/SV/CNV/STR + GRCh37/38 don't fold together (Codex
finding 1). end_pos column added for C4 panel-interval predicate (Pass-8 #5).

cohort_summary_state seeded conditionally on EXISTS(variants) so fresh
schemas seed is_stale=false and existing-data schemas seed is_stale=true
with reason 'migration_initial_existing_data' (Pass-9 #5).

Migration registered in MIGRATION_FILES (Pass-8 #7 — manual, not
auto-discovered)."
```

---

### Task PR3-2 (C2): `PostgresCohortSummaryRepository` skeleton + `rebuild`

**Files:**
- Create: `src/main/storage/postgres/PostgresCohortSummaryRepository.ts` — exports class with `rebuild`, `incrementalAdd`, `incrementalRemove`, `refreshColumnMetas`, `removeColumnMetas`, `getState`, `markStale`. This task implements `rebuild` only; subsequent tasks fill the rest.
- Create: `tests/main/storage/postgres-cohort-summary-repository.test.ts` — `rebuild` assertions including "rebuild with pre-existing annotations" (Pass-9 #8).

**Context:** Per C2 + Codex Pass-2 #4 (deduped CTE) + Pass-9 #8 (rebuild populates flags). Method signature: `{ schema; client: PoolClient }` per method.

The deduped CTE shape (from `src/shared/sql/cohort-summary-rebuild.ts` — the SQLite version is canonical for the deduplication logic; the PG version mirrors it):

```sql
WITH deduped AS (
  SELECT v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build,
         MAX(v.end_pos) AS end_pos,
         MAX(v.gene_symbol) AS gene_symbol,
         MAX(v.cdna) AS cdna, MAX(v.aa_change) AS aa_change,
         MAX(v.consequence) AS consequence, MAX(v.func) AS func,
         MAX(v.clinvar) AS clinvar, MAX(v.gnomad_af) AS gnomad_af,
         MAX(v.cadd) AS cadd, MAX(v.transcript) AS transcript,
         MAX(v.omim_mim_number) AS omim_mim_number,
         MAX(v.variant_key) AS variant_key,
         MAX(v.gt_num) AS gt_num
  FROM variants v
  JOIN cases c ON c.id = v.case_id
  GROUP BY v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build
)
```

Per Pass-9 #8, rebuild MUST populate `has_star` / `has_comment` / `acmg_best` from existing `variant_annotations` (global) + `case_variant_annotations` (per-case, joined through `variants`).

- [ ] **Step 1: Write the failing rebuild tests** (TDD — call-shape + annotation flags).

```typescript
describe('PostgresCohortSummaryRepository.rebuild — Sprint A C2', () => {
  it('TRUNCATEs and reinserts from the deduped CTE', async () => {
    // Seed cases + variants. Pre-populate cohort_variant_summary with stale data.
    // Call rebuild(). Assert cohort_variant_summary matches a hand-computed
    // aggregation by (chr, pos, ref, alt, variant_type, genome_build).
  })

  it('mirrors SQLite deduplication — duplicate per-case rows count once (Pass-2 #4)', async () => {
    // Seed: same case_id has two rows with identical (chr, pos, ref, alt).
    // After rebuild, carrier_count for that coordinate is 1, not 2.
  })

  it('populates has_star/has_comment/acmg_best from existing annotations (Pass-9 #8)', async () => {
    // Seed 5 starred variants in variant_annotations + 3 commented in
    // case_variant_annotations + 2 acmg-classified. Rebuild. Assert the
    // matching cohort_variant_summary rows have the expected flags WITHOUT
    // any post-rebuild write-hook invocation.
  })

  it('survives an empty variants table (no rows inserted)', async () => {
    // Empty cases + variants. rebuild() completes cleanly; cohort_variant_summary is empty.
  })
})
```

- [ ] **Step 2: Run — expect import failures (class doesn't exist yet).**

- [ ] **Step 3: Implement the class shell + `rebuild`.**

```typescript
import type { PoolClient } from 'pg'

interface ScopedClient {
  schema: string
  client: PoolClient
}

export class PostgresCohortSummaryRepository {
  async rebuild({ schema, client }: ScopedClient): Promise<void> {
    const tbl = (t: string) => `"${schema}"."${t}"`

    await client.query(`TRUNCATE ${tbl('cohort_variant_summary')}`)

    // Deduped CTE + flag-bearing projection. Mirrors SQLite
    // src/main/database/CohortSummaryService.ts and the deduped pattern in
    // src/shared/sql/cohort-summary-rebuild.ts.
    await client.query(`
      INSERT INTO ${tbl('cohort_variant_summary')}
        (chr, pos, end_pos, ref, alt, variant_type, genome_build,
         gene_symbol, cdna, aa_change, consequence, func, clinvar,
         gnomad_af, cadd, transcript, omim_mim_number,
         carrier_count, het_count, hom_count, variant_key,
         has_star, has_comment, acmg_best, cohort_frequency)
      WITH deduped AS (
        SELECT v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build,
               MAX(v.end_pos) AS end_pos,
               MAX(v.gene_symbol) AS gene_symbol,
               MAX(v.cdna) AS cdna,
               MAX(v.aa_change) AS aa_change,
               MAX(v.consequence) AS consequence,
               MAX(v.func) AS func,
               MAX(v.clinvar) AS clinvar,
               MAX(v.gnomad_af) AS gnomad_af,
               MAX(v.cadd) AS cadd,
               MAX(v.transcript) AS transcript,
               MAX(v.omim_mim_number) AS omim_mim_number,
               MAX(v.variant_key) AS variant_key,
               MAX(v.gt_num) AS gt_num
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        GROUP BY v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build
      ),
      agg AS (
        SELECT d.chr, d.pos, MAX(d.end_pos) AS end_pos, d.ref, d.alt,
               d.variant_type, d.genome_build,
               MAX(d.gene_symbol) AS gene_symbol,
               MAX(d.cdna) AS cdna,
               MAX(d.aa_change) AS aa_change,
               MAX(d.consequence) AS consequence,
               MAX(d.func) AS func,
               MAX(d.clinvar) AS clinvar,
               MAX(d.gnomad_af) AS gnomad_af,
               MAX(d.cadd) AS cadd,
               MAX(d.transcript) AS transcript,
               MAX(d.omim_mim_number) AS omim_mim_number,
               COUNT(*) AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
               SUM(CASE WHEN d.gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count,
               MAX(d.variant_key) AS variant_key
        FROM deduped d
        GROUP BY d.chr, d.pos, d.ref, d.alt, d.variant_type, d.genome_build
      )
      SELECT
        a.chr, a.pos, a.end_pos, a.ref, a.alt, a.variant_type, a.genome_build,
        a.gene_symbol, a.cdna, a.aa_change, a.consequence, a.func, a.clinvar,
        a.gnomad_af, a.cadd, a.transcript, a.omim_mim_number,
        a.carrier_count, a.het_count, a.hom_count, a.variant_key,
        -- Pass-9 #8: derive flag columns from current annotation tables.
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.starred = 1
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.starred = 1
        )) AS has_star,
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.comment IS NOT NULL AND va.comment <> ''
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.comment IS NOT NULL AND cva.comment <> ''
        )) AS has_comment,
        (SELECT cva.acmg_class
         FROM ${tbl('case_variant_annotations')} cva
         JOIN ${tbl('variants')} v ON cva.variant_id = v.id
         WHERE v.chr = a.chr AND v.pos = a.pos
           AND v.ref = a.ref AND v.alt = a.alt
           AND v.variant_type = a.variant_type
           AND cva.acmg_class IS NOT NULL
         ORDER BY cva.acmg_class DESC
         LIMIT 1) AS acmg_best,
        NULL AS cohort_frequency  -- populated by C2a recompute, called next
      FROM agg a;
    `)

    // C2a recompute is invoked by the caller immediately after rebuild() —
    // the cohort_frequency NULL above is intentional. See the rebuild()
    // call site in C3 (PostgresCaseLifecycleRepository and
    // postgres-import-worker.ts).
  }

  // Stub for next tasks
  async incrementalAdd(_args: ScopedClient & { caseId: number }): Promise<void> { throw new Error('TODO PR3-3') }
  async incrementalRemove(_args: ScopedClient & { caseId: number }): Promise<void> { throw new Error('TODO PR3-3') }
  async refreshColumnMetas(_args: ScopedClient & { caseId: number }): Promise<void> { throw new Error('TODO PR3-4') }
  async removeColumnMetas(_args: ScopedClient & { caseId: number }): Promise<void> { throw new Error('TODO PR3-4') }
  async getState(_args: ScopedClient): Promise<{ is_stale: boolean; last_rebuilt_at: number }> { throw new Error('TODO PR3-9') }
  async markStale(_args: ScopedClient & { reason: string }): Promise<void> { throw new Error('TODO PR3-9') }
}
```

- [ ] **Step 4: Run — expect pass for the rebuild tests (other methods still TODO).**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-cohort-summary-repository.test.ts
make pg-down
```

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/PostgresCohortSummaryRepository.ts \
        tests/main/storage/postgres-cohort-summary-repository.test.ts
git commit -m "feat(pg): PostgresCohortSummaryRepository.rebuild (C2)

Sprint A PR-3 C2. TRUNCATE+INSERT from deduped CTE; mirrors SQLite
src/shared/sql/cohort-summary-rebuild.ts dedup semantics (Pass-2 #4 —
duplicate per-case rows count once).

has_star/has_comment/acmg_best derived from variant_annotations + the
case_variant_annotations JOIN at insertion time (Pass-9 #8 — without
this, every rebuild would reset flags to false).

cohort_frequency left NULL; populated by C2a recompute called by the
caller immediately after rebuild() (next task).

Other methods stubbed for the next tasks."
```

---

### Task PR3-3 (C2): `incrementalAdd` + `incrementalRemove`

**Files:**
- Modify: `src/main/storage/postgres/PostgresCohortSummaryRepository.ts` — implement the two incremental methods.
- Modify: `tests/main/storage/postgres-cohort-summary-repository.test.ts` — add tests.

**Context:** Per C2 patterns + Pass-6 MED #3 (all three counters subtract simultaneously). Each method nests the same deduped CTE, scoped to a single case_id.

`incrementalAdd(caseId)` — `INSERT … SELECT … FROM (<deduped CTE WHERE case_id=$1>) GROUP BY … ON CONFLICT (…) DO UPDATE SET carrier_count = cohort_variant_summary.carrier_count + EXCLUDED.carrier_count, het_count = + EXCLUDED.het_count, hom_count = + EXCLUDED.hom_count`. Flag columns: `has_star = cohort_variant_summary.has_star OR EXCLUDED.has_star` (annotations don't get cleared by an add). For a brand-new row (INSERT path), flags come from the same EXISTS expressions as rebuild.

`incrementalRemove(caseId)` — UPDATE-from-CTE matching SQLite's `INCREMENTAL_REMOVE_SQL` at `src/shared/sql/cohort-summary-rebuild.ts:164-180`. Three counters subtract simultaneously:

```sql
WITH per_case AS (
  SELECT chr, pos, ref, alt, variant_type, genome_build,
         COUNT(*) AS carrier_delta,
         SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_delta,
         SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_delta
  FROM (<deduped CTE WHERE case_id=$1>) d
  GROUP BY chr, pos, ref, alt, variant_type, genome_build
)
UPDATE cohort_variant_summary cvs
SET carrier_count = cvs.carrier_count - per_case.carrier_delta,
    het_count = cvs.het_count - per_case.het_delta,
    hom_count = cvs.hom_count - per_case.hom_delta
FROM per_case
WHERE cvs.chr = per_case.chr AND cvs.pos = per_case.pos
  AND cvs.ref = per_case.ref AND cvs.alt = per_case.alt
  AND cvs.variant_type = per_case.variant_type
  AND cvs.genome_build = per_case.genome_build;
```

Then (separate statement, sibling-CTE ordering rule per Pass-2 verdict #1):
```sql
DELETE FROM cohort_variant_summary WHERE carrier_count = 0;
```

- [ ] **Step 1: Add tests** for both methods (add count delta, remove count delta, het/hom deltas, flag preservation).

- [ ] **Step 2: Implement both methods** as described above. The same deduped CTE shape from C2 is reused — extract it into a helper if it would otherwise be triplicated.

- [ ] **Step 3: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-cohort-summary-repository.test.ts
make pg-down

git add src/main/storage/postgres/PostgresCohortSummaryRepository.ts \
        tests/main/storage/postgres-cohort-summary-repository.test.ts
git commit -m "feat(pg): incrementalAdd + incrementalRemove (C2)

Sprint A PR-3 C2. incrementalAdd: INSERT … ON CONFLICT DO UPDATE summing
carrier_count + het_count + hom_count. incrementalRemove: UPDATE-from-CTE
subtracting all three counters simultaneously (Pass-6 MED #3), followed by a
sibling DELETE WHERE carrier_count = 0 (Pass-2 verdict #1)."
```

---

### Task PR3-4 (C2): `refreshColumnMetas` + `removeColumnMetas`

**Files:**
- Modify: `src/main/storage/postgres/PostgresCohortSummaryRepository.ts` — implement the two column-meta methods.

**Context:** Per C1 schema + C5a HIGH #2 ("rebuild repopulates all case column metas, delete step 7 explicitly invokes `removeColumnMetas`").

`refreshColumnMetas(caseId)` — DELETE existing rows for the case, then INSERT one row per (case_id, column_name) tuple computing `min_value`, `max_value`, `distinct_count`, optionally `distinct_values` for low-cardinality columns. The exact column set comes from the existing `FilterOptions` shape in the renderer's filter toolbar — read `src/main/database/VariantRepository.getAllColumnMetas` (SQLite reference) for the column list.

```sql
DELETE FROM cohort_column_meta WHERE case_id = $1;
INSERT INTO cohort_column_meta (case_id, column_name, min_value, max_value, distinct_count, distinct_values)
VALUES (...) -- per column
```

`removeColumnMetas(caseId)` — `DELETE FROM cohort_column_meta WHERE case_id = $1`. The `ON DELETE CASCADE` from C1 makes this redundant if the case row is also deleted in the same transaction, but C3 calls it explicitly to support the "remove without deleting case" path.

- [ ] **Step 1: Read the SQLite reference.**

```bash
grep -n "getAllColumnMetas\|getColumnMeta\|distinct_values" src/main/database/VariantRepository.ts | head -20
```

Mirror its column list verbatim.

- [ ] **Step 2: Implement + test.**

```typescript
describe('refreshColumnMetas + removeColumnMetas — C2', () => {
  it('refreshColumnMetas writes one row per (case_id, column_name) tuple', async () => { /* ... */ })
  it('removeColumnMetas deletes only the target case rows', async () => { /* ... */ })
})
```

- [ ] **Step 3: Commit.**

```bash
git add src/main/storage/postgres/PostgresCohortSummaryRepository.ts \
        tests/main/storage/postgres-cohort-summary-repository.test.ts
git commit -m "feat(pg): refreshColumnMetas + removeColumnMetas (C2)

Sprint A PR-3 C2. Per-case filter metadata cache used by the C4 read-side
switch — getFilterOptions(caseId) reads cohort_column_meta directly,
mirroring SQLite's live-aggregating getAllColumnMetas output shape."
```

---

### Task PR3-5 (C2a): cohort_frequency recompute helper

**Files:**
- Modify: `src/main/storage/postgres/PostgresCohortSummaryRepository.ts` — add `recomputeCohortFrequency({ schema; client; affectedBuilds? })` and call it from `rebuild` / `incrementalAdd` / `incrementalRemove`.

**Context:** Per C2a + Pass-3 HIGH #2. SQLite explicitly recomputes `cohort_frequency` after `incrementalAdd` and `incrementalRemove` (`CohortSummaryService.ts:74` and `:98` run `RECOMPUTE_ALL_FREQUENCIES_SQL` in the same transaction). PG mirrors this: recompute on write, scoped to affected genome_builds.

```sql
UPDATE cohort_variant_summary
SET cohort_frequency = cohort_variant_summary.carrier_count::float / NULLIF(c.total, 0)
FROM (
  SELECT genome_build, COUNT(*) AS total
  FROM cases
  GROUP BY genome_build
) c
WHERE cohort_variant_summary.genome_build = c.genome_build
  AND cohort_variant_summary.genome_build = ANY($1::text[])
```

`affectedBuilds` is optional — when omitted, the full table is recomputed (rebuild path). Pass `[caseGenomeBuild]` for incremental.

- [ ] **Step 1: Add the helper** + integrate calls into `rebuild`, `incrementalAdd`, `incrementalRemove`.

```typescript
async recomputeCohortFrequency({
  schema,
  client,
  affectedBuilds
}: ScopedClient & { affectedBuilds?: string[] }): Promise<void> {
  const tbl = (t: string) => `"${schema}"."${t}"`
  if (affectedBuilds && affectedBuilds.length > 0) {
    await client.query(
      `UPDATE ${tbl('cohort_variant_summary')} cvs
       SET cohort_frequency = cvs.carrier_count::float / NULLIF(c.total, 0)
       FROM (SELECT genome_build, COUNT(*) AS total FROM ${tbl('cases')} GROUP BY genome_build) c
       WHERE cvs.genome_build = c.genome_build
         AND cvs.genome_build = ANY($1::text[])`,
      [affectedBuilds]
    )
  } else {
    await client.query(
      `UPDATE ${tbl('cohort_variant_summary')} cvs
       SET cohort_frequency = cvs.carrier_count::float / NULLIF(c.total, 0)
       FROM (SELECT genome_build, COUNT(*) AS total FROM ${tbl('cases')} GROUP BY genome_build) c
       WHERE cvs.genome_build = c.genome_build`
    )
  }
}
```

Have `rebuild` call `recomputeCohortFrequency({ schema, client })` (all builds) as its final step. Have `incrementalAdd` / `incrementalRemove` accept a `genomeBuild` arg from the caller and call `recomputeCohortFrequency({ schema, client, affectedBuilds: [genomeBuild] })`.

- [ ] **Step 2: Test.**

```typescript
it('recomputeCohortFrequency narrowed to one genome_build does not touch others', async () => { /* ... */ })
it('rebuild() leaves cohort_frequency populated (not NULL)', async () => { /* ... */ })
it('incrementalAdd() updates cohort_frequency for the case\'s build only', async () => { /* ... */ })
```

- [ ] **Step 3: Commit.**

```bash
git add src/main/storage/postgres/PostgresCohortSummaryRepository.ts \
        tests/main/storage/postgres-cohort-summary-repository.test.ts
git commit -m "feat(pg): C2a — cohort_frequency recompute on write (per-build scoped)

Sprint A PR-3 C2a (Pass-3 HIGH #2). Mirrors SQLite's
RECOMPUTE_ALL_FREQUENCIES_SQL — recompute after rebuild/incrementalAdd/
incrementalRemove inside the same transaction. Incremental paths narrow to
the affected genome_build(s); rebuild recomputes all.

'Compute on read' rejected: breaks SQLite parity (gate 9d) and kills
idx_cvs_cohort_freq."
```

---

### Task PR3-6 (C5a part 1): Refactor `PostgresAnnotationsRepository` to client-passed helpers

**Files:**
- Modify: `src/main/storage/postgres/PostgresAnnotationsRepository.ts` — split each public method into `_<verb>On(client, …)` raw-SQL helper + transaction-opening public wrapper.

**Context:** Per C5a atomicity note + Pass-5 MED #3 + Pass-6 MED #2. The existing `*WithAudit` methods at `:204` open a transaction and call the plain upsert methods; if the plain methods ALSO opened a transaction, the audit transaction would break (PG forbids nested `BEGIN`). Pre-emptively split before adding the flag write-hooks in PR3-7.

Pattern:

```typescript
export class PostgresAnnotationsRepository {
  // Private raw-SQL helpers — operate on the passed client, no BEGIN/COMMIT.
  private async _upsertGlobalAnnotationOn(client: PoolClient, payload: …): Promise<void> { /* raw SQL */ }
  private async _deleteGlobalAnnotationOn(client: PoolClient, key: …): Promise<void> { /* raw SQL */ }
  private async _upsertPerCaseAnnotationOn(client: PoolClient, payload: …): Promise<void> { /* raw SQL */ }
  private async _deletePerCaseAnnotationOn(client: PoolClient, key: …): Promise<void> { /* raw SQL */ }

  // Public methods — open their own transaction and call the matching helper.
  async upsertGlobalAnnotation(payload: …): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this._upsertGlobalAnnotationOn(client, payload)
      // PR3-7 will append _applyAnnotationFlagsGlobal here
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  // ...

  // *WithAudit methods keep their existing transaction shape; their internals
  // call the _*On helpers using the active client passed by the audit transaction.
}
```

- [ ] **Step 1: Refactor the four public methods + their `*WithAudit` siblings** to the split shape. Existing public method bodies move into the `_*On` helpers verbatim (no SQL change).
- [ ] **Step 2: Run the existing repo test.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-annotations-repository.test.ts
make pg-down
```

Expected: pass — no behaviour change, only internal refactor.

- [ ] **Step 3: Commit.**

```bash
git add src/main/storage/postgres/PostgresAnnotationsRepository.ts
git commit -m "refactor(pg): split annotations repo into client-passed helpers (C5a prep)

Sprint A PR-3 C5a (Pass-6 MED #2 prep). Private _<verb>On(client, …) helpers
run raw SQL on the passed client; public methods open the transaction.
Prevents nested BEGIN when *WithAudit appends the flag write-hook (next
task)."
```

---

### Task PR3-7 (C5a part 2): Add `_applyAnnotationFlags*` write-hook helpers

**Files:**
- Modify: `src/main/storage/postgres/PostgresAnnotationsRepository.ts` — add three private write-hook helpers + wire them into the upsert/delete + WithAudit methods.

**Context:** Per C5a + Pass-4 MED #4 (global vs per-case split) + Pass-5 HIGH #1 (on-delete variant) + Pass-7 LOW #6 (defensive variantId join).

**Three write-hook variants:**
1. `_applyAnnotationFlagsGlobal(client, { schema, chr, pos, ref, alt })` — global mutation, updates EVERY summary row matching `(chr, pos, ref, alt)`. Logical name `cohort_summary:annotation_flags_global:v1`.
2. `_applyAnnotationFlagsPerCase(client, { schema, caseId, variantId })` — per-case mutation; target CTE joins on BOTH `v.id = $variantId AND v.case_id = $caseId`; rowCount 0 → throw `InvalidParametersError` (Pass-7 LOW #6). Logical name `cohort_summary:annotation_flags_per_case:v1`.
3. `_applyAnnotationFlagsOnCaseDelete(client, { schema, deletedCaseId })` — used by C3 step 2; `EXISTS (FROM case_variant_annotations cva … WHERE … AND v.case_id <> $deletedCaseId)`. Logical name `cohort_summary:annotation_flags_on_case_delete:v1`.

- [ ] **Step 1: Implement** the three helpers per the SQL in spec C5a. Use `runNamed` since each is a fixed-text statement.

- [ ] **Step 2: Wire into the public methods.**

```typescript
async upsertGlobalAnnotation(payload: …): Promise<void> {
  const client = await this.pool.connect()
  try {
    await client.query('BEGIN')
    await this._upsertGlobalAnnotationOn(client, payload)
    await this._applyAnnotationFlagsGlobal(client, {
      schema: this.schema,
      chr: payload.chr, pos: payload.pos, ref: payload.ref, alt: payload.alt
    })
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK'); throw err
  } finally { client.release() }
}
```

Apply the symmetric pattern to `deleteGlobalAnnotation`, `upsertPerCaseAnnotation`, `deletePerCaseAnnotation`, and their `*WithAudit` siblings (which call the `_*On` helpers + `_applyAnnotationFlags*` inside their existing transaction, just before COMMIT).

- [ ] **Step 3: Tests for all three variants** + the defensive variantId-mismatch case.

```typescript
describe('annotation-flag write-hooks — Sprint A C5a', () => {
  it('global upsert flips has_star on every matching cohort_variant_summary row', async () => { /* ... */ })
  it('per-case upsert with mismatched (caseId, variantId) throws InvalidParametersError (Pass-7 LOW #6)', async () => { /* ... */ })
  it('on-delete variant excludes the deleted case from EXISTS subquery (Pass-5 HIGH #1)', async () => { /* ... */ })
  it('failure inside the write-hook rolls back the annotation mutation (Pass-5 MED #3)', async () => {
    // Mock the second statement to throw; assert variant_annotations row is
    // not present after the dust settles.
  })
})
```

- [ ] **Step 4: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-annotations-repository.test.ts
make pg-down

git add src/main/storage/postgres/PostgresAnnotationsRepository.ts \
        tests/main/storage/postgres-annotations-repository.test.ts
git commit -m "feat(pg): annotation-flag write-hooks (C5a)

Sprint A PR-3 C5a. Three helpers maintain has_star/has_comment/acmg_best in
cohort_variant_summary:
  - _applyAnnotationFlagsGlobal (chr,pos,ref,alt predicate)
  - _applyAnnotationFlagsPerCase (joins variants+cases with defensive
    cva.case_id AND v.case_id check, throws InvalidParametersError on
    mismatched pair — Pass-7 LOW #6)
  - _applyAnnotationFlagsOnCaseDelete (v.case_id <> \$deletedCaseId
    predicate — Pass-5 HIGH #1; called by C3 step 2 BEFORE the case delete)

Wired atomically inside the existing annotation transactions
(Pass-5 MED #3 + Pass-6 MED #2 — flag failure rolls back the annotation
mutation)."
```


---

### Task PR3-8 (C3 part 1): Wire `incrementalAdd` + flag-rebuild + column-meta refresh into import worker

**Files:**
- Modify: `src/main/workers/postgres-import-worker.ts` around `:292` (transaction owner) — add the post-loop SAVEPOINT-wrapped summary update.

**Context:** Per C3 + Pass-2 #5 (real txn owner is the worker) + Pass-3 HIGH #1 (ONCE per case, after the batch loop) + Pass-4 HIGH #2 (SAVEPOINT around summary only) + Pass-4 HIGH #3 (NO staleness in ImportResult) + Pass-5 HIGH #2 (refreshColumnMetas inside savepoint).

Insertion point: AFTER the batch loop completes and bookkeeping rows are written (`UPDATE cases SET variant_count` at `:424`, `rebuildVariantFrequencyForCase` at `:431` / `:546`), BEFORE the outer transaction COMMIT.

Transaction mechanics:
```sql
SAVEPOINT cohort_summary;
<incrementalAdd(caseId) + recomputeCohortFrequency(genome_build) + refreshColumnMetas(caseId)>;
RELEASE SAVEPOINT cohort_summary;
```

On exception inside the savepoint: `ROLLBACK TO SAVEPOINT cohort_summary` (leaves bookkeeping intact), COMMIT the outer transaction, then in a separate tiny transaction `markStale('post_import_summary_failed_case_${caseId}')`.

- [ ] **Step 1: Read the existing worker txn structure.**

```bash
sed -n '280,440p' src/main/workers/postgres-import-worker.ts
```

Identify the COMMIT line after `rebuildVariantFrequencyForCase`. The savepoint goes between the bookkeeping and that COMMIT.

- [ ] **Step 2: Import the summary repo + add the savepoint block.**

```typescript
import { PostgresCohortSummaryRepository } from '../storage/postgres/PostgresCohortSummaryRepository'
// ... near the top

// Inside the final post-loop transaction, AFTER variant_count UPDATE and
// rebuildVariantFrequencyForCase, BEFORE the outer COMMIT:
const summary = new PostgresCohortSummaryRepository()

try {
  await client.query('SAVEPOINT cohort_summary')
  await summary.incrementalAdd({ schema, client, caseId, genomeBuild: caseGenomeBuild })
  await summary.recomputeCohortFrequency({ schema, client, affectedBuilds: [caseGenomeBuild] })
  await summary.refreshColumnMetas({ schema, client, caseId })
  await client.query('RELEASE SAVEPOINT cohort_summary')
} catch (savepointErr) {
  await client.query('ROLLBACK TO SAVEPOINT cohort_summary')
  await client.query('COMMIT')
  // Mark stale in a separate tiny transaction so the bookkeeping commit survives.
  const tinyClient = await pool.connect()
  try {
    await tinyClient.query('BEGIN')
    await summary.markStale({ schema, client: tinyClient, reason: `post_import_summary_failed_case_${caseId}` })
    await tinyClient.query('COMMIT')
  } catch (markErr) {
    await tinyClient.query('ROLLBACK')
    mainLogger.error(`Failed to mark cohort summary stale after post-import failure: ${markErr}`, 'postgres-import-worker')
  } finally {
    tinyClient.release()
  }
  mainLogger.warn(`Cohort summary update failed for case ${caseId}; marked stale: ${savepointErr}`, 'postgres-import-worker')
  // Return normally — staleness lives in cohort_summary_state, NOT on
  // ImportResult (Pass-4 HIGH #3).
  return ImportResult /* same shape as before */
}

await client.query('COMMIT')
```

`caseGenomeBuild` is captured earlier in the worker from the case header.

- [ ] **Step 3: Test the import-path wiring** with a small fixture.

```typescript
describe('postgres-import-worker — C3 import wiring', () => {
  it('updates cohort_variant_summary after a successful import', async () => { /* ... */ })
  it('preserves variant_count + rebuildVariantFrequencyForCase on summary failure', async () => {
    // Mock summary.incrementalAdd to throw. Assert:
    // - cases.variant_count was updated (bookkeeping committed)
    // - cohort_summary_state.is_stale = true
    // - ImportResult shape unchanged (no warnings field)
  })
  it('ImportResult shape carries NO warnings field (Pass-4 HIGH #3)', async () => { /* ... */ })
})
```

- [ ] **Step 4: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/workers/ tests/main/storage/postgres-import-executor.test.ts
make pg-down

git add src/main/workers/postgres-import-worker.ts tests/main/workers/
git commit -m "feat(pg): wire incrementalAdd + refresh column metas + cohort_frequency into import (C3 import half)

Sprint A PR-3 C3 (Pass-2 #5 + Pass-3 HIGH #1 + Pass-4 HIGH #2 + Pass-5 HIGH #2).
SAVEPOINT cohort_summary wraps the summary update INSIDE the existing
post-loop transaction; on failure, ROLLBACK TO SAVEPOINT leaves
variant_count + rebuildVariantFrequencyForCase intact, the outer COMMIT
proceeds, and markStale runs in a separate tiny transaction.

ImportResult / StorageImportSingleFileResult / PostgresImportWorkerCompleteMessage
shapes unchanged — staleness lives in cohort_summary_state, surfaced only
on the next cohort-page load (Pass-4 HIGH #3)."
```

---

### Task PR3-9 (C3 part 2): 8-step delete sequence in `PostgresCaseLifecycleRepository.deleteCase`

**Files:**
- Modify: `src/main/storage/postgres/PostgresCaseLifecycleRepository.ts` around `:21` (the existing `deleteCase` method, which already opens its own transaction).

**Context:** Per C3 delete sequence + Pass-6 HIGH #1 (rebuildVariantFrequency step is required because `vf.case_count` powers `internal_af`).

The 8-step ordering inside the existing single transaction:
1. `SELECT genome_build FROM cases WHERE id=$1` — capture for step 7's recompute.
2. **`_applyAnnotationFlagsOnCaseDelete`** (the C5a third variant) — runs BEFORE the case delete; `v.case_id <> $1` predicate excludes the about-to-be-cascade-deleted rows.
3. `WITH per_case AS (… deduped CTE WHERE case_id=$1) UPDATE cohort_variant_summary SET carrier_count -= per_case.carrier_delta, het_count -= per_case.het_delta, hom_count -= per_case.hom_delta FROM per_case WHERE …` — all three counters together (Pass-6 MED #3).
4. `DELETE FROM cohort_variant_summary WHERE carrier_count = 0`.
5. `DELETE FROM cases WHERE id=$1` — cascades to variants + case_variant_annotations.
6. `rebuildVariantFrequency(client)` — the existing TRUNCATE+INSERT pattern already in this repo (Pass-6 HIGH #1).
7. `summary.recomputeCohortFrequency({ schema, client, affectedBuilds: [capturedGenomeBuild] })` — denominator now excludes the deleted case.
8. `summary.removeColumnMetas({ schema, client, caseId })` — `cohort_column_meta` rows are keyed on `case_id` so this is independent of step 5's cascade.

- [ ] **Step 1: Read the existing deleteCase body.**

```bash
sed -n '15,80p' src/main/storage/postgres/PostgresCaseLifecycleRepository.ts
```

- [ ] **Step 2: Implement the 8-step sequence** in order. All inside the existing transaction.

- [ ] **Step 3: Tests** covering each invariant.

```typescript
describe('PostgresCaseLifecycleRepository.deleteCase — Sprint A C3', () => {
  it('captures genome_build BEFORE delete (step 1)', async () => { /* mock SELECT, assert called first */ })
  it('runs _applyAnnotationFlagsOnCaseDelete BEFORE the case delete (Pass-5 HIGH #1)', async () => { /* ... */ })
  it('subtracts carrier_count, het_count, hom_count simultaneously (Pass-6 MED #3)', async () => { /* ... */ })
  it('rebuilds variant_frequency after the case delete (Pass-6 HIGH #1)', async () => { /* ... */ })
  it('recomputes cohort_frequency narrowed to captured genome_build (Pass-4 HIGH #1)', async () => { /* ... */ })
  it('removeColumnMetas runs after the cascade (step 8)', async () => { /* ... */ })
  it('handles zero-variant cases (steps still run cleanly, no rows updated)', async () => { /* ... */ })
})
```

- [ ] **Step 4: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-case-lifecycle-repository.test.ts
make pg-down

git add src/main/storage/postgres/PostgresCaseLifecycleRepository.ts \
        tests/main/storage/postgres-case-lifecycle-repository.test.ts
git commit -m "feat(pg): 8-step delete sequence with cohort summary maintenance (C3 delete half)

Sprint A PR-3 C3 delete-flow:
  1. SELECT genome_build (Pass-4 HIGH #1)
  2. _applyAnnotationFlagsOnCaseDelete BEFORE case delete (Pass-5 HIGH #1)
  3. UPDATE summary subtracting carrier + het + hom together (Pass-6 MED #3)
  4. DELETE summary rows where carrier_count = 0 (sibling-CTE, Pass-2 verdict #1)
  5. DELETE case (cascades to variants + case_variant_annotations)
  6. rebuildVariantFrequency(client) (Pass-6 HIGH #1 — internal_af stays current)
  7. recomputeCohortFrequency narrowed to captured genome_build
  8. removeColumnMetas

All inside the existing transaction. Covers zero-variant cases (Pass-4 HIGH #1)."
```

---

### Task PR3-10 (C2 part 5): `getState` + `markStale`

**Files:**
- Modify: `src/main/storage/postgres/PostgresCohortSummaryRepository.ts` — implement `getState` + `markStale`.

**Context:** Per C1 lifecycle rules (Pass-7 MED #4 + Pass-8 #7). `getState` returns `{ is_stale, last_rebuilt_at }` per the existing IPC contract; PG mapping uses `EXTRACT(EPOCH FROM …) * 1000` (Pass-9 #6). `markStale(reason)` writes `is_stale=true, stale_reason=$1, stale_at=now()` leaving `last_rebuilt_at` untouched.

- [ ] **Step 1: Implement.**

```typescript
async getState({ schema, client }: ScopedClient): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
  const tbl = (t: string) => `"${schema}"."${t}"`
  const r = await client.query<{ is_stale: boolean; last_rebuilt_at: string }>(
    `SELECT is_stale,
            COALESCE(EXTRACT(EPOCH FROM last_rebuilt_at) * 1000, 0)::bigint AS last_rebuilt_at
     FROM ${tbl('cohort_summary_state')}
     WHERE id = 1`
  )
  const row = r.rows[0]
  return { is_stale: row.is_stale, last_rebuilt_at: Number(row.last_rebuilt_at) }
}

async markStale({ schema, client, reason }: ScopedClient & { reason: string }): Promise<void> {
  const tbl = (t: string) => `"${schema}"."${t}"`
  await client.query(
    `UPDATE ${tbl('cohort_summary_state')}
     SET is_stale = true, stale_reason = $1, stale_at = now()
     WHERE id = 1`,
    [reason]
  )
}
```

Also adjust `rebuild` to write `is_stale=false, stale_reason=NULL, stale_at=NULL, last_rebuilt_at=now()` at completion; `incrementalAdd` / `incrementalRemove` write `last_incremental_at=now()` but do NOT touch `is_stale`.

- [ ] **Step 2: Tests.**

```typescript
describe('cohort_summary_state lifecycle — C2 + C1', () => {
  it('rebuild() sets is_stale=false, last_rebuilt_at=now()', async () => { /* ... */ })
  it('markStale(reason) sets is_stale=true, stale_reason=<reason>, stale_at=now()', async () => { /* ... */ })
  it('incrementalAdd does NOT touch is_stale', async () => { /* ... */ })
  it('getState maps TIMESTAMPTZ → epoch ms via EXTRACT(EPOCH)*1000 (Pass-9 #6)', async () => { /* ... */ })
})
```

- [ ] **Step 3: Commit.**

```bash
git add src/main/storage/postgres/PostgresCohortSummaryRepository.ts \
        tests/main/storage/postgres-cohort-summary-repository.test.ts
git commit -m "feat(pg): cohort_summary_state lifecycle (getState + markStale + rebuild flag updates)

Sprint A PR-3 C1 + C2 lifecycle (Pass-7 MED #4 + Pass-9 #6).

getState returns the existing IPC shape { is_stale, last_rebuilt_at:number }
via EXTRACT(EPOCH FROM last_rebuilt_at) * 1000.

markStale leaves last_rebuilt_at untouched (history preserved); rebuild
clears is_stale/stale_reason/stale_at and sets last_rebuilt_at=now()."
```

---

### Task PR3-11 (C4 part 1): `buildSummaryQueryParts` predicate-mapping builder

**Files:**
- Create: `src/main/storage/postgres/postgres-cohort-summary-query.ts` — exports `buildSummaryQueryParts(params, totalCases)`.
- Create: `tests/main/storage/postgres-cohort-summary-query.test.ts`.

**Context:** Per C4 + Pass-8 #5 (explicit predicate-mapping contract). The current `buildQueryParts(params, totalCases)` at `PostgresCohortRepository.ts:568` builds against alias `v` for `variants`. The new `buildSummaryQueryParts` maps every predicate to alias `cvs` for `cohort_variant_summary`.

Predicate mapping (per spec C4 — copy verbatim into the implementation):
- **Direct column renames (`v` → `cvs`):** gene_symbol, consequence, func, clinvar, gnomad_af, cadd, transcript, omim_mim_number, chr, pos, ref, alt, variant_type, genome_build, cdna, aa_change.
- **HAVING → WHERE:** carrier_count, het_count, hom_count, cohort_frequency are stored columns; their predicates move from `havingParts` to `whereParts`, GROUP BY disappears.
- **Annotation flags:** `cvs.has_star`, `cvs.has_comment`, `cvs.acmg_best` (kept current by C5a).
- **internal_af / variant_frequency:** uses `cvs.cohort_frequency` directly. NO `variant_frequency` join needed.
- **Search:** same columns on `cvs` for the genomic-coordinate match `(cvs.chr, cvs.pos)` and the gene/consequence/OMIM ILIKE.
- **Panel intervals (Pass-9 #7 — EXACT expression):** `cvs.chr = $chr AND cvs.pos <= $end AND COALESCE(cvs.end_pos, cvs.pos) >= $start`. **MUST mirror `PostgresCohortRepository.ts:603` verbatim** so spanning SV/CNV variants overlap correctly.
- **Extension-table predicates** (`cadd_phred`, other `variant_extensions` columns): **fall through to the live `buildQueryParts` path** — return a sentinel indicating the summary path is unavailable for this query.
- **Sort:** alias `cvs`; aggregate sorts (e.g. `ORDER BY carrier_count`) become direct column sorts on `cvs`.

- [ ] **Step 1: Read the existing builder.**

```bash
sed -n '560,720p' src/main/storage/postgres/PostgresCohortRepository.ts
```

- [ ] **Step 2: Build the parallel function.**

```typescript
import type { CohortQueryParams } from '...'  // existing type

export interface SummaryQueryParts {
  joins: string
  whereParts: string[]
  orderBy: string
  values: unknown[]
}

export interface BuildSummaryResult {
  parts: SummaryQueryParts
  unavailable: boolean   // true → caller falls back to buildQueryParts
  unavailableReason?: string
}

export function buildSummaryQueryParts(
  params: CohortQueryParams,
  totalCases: number
): BuildSummaryResult {
  // Detect extension-table predicates first; return unavailable if any present.
  if (hasExtensionPredicate(params)) {
    return { parts: emptyParts(), unavailable: true, unavailableReason: 'extension_predicate' }
  }
  // ... else build whereParts mapped to `cvs`
  // Panel intervals: `cvs.chr = $i AND cvs.pos <= $j AND COALESCE(cvs.end_pos, cvs.pos) >= $k`
  // Aggregate predicates: cvs.carrier_count, cvs.het_count, cvs.hom_count, cvs.cohort_frequency
  // ... etc.
  return { parts: { joins: '', whereParts, orderBy, values }, unavailable: false }
}

function hasExtensionPredicate(params: CohortQueryParams): boolean {
  // Inspect params for any predicate keyed on a variant_extensions column.
  // Be explicit; list every known extension column from variant-extension-registry.ts.
  // ... return true iff any non-empty
}
```

- [ ] **Step 3: Test the builder** with the full matrix of predicate shapes — direct columns, aggregates, panel intervals (including spanning SV), extension fallback, sort.

- [ ] **Step 4: Commit.**

```bash
git add src/main/storage/postgres/postgres-cohort-summary-query.ts \
        tests/main/storage/postgres-cohort-summary-query.test.ts
git commit -m "feat(pg): buildSummaryQueryParts predicate-mapping builder (C4)

Sprint A PR-3 C4 (Pass-8 #5). Mirrors buildQueryParts but maps every
predicate to alias 'cvs' for cohort_variant_summary:
  - direct column renames (gene_symbol, consequence, etc.)
  - HAVING aggregates (carrier_count, cohort_frequency, …) → WHERE
  - annotation flags (cvs.has_star/has_comment/acmg_best)
  - internal_af → cvs.cohort_frequency directly (no variant_frequency join)
  - panel intervals: exact 'cvs.pos <= \$end AND COALESCE(cvs.end_pos, cvs.pos) >= \$start' (Pass-9 #7)
  - extension predicates → return { unavailable: true } so caller falls
    back to live buildQueryParts (Sprint B materialises extension aggregates)"
```

---

### Task PR3-12 (C4 part 2): Switch the two scoped read sites to summary + per-case cohort_column_meta

**Files:**
- Modify: `src/main/storage/postgres/PostgresCohortRepository.ts` — `buildGroupedSelect` (`:720-732`) uses `buildSummaryQueryParts` with live fallback; `getColumnMeta` (`:378`) reads from `cohort_variant_summary`.
- Modify: `src/main/storage/postgres/PostgresVariantReadRepository.ts` — `getFilterOptions(caseId)` (`:442`) reads from `cohort_column_meta` when scope is `{ caseId }`; `getColumnMeta(scope, columnKey)` (`:464`) for `{ caseId }` scope reads cohort_column_meta; `{ caseIds }` scope stays live-aggregating (Pass-5 MED #1 — avoids cross-case overcount).

**Context:** Per C4 IN-scope items (a) + (b). `getSummary` (`:255`) and `getGeneBurden` (`:355`) are explicitly Sprint B — DO NOT switch them.

- [ ] **Step 1: Switch `buildGroupedSelect`.**

```typescript
// Inside PostgresCohortRepository:
async buildGroupedSelect(params: CohortQueryParams, totalCases: number) {
  const summary = buildSummaryQueryParts(params, totalCases)
  if (summary.unavailable) {
    // Fall back to existing live-aggregation path.
    return this._buildLiveGroupedSelect(params, totalCases)
  }
  const { whereParts, orderBy, values } = summary.parts
  const sql = `
    SELECT cvs.* FROM ${this.tbl('cohort_variant_summary')} cvs
    WHERE ${whereParts.join(' AND ')}
    ${orderBy}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `
  return runNamedDynamic(this.pool, {
    baseName: 'cohort:summary_page',
    text: sql,
    values: [...values, params.limit, params.offset],
    schema: this.schema
  })
}
```

The pagination uses runNamedDynamic since `whereParts.length` varies the text. The cohort:carriers logical name family from B2 (deferred to PR-3 per the spec) goes here.

- [ ] **Step 2: Switch `PostgresCohortRepository.getColumnMeta`** (`:378` — the cohort-view path) to read from `cohort_variant_summary` directly, mirroring SQLite. Per Pass-3 HIGH #3: aggregating `SUM(distinct_count)` across `cohort_column_meta` rows would overcount.

```typescript
async getColumnMeta(columnKey: string) {
  // Mirror SQLite cohort.ts:468 — direct COUNT DISTINCT / MIN / MAX from
  // the already-deduped summary table.
  return runNamed(this.pool, {
    name: `cohort:column_meta_${columnKey}:v1`,
    text: `SELECT COUNT(DISTINCT ${columnKey}), MIN(${columnKey}), MAX(${columnKey})
           FROM ${this.tbl('cohort_variant_summary')}`,
    values: [],
    schema: this.schema
  })
}
```

- [ ] **Step 3: Switch `PostgresVariantReadRepository.getFilterOptions(caseId)`** (`:442`) and the single-case branch of `getColumnMeta` (`:464`).

```typescript
async getFilterOptions(caseId: number) {
  // Per-case scope: read from cohort_column_meta (populated by C2's
  // refreshColumnMetas on import + delete + rebuild).
  const result = await runNamed(this.pool, {
    name: 'variants:filter_options_per_case:v1',
    text: `SELECT column_name, min_value, max_value, distinct_count, distinct_values
           FROM ${this.tbl('cohort_column_meta')} WHERE case_id = $1`,
    values: [caseId],
    schema: this.schema
  })
  // Reshape into the existing FilterOptions output (mirror SQLite output shape).
  return reshapeFilterOptions(result.rows)
}

async getColumnMeta(scope: { caseId: number } | { caseIds: number[] }, columnKey: string) {
  if ('caseId' in scope) {
    // Per-case: read from cohort_column_meta (single-row lookup).
    return runNamed(this.pool, {
      name: `variants:column_meta_per_case_${columnKey}:v1`,
      text: `SELECT min_value, max_value, distinct_count, distinct_values
             FROM ${this.tbl('cohort_column_meta')}
             WHERE case_id = $1 AND column_name = $2`,
      values: [scope.caseId, columnKey],
      schema: this.schema
    })
  }
  // Multi-case branch stays LIVE-aggregating (Pass-5 MED #1).
  return this._liveColumnMetaMultiCase(scope.caseIds, columnKey)
}
```

- [ ] **Step 4: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-cohort-repository.test.ts \
              tests/main/storage/postgres-variant-read-repository.test.ts
make pg-down
```

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/PostgresCohortRepository.ts \
        src/main/storage/postgres/PostgresVariantReadRepository.ts
git commit -m "feat(pg): switch buildGroupedSelect + per-case getFilterOptions/getColumnMeta to summary (C4)

Sprint A PR-3 C4. Two scoped read sites moved to materialised summary:
  - PostgresCohortRepository.buildGroupedSelect uses buildSummaryQueryParts;
    falls back to live buildQueryParts on extension predicates.
  - PostgresVariantReadRepository.getFilterOptions(caseId) + getColumnMeta
    single-case branch read from cohort_column_meta.

Multi-case getColumnMeta({ caseIds }) stays live-aggregating to avoid
cross-case distinct overcount (Pass-5 MED #1).
PostgresCohortRepository.getColumnMeta (cohort-view) reads
cohort_variant_summary directly (Pass-3 HIGH #3 — SUM across
cohort_column_meta would overcount).

getSummary + getGeneBurden explicitly NOT switched — Sprint B."
```

---

### Task PR3-13 (C6): 100-case perf fixture builder

**Files:**
- Create: `scripts/perf/build-100-case-fixture.mjs`.
- Modify: `.gitignore` if needed (`tests/.cache/perf-100case/` should be gitignored).

**Context:** Per C6. Generates 100 GIAB-derived cases (downsampled from the existing 8-case perf fixture). Idempotent. Asserts row-count bounds (target ~5M variants total). Writes a manifest JSON. Used by Gate 8 (PR3-14) and seeds Sprint D's 1000-case fixture.

- [ ] **Step 1: Implement the generator.** Read existing fixture-prep scripts for pattern (e.g. `scripts/postgres/download-wgs-fixture.sh`, `scripts/prepare-test-data.sh`).

```javascript
#!/usr/bin/env node
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// ... copy 8-case fixture × 12 with case-id renaming to reach 100;
// downsample variants per case to land near 5M total.

const OUT_DIR = 'tests/.cache/perf-100case'
const TARGET_CASES = 100
const TARGET_VARIANTS = 5_000_000
const VARIANT_BOUNDS = [TARGET_VARIANTS * 0.8, TARGET_VARIANTS * 1.2]
// ... idempotent: if manifest.json exists and reports matching counts, exit 0
```

The generator should produce per-case VCF or JSON files plus a manifest of the form `{ generatedAt, totalCases, totalVariants, cases: [{ id, filePath, variantCount }] }`.

- [ ] **Step 2: Verify `.gitignore` covers the output directory.**

```bash
grep -n "perf-100case\|tests/.cache" .gitignore
```

If not, add `tests/.cache/perf-100case/` to `.gitignore`.

- [ ] **Step 3: Smoke-test the build.**

```bash
scripts/perf/build-100-case-fixture.mjs
ls -lh tests/.cache/perf-100case/ | head
cat tests/.cache/perf-100case/manifest.json | head
```

Expected: 100 cases, ~5M variants total within bounds.

- [ ] **Step 4: Commit.**

```bash
git add scripts/perf/build-100-case-fixture.mjs .gitignore
git commit -m "test(perf): 100-case fixture builder (C6)

Sprint A PR-3 C6. Downsamples the 8-case GIAB perf fixture to 100 cases
totalling ~5M variants. Idempotent — re-run is a no-op if the manifest
matches the row-count bounds.

Output under tests/.cache/perf-100case/ (gitignored). Seeds Sprint D's
1000-case fixture by the same generator."
```

---

### Task PR3-14 (C6 + Gate 8): Warm-perf test against the 100-case fixture

**Files:**
- Create: `tests/perf/postgres-cohort-warm.perf.test.ts`

**Context:** Per C6 + Gate 8. Opens the 100-case fixture into a fresh PG schema, runs cohort page-load 5× warm (after 1 cold), asserts p95 < 500 ms. Artifact under `.planning/artifacts/perf/postgres-cohort/`.

- [ ] **Step 1: Implement.** Mirror the existing perf test pattern at `tests/perf/postgres-vcf-wgs-import.perf.test.ts`.

```typescript
import { describe, it, expect } from 'vitest'

// Gated behind a manifest check — skip if fixture missing.
const FIXTURE_DIR = 'tests/.cache/perf-100case'
const ARTIFACT_DIR = '.planning/artifacts/perf/postgres-cohort'

describe.skipIf(!existsSync(join(FIXTURE_DIR, 'manifest.json')))(
  'postgres cohort warm-perf — Sprint A C6 / Gate 8',
  () => {
    it('cohort page-load p95 < 500ms warm on 100-case fixture', async () => {
      // 1. Boot a fresh PG schema (createTestPool / migrations).
      // 2. Bulk-import all 100 cases (via worker or direct INSERT — fast path).
      // 3. Run rebuild() once (cold).
      // 4. Run cohort page-load 5× warm; record timings.
      // 5. Compute p95; write artifact to ARTIFACT_DIR; assert < 500.
    })
  }
)
```

- [ ] **Step 2: Run** the test (gated on fixture availability — skip in CI if not present).

```bash
scripts/perf/build-100-case-fixture.mjs  # if not already
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/perf/postgres-cohort-warm.perf.test.ts
make pg-down
```

Expected: pass with p95 well under 500ms.

- [ ] **Step 3: Commit.**

```bash
git add tests/perf/postgres-cohort-warm.perf.test.ts
git commit -m "test(perf): postgres cohort warm-perf gate (C6 + Gate 8)

Sprint A PR-3 Gate 8. p95 < 500ms warm on the 100-case fixture. Artifact
under .planning/artifacts/perf/postgres-cohort/. Gated on fixture
availability so CI is unaffected without the fixture."
```

---

### Task PR3-15 (C7 + Gate 9): Backend-parity test

**Files:**
- Create: `tests/main/storage/cohort-backend-parity.test.ts`

**Context:** Per C7 + Gate 9 (sub-tests a-e).

- [ ] **Step 1: Implement.**

```typescript
import { describe, it, expect } from 'vitest'

describe('cohort backend-parity — Sprint A C7 / Gate 9', () => {
  // Loads the SAME fixture into SQLite + PG; runs the same query on both;
  // asserts set-equality (sort-order normalised). The five sub-tests:

  it('(a) buildGroupedSelect rows match between SQLite and PG', async () => { /* ... */ })

  it('(b) per-case getFilterOptions(caseId) OUTPUT equality', async () => {
    // Pass-5 MED #2: SQLite computes live; PG reads from cohort_column_meta.
    // Equality is on the FilterOptions output shape, not storage-row shape.
  })

  it('(c) cohort-view getColumnMeta distinct counts from cohort_variant_summary match', async () => { /* ... */ })

  it('(d) cohort_frequency values match after every add/remove path', async () => { /* ... */ })

  it('(e) has_star/has_comment/acmg_best flags match after star+comment+ACMG mutations AND after case delete (no intervening rebuild)', async () => { /* ... */ })

  it('panel-interval with spanning SV/CNV: spanning row is included on both backends (Pass-9 #7)', async () => {
    // Insert a CNV with pos=1000, end_pos=5000.
    // Run cohort query with panel interval start=2000, end=3000.
    // Both backends must return the CNV row.
  })
})
```

- [ ] **Step 2: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/cohort-backend-parity.test.ts
make pg-down
```

- [ ] **Step 3: Commit.**

```bash
git add tests/main/storage/cohort-backend-parity.test.ts
git commit -m "test(storage): cohort backend-parity gate (C7 + Gate 9)

Sprint A PR-3 Gate 9 — five sub-checks (a-e) plus panel-interval spanning-SV
case (Pass-9 #7). Trip-wire for feedback_cohort_parity.md at the storage
layer."
```

---

### Task PR3-16 (C8 + Gate 10): Drift-detection sanity test

**Files:**
- Create: `tests/main/storage/cohort-summary-drift.test.ts`

**Context:** Per C8 + Gate 10. After `rebuild` + N incremental ops, a second `rebuild` must produce byte-identical results.

- [ ] **Step 1: Implement.**

```typescript
describe('cohort-summary drift detection — Sprint A C8 / Gate 10', () => {
  it('rebuild + N incremental ops + rebuild = byte-identical', async () => {
    // 1. Seed N cases + variants.
    // 2. Call rebuild(). Snapshot full cohort_variant_summary.
    // 3. For each case: incrementalRemove then incrementalAdd (no-op shuffle).
    // 4. Call rebuild() again. Snapshot.
    // 5. Assert deep-equal of the two snapshots.
  })
})
```

- [ ] **Step 2: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/cohort-summary-drift.test.ts
make pg-down

git add tests/main/storage/cohort-summary-drift.test.ts
git commit -m "test(storage): cohort-summary drift detection (C8 + Gate 10)

Sprint A PR-3 Gate 10. rebuild + N incremental ops + rebuild = byte-identical.
Catches incremental-vs-full-rebuild drift before users see it."
```

---

### Task PR3-17 (C5 + Gate 10b): Staleness IPC wiring + cohort-read warnings + Gate 10b assertions

**Files:**
- Modify: `src/main/ipc/handlers/cohort-logic.ts:363` — replace the hardcoded `{ is_stale: false, last_rebuilt_at: 0 }` PG stub with a real `cohort_summary_state` read via `PostgresCohortSummaryRepository.getState`.
- Modify: `src/shared/ipc/domains/cohort.ts` — extend the cohort-read response with `warnings?: { staleSummary?: boolean }`.
- Modify: PG cohort-read code path (`PostgresCohortRepository` or its read executor) — populate `warnings: { staleSummary: true }` when `cohort_summary_state.is_stale === true` AND the read served stale data.
- Modify: `src/main/ipc/handlers/cohort-logic.ts` or `PostgresReadExecutor` — bootstrap behavior: force synchronous rebuild when `last_rebuilt_at IS NULL` OR `(variants_present AND NOT summary_present)`, regardless of the 50-case threshold (Pass-9 #5).
- Modify: `tests/shared/types/preload-contract.test.ts` — Gate 10b assertions (warnings field optional; ImportResult/StorageImportSingleFileResult/PostgresImportWorkerCompleteMessage UNCHANGED).

**Context:** Per C5 + Pass-4 HIGH #3 + Pass-8 #6 + Pass-9 #5 + Pass-9 #6 + Gate 10b.

- [ ] **Step 1: Replace the PG `getSummaryStatus` stub.**

```bash
sed -n '360,380p' src/main/ipc/handlers/cohort-logic.ts
```

Replace the stub with a real session-scoped `getState` call. Output shape matches the existing IPC contract verbatim: `{ is_stale: boolean; last_rebuilt_at: number }`.

- [ ] **Step 2: Extend cohort-read contract with `warnings`.**

`src/shared/ipc/domains/cohort.ts`:

```typescript
export interface CohortReadResponse {
  // ... existing fields
  warnings?: { staleSummary?: boolean }
}
```

- [ ] **Step 3: Populate `warnings.staleSummary` in the PG read path** when serving stale data.

- [ ] **Step 4: Implement the bootstrap-on-existing-data sync-rebuild override** (Pass-9 #5):

```typescript
// In the cohort read path, BEFORE serving:
const { never_rebuilt, variants_present, summary_present } = await client.query(
  `SELECT
     (last_rebuilt_at IS NULL) AS never_rebuilt,
     EXISTS (SELECT 1 FROM ${tbl('variants')} LIMIT 1) AS variants_present,
     EXISTS (SELECT 1 FROM ${tbl('cohort_variant_summary')} LIMIT 1) AS summary_present
   FROM ${tbl('cohort_summary_state')} WHERE id = 1`
).then((r) => r.rows[0])

if (never_rebuilt || (variants_present && !summary_present)) {
  // Force synchronous rebuild irrespective of total_cases threshold.
  await runSynchronousRebuild(client, schema)
} else if (state.is_stale && totalCases < SYNC_REBUILD_MAX_CASES) {
  await runSynchronousRebuild(client, schema)
} else if (state.is_stale) {
  // Background rebuild on detached promise (single-flight gate).
  scheduleBackgroundRebuild()
}
```

`SYNC_REBUILD_MAX_CASES` reads from `process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES` (default 50).

- [ ] **Step 5: Gate 10b assertions in preload-contract test.**

```typescript
describe('cohort domain — Sprint A PR-3 Gate 10b', () => {
  it('cohort-read response warnings field is optional', () => {
    // Compile-time check: a response without warnings still matches the type.
  })

  it('ImportResult shape unchanged (Pass-4 HIGH #3)', () => {
    // Assert no `warnings` field on ImportResult / StorageImportSingleFileResult /
    // PostgresImportWorkerCompleteMessage — explicit no-change.
    const r: ImportResult = { /* existing fixture */ } as ImportResult
    // @ts-expect-error — warnings is intentionally NOT on ImportResult
    void r.warnings
  })
})
```

- [ ] **Step 6: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/shared/types/preload-contract.test.ts \
              tests/main/ipc/handlers/ \
              tests/main/storage/postgres-cohort-repository.test.ts
make pg-down

git add src/main/ipc/handlers/cohort-logic.ts \
        src/shared/ipc/domains/cohort.ts \
        src/main/storage/postgres/PostgresCohortRepository.ts \
        tests/shared/types/preload-contract.test.ts
git commit -m "feat(ipc): wire cohort staleness state + cohort-read warnings (C5 + Gate 10b)

Sprint A PR-3 C5 (Pass-4 HIGH #3 + Pass-8 #6 + Pass-9 #5 + Pass-9 #6).

cohort:getSummaryStatus PG handler reads from cohort_summary_state (was
hardcoded stub). Contract shape unchanged: { is_stale, last_rebuilt_at:number }
via EXTRACT(EPOCH FROM …) * 1000.

Cohort-read response gains optional warnings: { staleSummary?: boolean }
for immediate same-load feedback.

Bootstrap-on-existing-data override (Pass-9 #5): force synchronous rebuild
when last_rebuilt_at IS NULL OR (variants_present AND NOT summary_present),
regardless of the 50-case threshold.

ImportResult / StorageImportSingleFileResult / PostgresImportWorkerCompleteMessage
shapes UNCHANGED — explicit assertion in preload-contract test (Gate 10b)."
```

---

### PR-3 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 2.** `VARLENS_WEB=1 make ci` exits 0.
- [ ] **Gate 8.** `tests/perf/postgres-cohort-warm.perf.test.ts` green with p95 < 500 ms.
- [ ] **Gate 9.** `tests/main/storage/cohort-backend-parity.test.ts` green (all five sub-checks + panel-interval spanning SV case).
- [ ] **Gate 10.** `tests/main/storage/cohort-summary-drift.test.ts` green.
- [ ] **Gate 10b.** preload-contract test for cohort-read `warnings` + ImportResult unchanged green.

- [ ] **Open the PR.**

```bash
gh pr create --title "feat(postgres): materialised cohort + column-meta summary with incremental add/remove" \
  --body "$(cat <<'EOF'
## Summary

Sprint A PR-3 — materialised cohort summary lands. C1-C8 + C2a + C5a per spec.

Spec: `.planning/specs/2026-05-28-sprint-a-foundations.md`

## Verification

- [x] Gate 1 — `make ci-full` green
- [x] Gate 2 — `VARLENS_WEB=1 make ci` green
- [x] Gate 8 — postgres cohort warm-perf p95 = `<paste>` ms (< 500 floor)
- [x] Gate 9 — backend-parity (a/b/c/d/e + spanning SV panel-interval) green
- [x] Gate 10 — drift detection green
- [x] Gate 10b — preload-contract warnings + ImportResult unchanged
EOF
)"
```

After PR-3 merges, tag `0.67.0` per the runbook.

---

# PR-4 — `feat(jobs): JobRunner skeleton + multi-project design doc`

**Branch:** `feat/job-runner`
**Tasks:** D1, D2, D3 (5 sites), D4, D5
**Audit refs:** §3.10, Sch-03 F10
**Lands last. Tag target:** `0.68.0` (sprint exit).

---

### Task PR4-0: Branch from post-PR-3 main

```bash
git checkout main && git pull --ff-only
git checkout -b feat/job-runner
```

PR-4 is a tracking-wrapper refactor with no expected perf change. No baseline capture needed; Gate 12 (d) verifies progress payloads are byte-identical to pre-PR-4.

---

### Task PR4-1 (D1): Job primitive

**Files:**
- Create: `src/main/services/jobs/types.ts`

**Context:** Per D1.

- [ ] **Step 1: Implement.**

```typescript
import type { SerializableError } from '../../../shared/types/errors'

export type JobKind =
  | 'import_single'
  | 'import_batch'
  | 'cohort_rebuild'
  | 'association'
  | 'export'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Job<P = unknown> {
  id: string                              // ULID, chronologically sortable
  kind: JobKind
  status: JobStatus
  params: P
  progress: { current: number; total: number; message?: string } | null
  error: SerializableError | null
  createdAt: number                       // epoch ms
  startedAt: number | null
  finishedAt: number | null
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/main/services/jobs/types.ts
git commit -m "feat(jobs): Job primitive types (D1)

Sprint A PR-4 D1. JobKind, JobStatus, Job<P> with ULID id for chronological
sort (Sprint C resume), progress null|shape, SerializableError for error,
epoch-ms timestamps."
```

---

### Task PR4-2 (D2): JobRunner skeleton — tracking wrapper

**Files:**
- Create: `src/main/services/jobs/JobRunner.ts`
- Create: `tests/main/services/jobs/job-runner.test.ts`

**Context:** Per D2 + Pass-7 HIGH #1+#2 + Pass-8 #8+#9 + Pass-9 #9 (sync enqueue).

Key invariants:
- **`enqueue<P, R>(kind, params, handler): JobHandle<R>` returns SYNCHRONOUSLY** — single-flight check + AbortController creation + handler kickoff all inline; only `JobHandle.result` is async.
- **`JobHandle<R>` exposes `id: string`, `kind: JobKind`, `result: Promise<R>`** so call sites preserve their existing return types via `(await handle).result` or `handle.result`.
- **Per-kind single-flight gate** preserving the three error messages verbatim.
- **AbortController owned by JobRunner**; `ctx.signal = controller.signal` (read-only view); `ctx.registerCancel(fn)` so existing teardown paths register.
- **No progress interception.** Existing emitters keep firing through their original paths.

- [ ] **Step 1: Write the failing tests** (cover all four Gate 12 dimensions).

```typescript
import { describe, it, expect, vi } from 'vitest'
import { JobRunner } from '../../../../src/main/services/jobs/JobRunner'

describe('JobRunner — Sprint A D2', () => {
  it('enqueue returns SYNCHRONOUSLY with id + kind + result (Pass-9 #9)', () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', {}, async () => 42)
    // No `await` — handle is already there.
    expect(typeof handle.id).toBe('string')
    expect(handle.kind).toBe('import_single')
    expect(handle.result).toBeInstanceOf(Promise)
  })

  it('handle.result resolves to the handler return value', async () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', { x: 1 }, async (_ctx, p: { x: number }) => ({ doubled: p.x * 2 }))
    const r = await handle.result
    expect(r).toEqual({ doubled: 2 })
  })

  it('per-kind single-flight gate preserves the three existing error messages (Pass-7 HIGH #2)', () => {
    const runner = new JobRunner()
    // First enqueue ok
    runner.enqueue('import_single', {}, async () => new Promise(() => {}))  // pending forever
    // Second enqueue rejects with the preserved message
    expect(() => runner.enqueue('import_single', {}, async () => 0)).toThrow(
      'An import is already in progress'
    )
  })

  it('cancel(jobId) aborts the signal AND invokes registered cancel callbacks (Pass-8 #9)', async () => {
    const runner = new JobRunner()
    const cancelFn = vi.fn()
    const handle = runner.enqueue('import_single', {}, async (ctx) => {
      ctx.registerCancel(cancelFn)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return ctx.signal.aborted ? 'cancelled' : 'completed'
    })
    runner.cancel(handle.id)
    const r = await handle.result
    expect(r).toBe('cancelled')
    expect(cancelFn).toHaveBeenCalled()
  })

  it('onLifecycle fires for queued → running → completed', async () => {
    const runner = new JobRunner()
    const events: string[] = []
    runner.onLifecycle((j) => events.push(j.status))
    const handle = runner.enqueue('export', {}, async () => 'ok')
    await handle.result
    expect(events).toEqual(['queued', 'running', 'completed'])
  })
})
```

- [ ] **Step 2: Implement.**

```typescript
import { ulid } from 'ulid'  // or a small inline alternative if ulid is not in deps
import type { Job, JobKind } from './types'

export interface JobContext {
  signal: AbortSignal
  registerCancel(fn: () => void | Promise<void>): void
}

export interface JobHandle<R> {
  id: string
  kind: JobKind
  result: Promise<R>
}

const SINGLE_FLIGHT_MESSAGES: Record<JobKind, string> = {
  import_single: 'An import is already in progress',
  import_batch: 'A batch import is already in progress',
  cohort_rebuild: 'A cohort rebuild is already running',
  association: 'An association analysis is already running',
  export: 'An export is already in progress'
}

type Listener = (job: Job) => void

export class JobRunner {
  private jobs = new Map<string, Job>()
  private inFlight = new Map<JobKind, Promise<unknown>>()
  private cancelHandlers = new Map<string, Array<() => void | Promise<void>>>()
  private controllers = new Map<string, AbortController>()
  private listeners: Listener[] = []

  enqueue<P, R>(
    kind: JobKind,
    params: P,
    handler: (ctx: JobContext, params: P) => Promise<R>
  ): JobHandle<R> {
    if (this.inFlight.has(kind)) {
      throw new Error(SINGLE_FLIGHT_MESSAGES[kind])
    }
    const id = ulid()
    const controller = new AbortController()
    const cancelFns: Array<() => void | Promise<void>> = []
    this.controllers.set(id, controller)
    this.cancelHandlers.set(id, cancelFns)
    const ctx: JobContext = {
      signal: controller.signal,
      registerCancel: (fn) => { cancelFns.push(fn) }
    }
    const job: Job<P> = {
      id, kind, status: 'queued', params, progress: null, error: null,
      createdAt: Date.now(), startedAt: null, finishedAt: null
    }
    this.jobs.set(id, job)
    this.fireLifecycle(job)

    job.status = 'running'
    job.startedAt = Date.now()
    this.fireLifecycle(job)

    const resultPromise = handler(ctx, params)
      .then((r) => {
        job.status = 'completed'
        job.finishedAt = Date.now()
        this.fireLifecycle(job)
        return r
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          job.status = 'cancelled'
        } else {
          job.status = 'failed'
          job.error = toSerializableError(err)
        }
        job.finishedAt = Date.now()
        this.fireLifecycle(job)
        throw err
      })
      .finally(() => {
        this.inFlight.delete(kind)
        this.controllers.delete(id)
        this.cancelHandlers.delete(id)
      })

    this.inFlight.set(kind, resultPromise)
    return { id, kind, result: resultPromise }
  }

  async cancel(jobId: string): Promise<void> {
    const controller = this.controllers.get(jobId)
    if (!controller) return
    controller.abort()
    const fns = this.cancelHandlers.get(jobId) ?? []
    for (const fn of fns) {
      try { await fn() } catch { /* swallow — cancellation is best-effort */ }
    }
  }

  get(jobId: string): Job | undefined { return this.jobs.get(jobId) }
  list(filter?: { kind?: JobKind; status?: Job['status'] }): Job[] {
    let result = [...this.jobs.values()]
    if (filter?.kind) result = result.filter((j) => j.kind === filter.kind)
    if (filter?.status) result = result.filter((j) => j.status === filter.status)
    return result
  }
  onLifecycle(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter((l) => l !== listener) }
  }
  private fireLifecycle(job: Job): void {
    for (const l of this.listeners) {
      try { l(job) } catch { /* swallow */ }
    }
  }
}

function toSerializableError(err: unknown): SerializableError {
  // Reuse the existing toSerializableError from src/main/ipc/errorHandler.ts
  // if available; otherwise inline a minimal shim.
}
```

If `ulid` is not in deps, either add it (small, ~2kb) or implement a minimal monotonic-incremented hex id.

- [ ] **Step 3: Run.**

```bash
make rebuild-node
npx vitest run tests/main/services/jobs/job-runner.test.ts
```

- [ ] **Step 4: Commit.**

```bash
git add src/main/services/jobs/JobRunner.ts \
        tests/main/services/jobs/job-runner.test.ts \
        package.json package-lock.json  # if ulid was added
git commit -m "feat(jobs): JobRunner tracking wrapper skeleton (D2)

Sprint A PR-4 D2 (Pass-7 HIGH #1+#2 + Pass-8 #8+#9 + Pass-9 #9).

  - enqueue<P, R>() returns SYNCHRONOUSLY with JobHandle<R> { id, kind, result }
  - Per-kind single-flight gate preserves three existing error messages
  - AbortController owned per job; ctx.signal (read-only) + ctx.registerCancel(fn)
  - No progress interception — existing emitters keep firing through their
    current paths
  - cancel(jobId) awaits all registered cancel callbacks
  - onLifecycle fires queued → running → completed/failed/cancelled

Normalised progress + concurrency cap + persistence are Sprint C."
```


---

### Task PR4-3 (D3): Wire site (i) — `PostgresImportExecutor.importSingleFile` (`:46`)

**Files:**
- Modify: `src/main/storage/postgres/PostgresImportExecutor.ts:46-71` — replace bespoke `inProgress` flag with JobRunner wiring; preserve return type.
- Create: `tests/main/storage/postgres-import-executor-job-runner.test.ts` — covers Gate 12 four dimensions for this site.

**Context:** Per D3 site (i) + Pass-9 #9 (cancellation uses `worker.postMessage({ type: 'cancel' })` per `PostgresImportWorkerClient.ts:106`, NOT `terminate()`).

- [ ] **Step 1: Inject a JobRunner instance.** The runner can be a module-singleton (`src/main/services/jobs/runner.ts` exports `jobRunner = new JobRunner()`) — Sprint C makes it injectable.

```typescript
// src/main/services/jobs/runner.ts
import { JobRunner } from './JobRunner'
export const jobRunner = new JobRunner()
```

- [ ] **Step 2: Refactor `PostgresImportExecutor.importSingleFile`.**

```typescript
import { jobRunner } from '../../services/jobs/runner'

class PostgresImportExecutor {
  // Drop: private inProgress = false  ← removed; JobRunner owns single-flight

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    const handle = jobRunner.enqueue<StorageImportSingleFileParams, StorageImportSingleFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        ctx.registerCancel(() => this.workerClient.postCancel())
        return await this._performImport(p)
      }
    )
    return handle.result
  }
}
```

Move the existing body into `_performImport`. The `workerClient.postCancel()` helper wraps `worker.postMessage({ type: 'cancel' })` per `PostgresImportWorkerClient.ts:106`.

- [ ] **Step 3: Write Gate 12 four-dimension tests for this site.**

```typescript
describe('PostgresImportExecutor.importSingleFile — Sprint A D3 (i) / Gate 12', () => {
  it('(a) return payload: returns StorageImportSingleFileResult unchanged', async () => { /* ... */ })
  it('(b) conflict: second concurrent call rejects with "An import is already in progress"', async () => { /* ... */ })
  it('(c) cancellation: jobRunner.cancel triggers worker.postMessage({type:"cancel"})', async () => { /* ... */ })
  it('(d) progress fixtures: recorded import:progress emissions are byte-identical to pre-PR-4', async () => {
    // Compare against a recorded fixture from main (pre-PR-4).
  })
})
```

- [ ] **Step 4: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-import-executor-job-runner.test.ts \
              tests/main/storage/postgres-import-executor.test.ts
make pg-down

git add src/main/storage/postgres/PostgresImportExecutor.ts \
        src/main/services/jobs/runner.ts \
        tests/main/storage/postgres-import-executor-job-runner.test.ts
git commit -m "feat(jobs): wire PostgresImportExecutor.importSingleFile through JobRunner (D3 i)

Sprint A PR-4 D3 site (i). Replaces bespoke inProgress flag with
jobRunner.enqueue('import_single', …). Cancellation routed through
worker.postMessage({type:'cancel'}) per PostgresImportWorkerClient.ts:106
(Pass-9 #9 — NOT terminate()). Existing return type
StorageImportSingleFileResult preserved (Pass-7 HIGH #1)."
```

---

### Task PR4-4 (D3): Wire site (ii) — `PostgresImportExecutor.importMultiFile`

**Files:**
- Modify: `src/main/storage/postgres/PostgresImportExecutor.ts:79-118` — same pattern. Shares the `'import_single'` JobKind with site (i) per Pass-9 #9 (the existing `inProgress` flag gates BOTH paths).

- [ ] **Step 1: Refactor `importMultiFile` symmetrically to site (i) using kind `'import_single'`.**

```typescript
async importMultiFile(
  params: StorageImportMultiFileParams
): Promise<StorageImportMultiFileResult> {
  const handle = jobRunner.enqueue<StorageImportMultiFileParams, StorageImportMultiFileResult>(
    'import_single',  // SAME KIND as importSingleFile per existing inProgress flag at :32
    params,
    async (ctx, p) => {
      ctx.registerCancel(() => this.workerClient.postCancel())
      return await this._performMultiImport(p)
    }
  )
  return handle.result
}
```

- [ ] **Step 2: Gate 12 tests** for this site (same four dimensions).

- [ ] **Step 3: Run + commit.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-import-executor.test.ts
make pg-down

git add src/main/storage/postgres/PostgresImportExecutor.ts \
        tests/main/storage/postgres-import-executor-job-runner.test.ts
git commit -m "feat(jobs): wire importMultiFile through JobRunner — shares import_single kind (D3 ii)

Sprint A PR-4 D3 site (ii) (Pass-9 #9). Multi-file and single-file imports
share JobKind 'import_single' because the existing inProgress flag at
PostgresImportExecutor:32 gates BOTH paths. Return type
StorageImportMultiFileResult preserved."
```

---

### Task PR4-5 (D3): Wire site (iii) — `batch-import-logic.ts:88`

**Files:**
- Modify: `src/main/ipc/handlers/batch-import-logic.ts` around `:88`
- Add tests under `tests/main/ipc/handlers/batch-import-logic.test.ts`.

- [ ] **Step 1: Refactor.**

```typescript
import { jobRunner } from '../../services/jobs/runner'

// Inside the batch handler:
const handle = jobRunner.enqueue<BatchImportParams, BatchImportResult>(
  'import_batch',
  { files },
  async (ctx, p) => {
    ctx.registerCancel(() => workerClient?.cancel())
    return await processBatch(p)
  }
)
return handle.result
```

The existing `callbacks.onCohortStale` and per-file IPC emissions stay untouched. Single-flight message: "A batch import is already in progress".

- [ ] **Step 2: Gate 12 tests** for batch import.

- [ ] **Step 3: Run + commit.**

```bash
make rebuild-node
npx vitest run tests/main/ipc/handlers/batch-import-logic.test.ts

git add src/main/ipc/handlers/batch-import-logic.ts \
        tests/main/ipc/handlers/batch-import-logic.test.ts
git commit -m "feat(jobs): wire batch-import-logic through JobRunner (D3 iii)

Sprint A PR-4 D3 site (iii). Single-flight kind 'import_batch'. Cancellation
via workerClient.cancel(). Existing callbacks.onCohortStale and per-file
IPC emissions unchanged."
```

---

### Task PR4-6 (D3): Wire site (iv) — `cohort-logic.ts:316` `runGeneBurdenCompare`

**Files:**
- Modify: `src/main/ipc/handlers/cohort-logic.ts` — replace `activeEngine !== null` guard with JobRunner; cancellation uses `activeEngine.abort()`.
- Add Gate 12 tests.

**Context:** Per D3 site (iv) + Pass-9 #9 (cancellation is `engine.abort()`, NOT `terminate()`).

- [ ] **Step 1: Refactor.**

```typescript
import { jobRunner } from '../../services/jobs/runner'

async function runGeneBurdenCompare(config: AssociationConfig, onProgress: ProgressCallback): Promise<AssociationResult> {
  const handle = jobRunner.enqueue<AssociationConfig, AssociationResult>(
    'association',
    config,
    async (ctx, p) => {
      let engineRef: AssociationEngine | null = null
      ctx.registerCancel(() => engineRef?.abort())
      engineRef = new AssociationEngine(/* … */)
      activeEngine = engineRef  // preserve the existing module-level reference for cohort:cancelAssociation
      try {
        return await engineRef.run(p)
      } finally {
        activeEngine = null
      }
    }
  )
  return handle.result
}
```

The existing `cohort:cancelAssociation` IPC channel still calls `activeEngine.abort()` directly — that path stays. JobRunner's cancellation merely chains the same call.

- [ ] **Step 2: Tests + commit.**

```bash
git add src/main/ipc/handlers/cohort-logic.ts \
        tests/main/ipc/handlers/cohort-logic-job-runner.test.ts
git commit -m "feat(jobs): wire runGeneBurdenCompare through JobRunner (D3 iv)

Sprint A PR-4 D3 site (iv). Single-flight kind 'association'. Cancellation
via engine.abort() (Pass-9 #9 — NOT terminate()). Existing
cohort:cancelAssociation IPC and onProgress callback unchanged."
```

---

### Task PR4-7 (D3): Wire site (v) — SQLite import path mirror

**Files:**
- Modify: `src/main/services/ImportService.ts` (or whichever class owns the SQLite single-file path — verify with `grep -rn "ImportService\|SqliteImport" src/main/services/`).
- Add Gate 12 tests for the SQLite path.

- [ ] **Step 1: Locate the SQLite analogue.**

```bash
grep -rn "ImportService\|inProgress\|already in progress" src/main/services/ src/main/storage/ 2>&1 | grep -v Postgres | head
```

- [ ] **Step 2: Refactor symmetrically to site (i)** using the SQLite worker's cancellation channel (likely `worker.postMessage` per `src/main/workers/import-worker.ts`).

- [ ] **Step 3: Gate 12 tests + commit.**

```bash
git add src/main/services/ImportService.ts tests/main/services/
git commit -m "feat(jobs): wire SQLite import path through JobRunner (D3 v)

Sprint A PR-4 D3 site (v) — fifth site per Pass-9 #9. Same JobKind
'import_single'; cancellation routed via the SQLite worker's postMessage
channel. Existing ImportResult preserved."
```

---

### Task PR4-8 (D4 + Gate 11): New `jobs:` IPC domain — registered, not consumed

**Files:**
- Create: `src/shared/ipc/domains/jobs.ts`
- Create: `src/main/ipc/domains/jobs.ts`
- Create: `src/preload/domains/jobs.ts`
- Modify: `src/preload/window-api/create-window-api.ts` — add `jobs`.
- Modify: `src/shared/types/api.ts` — add `jobs` to `WindowAPI`.
- Modify: tests/**/mocks/window-api.* — extend mock.
- Modify: `tests/shared/types/preload-contract.test.ts` — Gate 11 assertions.

**Context:** Per D4 + Gate 11. Channels: `jobs:list`, `jobs:get`, `jobs:progress`. **No renderer consumer in PR-4** — Sprint D's global jobs drawer ships against this contract.

- [ ] **Step 1: Implement the contract + handlers + preload binding** following the same pattern as the `debug` domain (PR2-4).

```typescript
// src/shared/ipc/domains/jobs.ts
import type { IpcResult } from '../../types/errors'
import type { Job, JobKind, JobStatus } from '../../../main/services/jobs/types'
// NB: the main-side type import is intentional — Job<P> is a shared shape.
// Alternatively, re-define Job in shared/types/jobs.ts and import from both sides.

export interface JobsApi {
  list(filter?: { kind?: JobKind; status?: JobStatus }): Promise<IpcResult<Job[]>>
  get(jobId: string): Promise<IpcResult<Job | null>>
  progress(jobId: string): Promise<IpcResult<Job['progress']>>
}

export const JOBS_CHANNELS = {
  list: 'jobs:list',
  get: 'jobs:get',
  progress: 'jobs:progress'
} as const
```

If sharing `Job` from `src/main/services/jobs/types.ts` triggers a layering violation, move the type to `src/shared/types/jobs.ts` and import from both sides.

- [ ] **Step 2: Implement handler + preload + window-api assembly + WindowAPI interface + mock.**

- [ ] **Step 3: Gate 11 assertions.**

```typescript
describe('jobs domain — Sprint A PR-4 Gate 11', () => {
  it('exposes jobs:list / jobs:get / jobs:progress', () => {
    expect(JOBS_CHANNELS.list).toBe('jobs:list')
    expect(JOBS_CHANNELS.get).toBe('jobs:get')
    expect(JOBS_CHANNELS.progress).toBe('jobs:progress')
  })

  it('existing import:progress / import:start payload shapes unchanged', () => {
    // Snapshot the existing types against fixtures; assert byte-identity.
  })
})
```

- [ ] **Step 4: Run + commit.**

```bash
make typecheck
make rebuild-node
npx vitest run tests/shared/types/preload-contract.test.ts

git add src/shared/ipc/domains/jobs.ts \
        src/main/ipc/domains/jobs.ts \
        src/preload/domains/jobs.ts \
        src/preload/window-api/create-window-api.ts \
        src/shared/types/api.ts \
        tests/shared/types/preload-contract.test.ts
git commit -m "feat(ipc): jobs domain (registered, not consumed) (D4 + Gate 11)

Sprint A PR-4 D4 + Gate 11. jobs:list / jobs:get / jobs:progress IPC
channels registered with full domain-module checklist (typed contract,
handler, preload, window-api, WindowAPI, mock, preload-contract).

No renderer consumer in PR-4 — Sprint D ships the global jobs drawer
against this contract. Existing import:progress / import:start payload
shapes asserted byte-unchanged."
```

---

### Task PR4-9 (D5 part 1): Multi-project architecture design doc

**Files:**
- Create: `.planning/specs/2026-05-28-multi-project-architecture.md` with `Status: Locked`.

**Context:** Per D5 + Gate 13. Covers data model (`projects` table), session model (where the implicit single-project assumption lives in `StorageSession`), hot-pool model (Sprint E), cross-project query story (Sprint E, PG-only via `UNION ALL` over schemas), existing-user migration story. No code references it yet.

- [ ] **Step 1: Write the design doc.** Section outline:

```markdown
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

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  schema_name TEXT NOT NULL,           -- PG schema OR SQLite path
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO projects (id, name, schema_name) VALUES (1, 'default', 'public');
```

## Session model

[... existing single-project assumption sites enumerated]

## Hot session pool

[... API sketch]

## Cross-project queries (PG)

[... UNION ALL over schemas approach]

## Migration story

[... existing users get the default project row backfilled in PR-4 D5;
Sprint E's renderer picks 'default' when no explicit project is selected.]

## Acceptance gates (for Sprint E plan)

1. SessionPool can hold N open StorageSessions; LRU eviction.
2. Project picker UI in renderer.
3. Cross-project cohort query (PG only) returns set-equal results to
   running the query against each schema separately and UNION-ing.
4. Existing single-project users see no behaviour change.
```

- [ ] **Step 2: Commit.**

```bash
git add .planning/specs/2026-05-28-multi-project-architecture.md
git commit -m "docs(spec): multi-project architecture design doc (D5 + Gate 13)

Sprint A PR-4 D5 + Gate 13. Status: Locked. Covers data model, session
model, hot-pool, cross-project queries (PG-only UNION ALL), existing-user
migration. No code references it in Sprint A — Sprint E plans against
this doc.

Cheap-to-add-now-expensive-to-add-later: the projects-registry migration
in the same PR backfills the default project for existing databases."
```

---

### Task PR4-10 (D5 part 2): Projects registry migration — PG + SQLite

**Files:**
- Create: `src/main/storage/postgres/migrations/sql/0011_projects_registry.sql`
- Modify: `src/main/storage/postgres/migrations/definitions.ts` — append.
- Modify: `src/main/database/migrations.ts` — append v30 block.

**Re-verify migration numbers** at execution time:

```bash
ls src/main/storage/postgres/migrations/sql/ | sort | tail -3
grep -n "PRAGMA user_version" src/main/database/migrations.ts | tail -3
```

If PR-3 has landed, PG head is `0010_cohort_summary.sql` → this is `0011`. SQLite head is v29 (from PR-1) → this is v30.

- [ ] **Step 1: PG SQL.**

`src/main/storage/postgres/migrations/sql/0011_projects_registry.sql`:

```sql
-- Sprint A PR-4 D5 — projects registry. Single-row default backfill so
-- Sprint E doesn't have to handle projectless databases (cheap-to-add-now
-- /expensive-to-add-later). No code references this table in Sprint A.

CREATE TABLE IF NOT EXISTS "__schema__"."projects" (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO "__schema__"."projects" (id, name, schema_name)
VALUES (1, 'default', '__schema__')
ON CONFLICT (id) DO NOTHING;
```

The `'__schema__'` literal in the seed is intentional — it gets template-replaced at execution time so `schema_name` reflects the actual schema.

- [ ] **Step 2: Register the PG migration** in `definitions.ts`.

- [ ] **Step 3: SQLite migration v30.**

```typescript
// Migration v30: projects registry
// Sprint A PR-4 D5. Mirrors PG 0011.
if (currentVersion < 30) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      schema_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO projects (id, name, schema_name)
      VALUES (1, 'default', 'main');
  `)
  db.exec('PRAGMA user_version = 30')
}
```

- [ ] **Step 4: Test both migrations** — fresh + existing-data paths both end with the default row present.

```typescript
describe('projects registry migration — D5', () => {
  it('PG: creates table + seeds default row', async () => { /* ... */ })
  it('PG: re-applying migration is idempotent', async () => { /* ... */ })
  it('SQLite v30: creates table + seeds default row', async () => { /* ... */ })
})
```

- [ ] **Step 5: Run.**

```bash
make pg-reset && make pg-up && make rebuild-node
npx vitest run tests/main/storage/postgres-migration-runner.test.ts \
              tests/main/storage/postgres-migrations-registration.test.ts \
              tests/main/database/migrations.test.ts
make pg-down
```

- [ ] **Step 6: Commit.**

```bash
git add src/main/storage/postgres/migrations/sql/0011_projects_registry.sql \
        src/main/storage/postgres/migrations/definitions.ts \
        src/main/database/migrations.ts \
        tests/main/storage/ tests/main/database/
git commit -m "feat(db): projects registry — PG 0011 + SQLite v30 (D5)

Sprint A PR-4 D5. Mirrors the multi-project design doc. No code references
the projects table in Sprint A — Sprint E will. Cheap-to-add-now: the
'default' seed row prevents Sprint E from having to migrate existing
data or handle projectless databases."
```

---

### PR-4 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 2.** `VARLENS_WEB=1 make ci` exits 0.
- [ ] **Gate 11.** preload-contract test for `jobs:` domain green; existing `import:progress` / `import:start` shapes unchanged.
- [ ] **Gate 12.** JobRunner regression tests for the five sites cover all four dimensions (return payload, conflict behavior, cancellation, progress fixtures).

```bash
make rebuild-node
npx vitest run tests/main/storage/postgres-import-executor-job-runner.test.ts \
              tests/main/ipc/handlers/batch-import-logic.test.ts \
              tests/main/ipc/handlers/cohort-logic-job-runner.test.ts \
              tests/main/services/ \
              tests/shared/types/preload-contract.test.ts
```

- [ ] **Gate 13.** `.planning/specs/2026-05-28-multi-project-architecture.md` exists with `Status: Locked` and an acceptance-gate list.

- [ ] **Open the PR.**

```bash
gh pr create --title "feat(jobs): JobRunner skeleton + multi-project design doc" \
  --body "$(cat <<'EOF'
## Summary

Sprint A PR-4 (sprint exit). Tracking-wrapper JobRunner over five existing
long-running-work sites, new jobs: IPC domain (registered, not consumed),
multi-project architecture design doc + projects-registry migration.

Spec: `.planning/specs/2026-05-28-sprint-a-foundations.md`

## Verification

- [x] Gate 1 — `make ci-full` green
- [x] Gate 2 — `VARLENS_WEB=1 make ci` green
- [x] Gate 11 — preload-contract jobs: domain + import shapes unchanged
- [x] Gate 12 — five sites × four dimensions all green
- [x] Gate 13 — multi-project design doc `Status: Locked` lands
EOF
)"
```

After PR-4 merges, **Gate 14 — Sprint exit:** Tag **0.68.0** on `main` per the runbook. CHANGELOG `[Unreleased]` block promoted; tag↔package.json guard (shipped in 0.59.5) must pass.

---

## Sprint A close-out (controller)

After all four PRs land on `main`:

- [ ] **Final `make ci-full` on `main`.**

- [ ] **Tag cadence with the user.**
  - **0.66.0** after PR-1 (or PR-1 + PR-2 bundle)
  - **0.67.0** after PR-3
  - **0.68.0** after PR-4 (sprint exit)

  Spec's PR-shape table is the canonical tag map. Three intermediate tags + sprint exit = four total.

- [ ] **Promote `[Unreleased]` and bump `package.json` per the runbook** on a short-lived `release/vX.Y.Z` branch with its own PR. `AGENTS.md` forbids feature/work commits on `main`; the version-bump + changelog-promotion lives in a tiny release PR.

```bash
git checkout main && git pull --ff-only
git checkout -b release/v0.68.0
# Promote [Unreleased] → [0.68.0] in CHANGELOG.md; bump package.json to 0.68.0
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): v0.68.0"

gh pr create --title "chore(release): v0.68.0" --body "Sprint A exit. Promotes [Unreleased] and bumps package.json for v0.68.0."
# Merge once green.

git checkout main && git pull --ff-only
git tag -a v0.68.0 -m "v0.68.0"
git push origin v0.68.0
```

The release workflow's tag↔package.json guard (shipped 0.59.5) refuses a mismatch.

---

## Self-review checklist (for the controller before dispatching)

- [ ] Every spec acceptance gate (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10a, 10b, 10c, 11, 12, 13, 14) maps 1:1 to a verification step above.
  - Gate 1 (CI) → end of each PR
  - Gate 2 (web parity) → end of each PR
  - Gate 3 (PR-1 perf) → PR-1 acceptance gates
  - Gate 4 (PR-1 call count) → PR1-3 + PR-1 acceptance gates
  - Gate 5 (PR-1 cloneForIpc grep) → PR1-9 + PR-1 acceptance gates
  - Gate 6 (PR-2 coverage ≥ 80%) → PR2-8 + PR-2 acceptance gates
  - Gate 7 (PR-2 wrapper fallback) → PR2-9 + PR-2 acceptance gates
  - Gate 8 (PR-3 cohort p95 < 500ms) → PR3-14 + PR-3 acceptance gates
  - Gate 9 (PR-3 backend parity) → PR3-15 + PR-3 acceptance gates
  - Gate 10 (PR-3 drift) → PR3-16 + PR-3 acceptance gates
  - Gate 10a (PR-1 BatchAnnotationKey) → PR1-6 + PR-1 acceptance gates
  - Gate 10b (PR-3 cohort warnings) → PR3-17 + PR-3 acceptance gates
  - Gate 10c (PR-2 debug domain) → PR2-4 + PR-2 acceptance gates
  - Gate 11 (PR-4 jobs domain) → PR4-8 + PR-4 acceptance gates
  - Gate 12 (PR-4 four-dim tests × 5 sites) → PR4-3..PR4-7 + PR-4 acceptance gates
  - Gate 13 (PR-4 design doc) → PR4-9 + PR-4 acceptance gates
  - Gate 14 (sprint exit tag) → close-out section
- [ ] One task per spec sub-item (A1, A2, A3, A4 → PR1-3..PR1-14 with A1-prereqs and Case+Cohort parity; B1-B4 → PR2-1..PR2-11; C1, C2, C2a, C5a, C3, C4, C5, C6, C7, C8 → PR3-1..PR3-17; D1-D5 → PR4-1..PR4-10).
- [ ] TDD pairs: PR1-3/PR1-4, PR1-7, PR1-10, PR2-2, PR2-3, PR3-2..PR3-7, PR3-15, PR3-16, PR4-2.
- [ ] No placeholders, no "TBD", no "similar to Task N" — every code block is the actual code.
- [ ] Branch convention respected: no work on `main`. Each PR has its own branch named per the spec's PR-shape table.
- [ ] Cohort parity called out where it bites: A3 (PR1-12 Case + PR1-13 Cohort) + C7 backend-parity (PR3-15).
- [ ] Cross-AI review findings Pass 1–9 are referenced inline in task contexts; not re-litigated.

---

## Execution handoff

Plan complete and saved to `.planning/plans/2026-05-28-sprint-a-foundations-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh `gsd-executor` per task; review between tasks; fast iteration. Compatible with `superpowers:subagent-driven-development` and the project's own `/gsd-execute-phase` machinery (the `.planning/` layout matches).

**2. Inline execution** — `superpowers:executing-plans` batched against the four PR branches with checkpoints.

For PR-1 + PR-2 parallel work, use git worktrees (`superpowers:using-git-worktrees`) so each branch has its own checkout.
