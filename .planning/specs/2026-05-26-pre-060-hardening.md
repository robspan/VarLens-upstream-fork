# Pre-0.60 Hardening — Spec

**Status:** Locked 2026-05-26
**Audit input:** [.planning/code-review/CODEBASE-AUDIT-2026-05-25.md](../code-review/CODEBASE-AUDIT-2026-05-25.md) §4 Sprint 0 + §3 specialist findings
**Successor plan:** [.planning/plans/2026-05-26-pre-060-hardening-plan.md](../plans/2026-05-26-pre-060-hardening-plan.md)

## Goal

Ship the four release-blocking fixes (logger PHI redaction at the persistence + IPC boundary, CHANGELOG backfill, release tag↔version assertion, IPC-payload Zod validation on the import handler family) plus a curated set of defence-in-depth, hygiene, and hot-path performance fixes — coordinated so that VarLens can cut tag **0.59.5** immediately after PR-1 lands and a follow-up tag (0.59.6 or 0.60.0) after PR-2 / PR-3 / PR-4 settle.

The phase deliberately stops short of the structural work tracked under "Non-goals" below. That work is sized for Sprint A / Sprint B and would gate a release if bundled here.

## Audience

A coding agent (Claude Code, Codex, OpenCode, …) executing [`superpowers:subagent-driven-development`](../plans/2026-05-26-pre-060-hardening-plan.md) one task at a time against four PR branches.

## In scope

The 16 quick-wins below are atomic. Each cites the audit section that motivates it and lives in exactly one of four PRs (see *PR shape* further down). Cohort-view parity (`feedback_cohort_parity.md`) and the never-lower-thresholds rule (`feedback_never_lower_thresholds.md`) apply throughout.

### Release-blockers (PR-1)

| ID | Title | Audit ref | Rationale |
|---|---|---|---|
| **QW-1** | Hoist `sanitizeLogMessage` to `src/shared/utils/sanitizers.ts`; call from `MainLogger` (every level) AND from the IPC emit path before `webContents.send`. New `tests/main/services/main-logger-redaction.test.ts` asserts HGVS / coord / patient-ID inputs are redacted *on disk* (`log.transports.file`). | Rel-04 Obs-1, §3.1 | Sanitizer ships in renderer only today; PHI reaches the log file and the renderer-side log channel unredacted. Hoist resolves both reach paths. |
| **QW-2** | Backfill `CHANGELOG.md` for the 13 tagged-but-undocumented releases: **v0.56.8, v0.56.9, v0.56.10, v0.56.11, v0.56.12, v0.56.13, v0.56.14, v0.58.0, v0.58.1, v0.58.2, v0.58.3, v0.59.0, v0.59.3** (v0.57.x and v0.59.1/2/4 were never tagged — confirmed via `git tag --list --sort=v:refname`). Use `git log <prev>..<tag> --no-merges` per pair, grouped by Conventional Commit type. Preserve the existing `## [Unreleased]` header. Add a short release-runbook note documenting the "promote `[Unreleased]` before bumping `package.json`" convention. The `[Unreleased]` block at PR-1-merge time will roll into the next tagged version (likely v0.59.5 or v0.60.0) per the runbook. | Rel-04 Doc-1 | Thirteen tagged releases without changelog entries. Runbook note is the chosen form for gate 6 (see below). |
| **QW-3** | In `.github/workflows/release.yml` `create-release` job, add a step that asserts `node -p "require('./package.json').version" === "${GITHUB_REF_NAME#v}"` and fails the job otherwise. Place immediately after the existing *Extract version from tag* step and *before* the *Verify Build workflow passed on tagged SHA* step. | Rel-04 CR-2, §3.2 | Today a mismatched tag would silently publish a package.json-versioned artifact under the wrong tag name. |

### IPC payload validation (PR-2)

