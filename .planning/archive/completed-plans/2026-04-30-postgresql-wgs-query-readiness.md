# PostgreSQL WGS Query Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce evidence for or against WGS-scale PostgreSQL query readiness before making public WGS query claims.

**Architecture:** Use the existing WGS fixture, `tests/perf/postgres-wgs-query.perf.test.ts`, and `make pg-query-perf`. Add reporting and budget checks before deciding any new index changes.

**Tech Stack:** PostgreSQL 18 Docker, Vitest perf tests, Node.js perf artifact scripts, `.planning/artifacts/perf/postgres-query/`.

---

## Task 1: Baseline Fixture And Artifact Audit

**Files:**

- Modify: `scripts/perf/compare-postgres-query.mjs` if present, otherwise create it
- Modify: `Makefile`
- Test: `tests/main/storage/postgres-query-benchmark.test.ts` if present, otherwise create `tests/scripts/postgres-query-perf-report.test.ts`

- [ ] **Step 1: Confirm fixture workflow**

Run:

```bash
scripts/postgres/download-wgs-fixture.sh
make pg-reset
make pg-up
```

Expected: fixture exists under `tests/.cache/wgs/` and PostgreSQL is reachable.

- [ ] **Step 2: Ensure artifact schema is stable**

Create or update a report script so every run writes JSON with:

```json
{
  "generatedAt": "ISO timestamp",
  "postgresVersion": "string",
  "fixture": "string",
  "caseCount": 0,
  "variantCount": 0,
  "queries": [
    {
      "name": "string",
      "p50Ms": 0,
      "p95Ms": 0,
      "maxMs": 0,
      "rows": 0
    }
  ]
}
```

- [ ] **Step 3: Add artifact tests**

Test that the comparison script rejects missing `p50Ms`, `p95Ms`, or query names.

Run:

```bash
npx vitest run tests/scripts/postgres-query-perf-report.test.ts
```

Expected: PASS.

## Task 2: Query Budget Definition

**Files:**

- Create: `.planning/docs/postgresql-wgs-query-budgets.md`
- Modify: `tests/perf/postgres-wgs-query.perf.test.ts`

- [ ] **Step 1: Define budgets**

Document initial evidence budgets:

- exact coordinate lookup p95 <= 250 ms;
- gene query p95 <= 1500 ms;
- impact/pathogenicity filter p95 <= 2500 ms;
- text search p95 <= 3000 ms;
- cohort carrier query p95 <= 5000 ms.

State that budgets are provisional until two local runs and one CI-like Linux run agree within 25%.

- [ ] **Step 2: Wire budget metadata into perf test**

Each benchmark case must include a stable name matching the doc and budget metadata in the emitted artifact.

- [ ] **Step 3: Run perf test**

Run:

```bash
VARLENS_RUN_WGS_QUERY_PERF=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts
```

Expected: PASS if artifacts are written; do not fail on budget yet until baseline is reviewed.

## Task 3: Evidence Run And Review

**Files:**

- Generated only: `.planning/artifacts/perf/postgres-query/` (gitignored)
- Modify: `.planning/docs/postgresql-wgs-query-budgets.md`

- [ ] **Step 1: Run query perf gate**

Run:

```bash
make pg-reset
make pg-up
make pg-query-perf
```

Expected: PASS and artifact written under `.planning/artifacts/perf/postgres-query/`.

- [ ] **Step 2: Summarize evidence**

Update `.planning/docs/postgresql-wgs-query-budgets.md` with:

- artifact file path;
- PostgreSQL version;
- fixture identity;
- p50/p95/max table;
- budget pass/fail per query;
- recommendation: no index changes, add targeted index changes, or defer WGS claim.

Do not commit generated artifact files unless repository policy changes.

## Task 4: Conditional Index Plan

**Files:**

- Create only if evidence requires it: `.planning/plans/2026-04-30-postgresql-wgs-query-index-followup.md`

- [ ] **Step 1: Decide from evidence**

If all budgets pass, write in the budget doc that no index follow-up is needed.

If any budget fails by more than 25%, create a separate follow-up plan with:

- the failing query;
- `EXPLAIN (ANALYZE, BUFFERS)` evidence;
- proposed index;
- migration file path;
- rollback risk;
- before/after benchmark commands.

Do not implement indexes in this plan.

## Plan Verification

After all tasks:

```bash
scripts/postgres/download-wgs-fixture.sh
make pg-reset
make pg-up
make pg-query-perf
npx vitest run tests/scripts/postgres-query-perf-report.test.ts
make typecheck
```

Commit:

```bash
git add Makefile scripts tests .planning/docs .planning/plans
git commit -m "test(postgres): document WGS query readiness evidence"
```

