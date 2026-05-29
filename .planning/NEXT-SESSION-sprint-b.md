# Next session — spec + plan "Sprint B — Storage shape"

**Status:** Sprint A shipped as `v0.68.0` (PRs #241–#246). Sprint B is the next milestone, roadmapped in `.planning/artifacts/audit-2026-05-25/03-scalability.md` but **not yet spec'd/planned**.

## How to run it (ultracode)

`"fan out agents and use workflow"` is **not** the ultracode trigger. Two orthogonal mechanisms:

- **Per-message:** include the word `workflow` → one workflow for that task.
- **Standing mode:** run `/effort ultracode` → xhigh reasoning + automatic workflow orchestration for the whole session (no keyword needed). Also toggleable via `/config` → "Dynamic workflows"; disable via `disableWorkflows` setting or `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.

**Recommended:** run `/effort ultracode`, then paste the prompt below.

## Paste-in prompt

```
VarLens — spec + plan "Sprint B — Storage shape" (next milestone after Sprint A, shipped as v0.68.0). Produce the SPEC and the executable PLAN only — do NOT execute/implement yet.

START by grounding yourself:
- Read memory project_sprint_a_execution.md, then `git log --oneline -12` and confirm `make ci` is green on main.
- Read the roadmap source: .planning/artifacts/audit-2026-05-25/03-scalability.md — the "Sprint B — Storage shape" subsection AND the "What Was NOT Confirmed" section.
- Use .planning/specs/2026-05-28-sprint-a-foundations.md + .planning/plans/2026-05-28-sprint-a-foundations-plan.md as the STRUCTURAL TEMPLATE (four independently-shippable PRs, numbered acceptance gates, TDD + atomic Conventional Commits, codebase reality-checks, branch discipline).

SCOPE — Sprint B covers these audit items (verify against current code, don't invent):
- F1: partition `variants` + `variant_transcripts` + `variant_sv/cnv/str` by LIST(chr) DEFAULT (next PG migration is 0012; SQLite head is v31).
- F2: `info_json` TEXT → JSONB + GIN (jsonb_path_ops), sequenced BEHIND the F1 partition rewrite to avoid a double rewrite; STORED generated columns for hot INFO fields.
- F3: BRIN(chr,pos) per partition.
- F8: PG `gene_burden_summary` (mirror Sprint A's cohort_variant_summary materialisation pattern in src/shared/sql/) + convert GeneBurdenTable.vue to v-data-table-server pagination, with a "min affected cases" pre-filter. Cohort-view parity is mandatory in the same PR.

EXIT CRITERION (bake into gates): re-run the 8-case WGS query perf harness on the partitioned+JSONB+BRIN schema; all five budgets pass with 25% margin; new artifact under .planning/artifacts/perf/postgres-query/; make ci-full green; VARLENS_WEB=1 make ci green.

VALIDATE-FIRST (the audit says these are unconfirmed — address as a Sprint B PR-0 spike or as explicit open questions/risks in the spec, don't assume):
1. Real 100-case PG import wall-time (calibrate the linear-scaling assumption).
2. PG VACUUM/bloat at scale: delete-50-cases-then-vacuum, measure n_dead_tup, before shipping partitioning.
3. No 1000-case renderer fixture exists — note the dependency.

CONVENTIONS to honor: no console.* (structured loggers); IPC domain-module pattern + preload-contract test; migrations exempt from agent-health but baseline must not grow unsilently; never lower thresholds; .planning/ for all spec/plan/artifacts (never docs/); web-parity gate for shared/renderer changes.

Deliverables: .planning/specs/<date>-sprint-b-storage-shape.md and .planning/plans/<date>-sprint-b-storage-shape-plan.md. End by summarising the PR breakdown, gates, and the validate-first spikes — then stop for my review before any execution.
```

## Sprint A → B dependency notes (verified)

- Migration heads after Sprint A: **PG `0011`** (projects_registry), **SQLite `v31`** (projects). Sprint B's F1 partition migration is **PG `0012`**.
- Sprint A shipped the materialised PG `cohort_variant_summary` + `cohort_column_meta` + incremental-maintenance SQL (`src/shared/sql/cohort-summary-*.ts`) — **F8 `gene_burden_summary` mirrors that pattern**.
- Sprint A also landed: JobRunner skeleton + `jobs:`/`debug:` IPC domains, projects registry + multi-project design doc (`.planning/specs/2026-05-28-multi-project-architecture.md` = the Sprint E spec), renderer perf (A1–A4), and PG named statements (`runNamed`/`runNamedDynamic`).
- Env: VarLens dev Postgres runs on port **55434** (`.env.postgres.local`; 55432 is taken by the `pubtator` container). Deferred Sprint A measurements: Gate-3 (renderer-perf) and Gate-6 (named-statement coverage) need the frozen/parity fixture, absent in the current environment.

## Full milestone roadmap (from the scalability audit)

| Sprint | Theme | Status |
|---|---|---|
| A | Foundations | ✅ shipped v0.68.0 |
| **B** | **Storage shape** (partition, JSONB+GIN, BRIN, PG gene_burden) | **next — spec/plan here** |
| C | Throughput (concurrent imports, cancel-resume, hash swap) | roadmapped |
| D | Renderer/UX (virtualization, search budgets, job drawer) | roadmapped (needs 1000-case fixture builder) |
| E | Multi-tenancy polish (finish multi-project; design doc already locked) | roadmapped |