| ID | Title | Audit ref | Rationale |
|---|---|---|---|
| **QW-7** | (a) Add Zod schemas in `src/shared/types/ipc-schemas.ts` for `import:start`, `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`. (b) Add `ErrorCode.INVALID_PARAMETERS` to `src/shared/types/errors.ts`, a new `InvalidParametersError` class in `src/main/database/errors.ts` (or a new `src/main/ipc/errors.ts`), and a branch in `src/main/ipc/errorHandler.ts::toSerializableError` that maps it. (c) Wire `safeParse` in `src/main/ipc/handlers/import.ts`; on failure, throw the new `InvalidParametersError` so `wrapHandler` returns a `SerializableError` plain object whose `code === ErrorCode.INVALID_PARAMETERS`. (d) Path-traversal validation lives at the **IPC boundary** in main, not in the worker-shared `BedFilter`: a new `src/main/security/import-path-allowlist.ts` module (Electron-aware, main-only) tracks dialog-picked paths and validates against `app.getPath('home' / 'userData' / 'temp')`. The import handlers reject before dispatching to either worker. `BedFilter.fromFile` (called from both `src/main/workers/import-worker.ts` and `src/main/workers/postgres-import-worker.ts:606`) gets a **worker-safe defensive check** with no Electron imports: reject relative paths, reject paths containing `..` after resolve. | Sec-02 F-01, §3.2 | The import handlers accept renderer-controlled strings. A compromised renderer can pass `/etc/passwd` to `fromFile`. Boundary lives in main because the PG import worker cannot import `electron`. |
| **QW-8** | `safeParse(z.number().int().min(0).max(64))` on the `count` arg of the `system:setWorkerThreads` IPC handler (`src/main/ipc/handlers/system.ts:71-75`). | Sec-02 F-02 | Renderer-supplied integer hits `setWorkerThreads` directly. |
| **QW-9** | (a) In `src/main/ipc/handlers/shell.ts:24`, tighten `UserDomainsSchema` to `z.array(z.string().min(1).max(253)).max(100)`. (b) In `src/main/database/DatabaseService.ts:74` and `:304` (and any worker analogues — grep `pragma(\`key='\``), reject keys whose escaped form matches `/^x'/` (SQLCipher hex-literal syntax bypasses the parameterised quoting). Throw a `DatabaseError`. | Sec-02 F-04 / F-05 | Today the user-domains array is unbounded; the PRAGMA-key escaping is single-quote-only and does not catch hex-literal injection. |

### Hygiene + CI hardening (PR-3)

| ID | Title | Audit ref | Rationale |
|---|---|---|---|
| **QW-4** | `npm audit fix` for the one moderate-severity transitive (`qs` under `pg`). Verify `npm audit --omit=dev` returns **0 critical / 0 high / 0 moderate**. | §3.2 | Open advisory in shipping graph. |
| **QW-6** | In `src/main/index.ts:createWindow`, attach `mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(rendererUrl) && !url.startsWith('file://')) event.preventDefault() })`. | Sec-02 F-10 | `setWindowOpenHandler` covers `window.open` paths but not in-page navigations. |
| **QW-12** | `.github/workflows/build.yml` build-status job: treat `cancelled` / `skipped(after-failure)` as failure UNLESS `needs.changes.outputs.code == 'false'`. (Skipped because no code changed is fine; skipped because a prior job failed is not.) | Rel-04 CR-1 | Today a cancelled OS build job is interpreted as passing. |
| **QW-13** | `.github/workflows/build.yml` `code:` path filter: change to `'.github/workflows/**'` so workflow-only edits still go through the full pipeline. | Rel-04 CR-3 | Workflow edits today can skip the very pipeline they modify. |
| **QW-15** | In `src/main/ipc/handlers/database.ts` (alongside the existing `VARLENS_POSTGRES_PROFILE_SECRET_STORE === 'insecure-local'` branch at line 161), `mainLogger.warn` at startup when that mode is active. Message must name the env-var and recommend disabling for any non-dev workflow. | Sec-02 F-06 | Insecure mode silently active today. |

### Perf hot-path (PR-4)

| ID | Title | Audit ref | Rationale |
|---|---|---|---|
| **QW-10** | New migration in `src/main/database/migrations.ts` (next version is **28** — last is `PRAGMA user_version = 27` at `migrations.ts:1718`): `CREATE INDEX IF NOT EXISTS idx_variants_case_type ON variants(case_id, variant_type);`. **Keep** the existing `idx_variants_type_case (variant_type, case_id)` at `migrations.ts:1429` — it is documented in `variant-extension-registry.ts` as the planner's hook for `variant_type`-first reads. The audit's "drop in a follow-up" is explicitly deferred to a separate strand once query telemetry confirms it is unused. | Perf-01 #4 / #10 | Cohort views filter on `case_id`-first; today the planner has no `(case_id, variant_type)` covering pair. |
| **QW-11** | In `src/main/workers/import-pipeline.ts:finishBulkInsert` (around `:247-266`), drop the per-file `INSERT INTO variants_fts('rebuild')` and `db.exec(createFTSTriggers)` calls. Keep `updateVariantCountStmt.run(...)` per file. Session-end `rebuildFts` in `src/main/workers/import-worker.ts:252` already handles the final rebuild — confirm before deleting. | Perf-01 #8 | Per-file rebuild compounds quadratically for multi-file imports (worst-case observed in audit fixture: 11× wall-clock vs. session-end rebuild). |
| **QW-14** | `scripts/perf/compare-wgs-import.mjs`: `process.exit(1)` on budget breach. **No Makefile change** — the script today is called directly (`node scripts/perf/compare-wgs-import.mjs`), not via a `perf-wgs-compare` target, so a non-zero exit propagates naturally to any shell caller. (Confirmed: `grep -n perf-wgs Makefile` finds only the existing `tests/perf/*.perf.test.ts` recipe.) | Rel-04 CR-6 / Perf-2 | Perf comparison today logs the breach but exits 0 — gate is effectively informational. |
| **QW-16** | New PG migration `0007_perf_indexes.sql` in `src/main/storage/postgres/migrations/sql/`, registered in `definitions.ts`. SQL: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`, then `CREATE INDEX IF NOT EXISTS variants_brin_chr_pos ON "__schema__"."variants" USING BRIN (chr, pos);` and `CREATE INDEX IF NOT EXISTS variants_gene_trgm ON "__schema__"."variants" USING GIN (gene_symbol gin_trgm_ops);`. The `"__schema__"."<table>"` quoting matches existing migrations (`0001_create_cases.sql` and friends) — the placeholder is template-replaced at execution time. Defer the JSONB GIN to Sprint B per audit BP-05 §5. | Sch-03 F3, BP-05 §5 | The two cheap-to-build indexes that the PG cohort path is missing today. |

## Non-goals (defer)

These are real findings in the audit, but they either depend on contract changes, broaden the blast radius, or are sized for a dedicated phase. Each is tagged with the sprint that owns it.

- **`cloneForIpc` redesign (was QW-5)** — Sprint A. The current renderer-facing `cloneForIpc` deliberately strips Vue `reactive()`/`ref()` proxies via a JSON round-trip; `tests/renderer/utils/cloneForIpc.test.ts:24-33` locks this contract in. A naive `structuredClone` body throws `DataCloneError` on Vue proxies. The proper fix is to separate "strip proxies" (renderer, Vue-aware) from "deep clone" (main / cross-process, can use `structuredClone`) — but that is a contract split, not a one-line swap, and requires its own design. Phase 1 keeps the JSON implementation untouched.
- **JobRunner abstraction** — Sprint A
- **PG `cohort_variant_summary` materialisation** — Sprint A
- **`AnnotationRepository.getBatch` N+1 fix** — Sprint A (depends on IPC payload shape change)
- **PG named / prepared statements rollout** — Sprint A
- **`shallowRef` / `markRaw` audit** — Sprint A
- **Hidden `FilterToolbar` deferred mount** — Sprint A
- **`info_json` → `JSONB` conversion** — Sprint B (bundle with partitioning)
- **`variants` partitioning** — Sprint B
- **Custom protocol + `GrantFileProtocolExtraPrivileges` flip** — Sprint B
- **`agent-health-baseline.json` file-split work** — separate strand (audit §3.6)
- **macOS notarization / Apple Developer ID** — depends on org spend decision

## Acceptance gates

Every gate is enumerated here and must map 1:1 to a verification step in the implementation plan.

1. **CI:** `make ci-full` is green on every PR branch before merge.
2. **QW-1 evidence test:** `tests/main/services/main-logger-redaction.test.ts` asserts that `mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001')` writes a line containing `[REDACTED:COORD]`, `[REDACTED:HGVS]`, `[REDACTED:ID]` to `log.transports.file.getFile().path`, and that `webContents.send` receives the same redacted message. Mocks `electron-log/main` (not `electron-log/node`) because `MainLogger.ts:22,29` imports `electron-log/main`.
3. **QW-4 evidence:** `npm audit --omit=dev` returns 0 critical / 0 high / 0 moderate (today: 1 moderate).
4. **QW-3 evidence — synthetic mismatched-tag dry run:** Manually push (or `act`-simulate) a tag whose name does not match `package.json` version on a throwaway branch; the `create-release` job fails at the new assertion step.
5. **QW-7 evidence:** Three assertions, encoded in the existing flat-test directory layout (`tests/main/ipc/handlers/` and `tests/main/import/vcf/`):
   (a) `tests/main/ipc/handlers/import.test.ts` (new or extended) asserts that a malformed `import:start` payload returns a `SerializableError` plain object (NOT an `{ok, error}` wrapper — `IpcResult<T> = T | SerializableError` per `src/shared/types/errors.ts:23`) whose `code === ErrorCode.INVALID_PARAMETERS`.
   (b) A unit test on the new `src/main/security/import-path-allowlist.ts` asserts `isAllowedImportPath('/etc/passwd')` returns `false` and `isAllowedImportPath` of a `temp`-dir path returns `true`.
   (c) A unit test on `BedFilter.fromFile` asserts the worker-safe defensive check rejects relative paths and paths containing `..` after resolve. (No allow-list check in the worker — that lives at the IPC boundary.)
6. **CHANGELOG gate:** `CHANGELOG.md` is current as of HEAD when PR-1 lands. The chosen enforcement is a release-runbook line (no CI hook this phase): `docs/internal/release-runbook.md` (or the closest existing analogue under `.planning/docs/`) gains a step that says "promote `[Unreleased]` block to the new version section before bumping `package.json`". A CI hook is explicitly **out of scope** for Phase 1 (deferred to Sprint A if the runbook proves insufficient).
7. **Perf parity:** `renderer-perf-phase1` artifacts under `.planning/artifacts/perf/phase1/` show **no regression** after QW-11 lands. (QW-5 was dropped from Phase 1 — see Non-goals.) Capture a "before PR-4" baseline immediately after PR-1/2/3 are in, then re-run after PR-4 — both artifacts captured only to the local artifact directory (the directory is gitignored on purpose; the PR description quotes the relevant timings).
8. **Tag cut:** Tag **0.59.5** (or **0.60.0** if PR-2/3/4 are bundled) lands on `main` with all four release-blockers merged. The release workflow's new assertion (gate 4) passes on that tag.

## PR shape

Four PRs, four branches. PR-1 ships first and unblocks the 0.59.5 tag. PR-2 and PR-3 are independent and can land in either order. PR-4 lands last so the renderer-perf-phase1 baseline (gate 7) is captured against the post-PR-1/2/3 state.

| PR | Branch | Tasks | Title (Conventional Commits) |
|---|---|---|---|
| **PR-1** | `fix/release-pre-060-blockers` | QW-1, QW-2, QW-3 | `fix(release): pre-0.60 release blockers` |
| **PR-2** | `fix/ipc-import-payload-validation` | QW-7, QW-8, QW-9 | `fix(ipc): validate import handler payloads at runtime` |
| **PR-3** | `chore/security-and-ci-hygiene` | QW-4, QW-6, QW-12, QW-13, QW-15 | `chore: security + CI hygiene` |
| **PR-4** | `perf/hot-path-cleanup` | QW-10, QW-11, QW-14, QW-16 | `perf: hot-path cleanup` |

## Project-rule constraints (all PRs)

- **Branch discipline.** `AGENTS.md` forbids feature/work commits on `main`. Use a git worktree if the current checkout must stay clean.
- **Cohort parity.** For QW-10 (index) and QW-11 (FTS rebuild change) confirm there is no cohort-view code path that depends on the old behaviour — grep `cohort_variant_summary`, `cohort.ts`, `CohortSummaryService.ts` for callers.
- **Never lower thresholds.** Coverage / lint / typecheck thresholds stay where they are; failing suites are fixed by adding tests or fixing code.
- **Structured logging only.** New code uses `mainLogger` (main) or `logService` (renderer); never `console.*`. The QW-15 startup warn uses `mainLogger.warn`.
- **Conventional Commits.** Allowed types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `chore`, `ci`, `merge`. Scope optional.
- **IPC contract test.** Any change that touches the `import:*` handlers must keep `tests/shared/types/preload-contract.test.ts` green.

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| QW-1 sanitizer regex breaks legitimate log lines (e.g. version strings that look like coords). | Snapshot test asserts both redaction and a known-good control line. | Revert the MainLogger call site; sanitizer hoist itself is safe to keep. |
| QW-11 FTS triggers needed mid-session by something other than the rebuild path. | Grep `createFTSTriggers` usages before deletion; existing session-end rebuild is the only confirmed consumer. | One-line revert in import-pipeline.ts. |
| QW-10 new index changes cohort query plan unexpectedly. | Capture `EXPLAIN QUERY PLAN` on the two hot cohort queries before/after; commit the comparison to the PR description. | Migration is `IF NOT EXISTS`; drop in a follow-up migration if needed. |
| QW-16 BRIN on small/sparse `variants` table degrades scans. | BRIN is `CREATE INDEX IF NOT EXISTS` and `pages_per_range` defaults to 128 — for the WGS volumes the audit targets this is conservative. Re-evaluate at next WGS perf snapshot. | Drop the BRIN index in a follow-up migration. |
| Mismatched-tag dry run for QW-3 is destructive (creates a draft release). | Run on a throwaway tag name (`vTEST-0.0.0`) on a feature branch; delete the draft. | None needed. |
| QW-7 path validation drops a legitimate import path (e.g. a custom mount outside home/userData/temp that the user picks via dialog). | Dialog-picked paths are always allow-listed via `addAllowedImportPath`, independent of root directory. The home/userData/temp roots are only the *bootstrap* allow-list for paths that bypass the dialog. | If an import flow surfaces that bypasses both, add its entry point to the dialog-allow-list call sites. |
| QW-7 worker-safe defensive check in `BedFilter.fromFile` rejects a legitimate symlinked path. | The defensive check resolves and checks for `..` after `path.resolve` — symlinks are followed by the filesystem layer, not by the check. | Loosen the check (e.g. drop the `..` rule, keep only the absolute-path requirement) and re-run the BedFilter test suite. |

## References

- `.planning/code-review/CODEBASE-AUDIT-2026-05-25.md` — master audit
- `.planning/artifacts/audit-2026-05-25/{01-performance,02-security,03-scalability,04-release-readiness,05-best-practices}.md` — specialist sub-audits
- `AGENTS.md` — branch / commit / logging / IPC contract rules
- `CLAUDE.md` — verification-before-claim rule (`make ci-full` is the canonical go/no-go)
- Memory: `feedback_cohort_parity.md`, `feedback_never_lower_thresholds.md`, `feedback_dry_principles.md`
