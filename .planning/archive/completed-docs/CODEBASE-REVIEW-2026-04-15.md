# VarLens Codebase Review

**Date:** 2026-04-15  
**Branch:** `main`  
**Scope:** Current local workspace, current planning docs, recent git history, targeted runtime verification, and current official stack guidance

## Executive Summary

VarLens is a credible, actively maintained Electron/Vue desktop application with stronger engineering fundamentals than most desktop data tools in its category. The codebase has good security defaults, a broad automated test surface, deliberate planning habits, and meaningful performance work already in place.

The main constraint is no longer "does this app have structure?" It does. The constraint is that several important boundaries are still too manual and SQLite-specific:

1. Renderer shell and IPC contract maintenance are costlier than they should be.
2. The current storage/query model is optimized for single-user local SQLite, not hosted PostgreSQL or WGS-scale workloads.
3. UX responsiveness is good but still limited by dense table rendering and hidden-view work.
4. Developer workflow is strong for one primary assistant and one local machine, but not yet standardized for Codex, Claude Code, and Gemini equally.

**Overall rating: 6.5/10**

This is a solid product codebase, not a rewrite candidate. The correct next move is a focused hardening and abstraction program.

## What I Verified

Local verification on the current tree:

- `npm run typecheck` passed
- `npm run test` passed: **220 files passed, 2 skipped; 2914 tests passed, 23 skipped**
- `npm run build` passed
- `npx playwright test tests/e2e/auto-update.e2e.ts --reporter=line` failed during Electron startup at `firstWindow()`

The Playwright failure does not prove a user-facing startup defect by itself, but it does mean the current E2E startup path is not trustworthy enough to serve as a fast regression signal.

## Scorecard

| Area | Rating | Notes |
|---|---:|---|
| Security / desktop boundary discipline | 8/10 | Strong Electron defaults and typed preload intent |
| Architecture | 7/10 | Good top-level split; renderer shell and IPC contract remain too manual |
| Maintainability | 6/10 | Planning and naming are solid, but state/contract drift still creates drag |
| Testability | 7/10 | Broad suite and runtime split are good; E2E trust and CI gating lag behind |
| UX / snappiness | 7/10 | Good perceived-speed primitives; dense tables remain the ceiling |
| PostgreSQL / hosted-backend generalizability | 3/10 | Heavy SQLite coupling across schema, workers, FTS, and execution model |
| WGS-scale readiness | 4/10 | Fine for local targeted datasets; not shaped for very large cohort growth |
| Dev workflow / LLM-readiness | 5/10 | Strong Claude-specific guidance, but cross-assistant standardization is incomplete |
| Overall | 6.5/10 | Strong desktop app foundation, incomplete platform-level hardening |

## Current Strengths

### 1. The desktop security posture is already strong

- Electron window creation uses `sandbox`, `contextIsolation`, and `nodeIntegration: false` in [src/main/index.ts](/home/bernt-popp/development/VarLens/src/main/index.ts:60).
- The preload layer exposes a channel-oriented API instead of dumping raw Electron primitives into the renderer in [src/preload/index.ts](/home/bernt-popp/development/VarLens/src/preload/index.ts:1).
- External URL handling is explicitly validated before opening.

That matches Electron guidance to expose narrow preload APIs through `contextBridge` instead of exposing broad IPC power directly.  
Source: Electron context isolation docs: https://www.electronjs.org/docs/latest/tutorial/context-isolation

### 2. The project has real engineering discipline

- There is a visible planning system in `.planning/` with specs, implementation plans, audits, and prior reviews.
- Git history shows steady investment in CI, release hardening, coverage, and post-release cleanup rather than only feature churn.
- The test surface is broad and intentionally split by environment in [vitest.config.ts](/home/bernt-popp/development/VarLens/vitest.config.ts:1).
- The repository also has unusually strong assistant-facing guidance in [CLAUDE.md](/home/bernt-popp/development/VarLens/CLAUDE.md:1) and [.planning/docs/UI-PATTERNS.md](/home/bernt-popp/development/VarLens/.planning/docs/UI-PATTERNS.md:1), which reduces avoidable design and workflow drift.

### 3. Performance work is already happening in the right places

- Work is offloaded to workers and a Piscina-backed read pool in [src/main/database/DbPool.ts](/home/bernt-popp/development/VarLens/src/main/database/DbPool.ts:1).
- The renderer uses server-side pagination and count/prefetch logic rather than naive client-side table loading in [src/renderer/src/composables/useOffsetPagination.ts](/home/bernt-popp/development/VarLens/src/renderer/src/composables/useOffsetPagination.ts:1).
- The app shell lazy-loads heavy UI pieces in [src/renderer/src/App.vue](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:99).

That is aligned with Electron guidance to avoid blocking the main process and Vue guidance to reduce expensive list rendering and unnecessary reactive work.  
Sources:
- https://www.electronjs.org/docs/latest/tutorial/performance
- https://vuejs.org/guide/best-practices/performance.html

## Main Findings

### 1. Renderer shell orchestration is the biggest maintainability hotspot

[src/renderer/src/App.vue](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:79) is carrying too much cross-cutting responsibility: routing, import flow reactions, database switching, layout, shell state, dialog ownership, keyboard shortcuts, and reset coordination.

This is not a cosmetic complaint. Root-shell complexity compounds quickly because every new feature tends to add one more watcher, one more reset path, and one more imperative callback.

**Impact**

- Higher cognitive load for changes that should stay local
- More fragile state transitions after import, case switch, database switch, and mode switch
- Slower onboarding for humans and assistants

### 2. IPC contract maintenance is broader and more manual than it should be

- The API surface is large in [src/shared/types/api.ts](/home/bernt-popp/development/VarLens/src/shared/types/api.ts:1).
- The preload implementation mirrors that contract manually in [src/preload/index.ts](/home/bernt-popp/development/VarLens/src/preload/index.ts:1).
- Main-side registration is centralized, but still mostly a long domain list in `src/main/ipc`.
- `wrapHandler` returns `T | SerializableError` in [src/main/ipc/errorHandler.ts](/home/bernt-popp/development/VarLens/src/main/ipc/errorHandler.ts:96), which pushes error-shape branching onto callers.

Electron’s own guidance is to expose one method per IPC message and keep that bridge narrow and explicit. VarLens follows that in spirit, but the implementation is now wide enough that contract drift and duplicated edits are real costs.  
Source: https://www.electronjs.org/docs/latest/tutorial/context-isolation

### 3. The current database model is strongly SQLite-native

The storage layer is well-structured for local SQLite, but not dialect-neutral:

- SQLite-specific connection and PRAGMA management in [src/main/database/DatabaseService.ts](/home/bernt-popp/development/VarLens/src/main/database/DatabaseService.ts:62)
- FTS trigger lifecycle in [src/main/database/VariantRepository.ts](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts:58)
- Worker-side file-oriented DB assumptions in [src/main/workers/worker-db.ts](/home/bernt-popp/development/VarLens/src/main/workers/worker-db.ts:1)
- Bulk flows that assume local control over WAL, triggers, `ANALYZE`, and rebuild phases

Kysely helps here because it supports both SQLite and PostgreSQL officially, but Kysely alone does not make raw SQL, FTS, PRAGMA, or worker semantics portable.  
Source: https://kysely.dev/

### 4. PostgreSQL and WGS-scale support would require architectural work, not a direct port

The current design is tuned for:

- single-user local file ownership
- synchronous `better-sqlite3` execution
- SQLite FTS5
- full-table summary rebuild jobs
- offset pagination and count-heavy list endpoints

That is acceptable for local targeted workflows, but weak for hosted backends and larger genomic workloads.

Specific pressure points:

- `ANALYZE`/FTS rebuild steps in [VariantRepository.ts](/home/bernt-popp/development/VarLens/src/main/database/VariantRepository.ts:165)
- import worker finalization and summary rebuild in [src/main/workers/import-worker.ts](/home/bernt-popp/development/VarLens/src/main/workers/import-worker.ts:250)
- cohort summaries built from full-table aggregate jobs in [src/shared/sql/cohort-summary-rebuild.ts](/home/bernt-popp/development/VarLens/src/shared/sql/cohort-summary-rebuild.ts:1)

For a PostgreSQL path, the right design would likely use:

- partitioning on large fact tables
- PostgreSQL text search with `tsvector` + GIN, or an external search index
- staging tables plus set-based ingest
- incremental/materialized cohort summaries
- keyset pagination on large lists

PostgreSQL’s own docs explicitly call out partitioning and indexed text search as core tools for large tables.  
Sources:
- https://www.postgresql.org/docs/current/ddl-partitioning.html
- https://www.postgresql.org/docs/current/textsearch-tables.html

### 5. UX/snappiness is good, but large table rendering is still the ceiling

Strengths:

- `keep-alive` is bounded in [App.vue](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:43)
- case/cohort data loading uses paginated fetches
- route-level and dialog-level lazy loading exists

Limits:

- `v-data-table-server` remains the core rendering primitive for both major data surfaces
- [src/renderer/src/components/VariantTable.vue](/home/bernt-popp/development/VarLens/src/renderer/src/components/VariantTable.vue:8) has many custom slots and repeated per-row view-model lookups
- [src/renderer/src/components/cohort/CohortDataTable.vue](/home/bernt-popp/development/VarLens/src/renderer/src/components/cohort/CohortDataTable.vue:8) carries similar density costs
- keyboard navigation uses smooth scrolling, which can feel sluggish during repeat navigation

Vue’s own performance guidance explicitly recommends virtualization for large lists and reducing reactivity overhead for large immutable structures.  
Source: https://vuejs.org/guide/best-practices/performance.html

### 6. Test coverage is broad, but CI trust is uneven

Good:

- `vitest.config.ts` is thoughtful about native-module constraints, environment split, and coverage configuration
- current local unit/integration suite passed cleanly

Gaps:

- E2E startup smoke is not currently reliable enough to be a fast confidence check
- main CI does not treat E2E as a first-class gate
- coverage thresholds exist, but coverage gating is not the same thing as PR-time trust

Vitest supports coverage as a first-class configuration surface, but thresholds only help when they are enforced in the right pipeline stage.  
Source: https://vitest.dev/guide/coverage.html

### 7. Cross-platform LLM workflow is not yet standardized

The repo is already friendly to AI-assisted development compared with most codebases, but it is still asymmetric:

- `CLAUDE.md` is strong
- there is no equivalent `AGENTS.md` or `GEMINI.md`
- the command surface is split across `README.md`, `Makefile`, scripts, and workflow docs
- some workflow descriptions drift from actual CI behavior

That means different assistants will infer different workflows, validation steps, and repo rules.

There is also a real environment-switching footgun around the native SQLite module. The repo already exposes both `npm run rebuild:node` and `npm run rebuild:electron`, and several docs/tests call that out, but that is still more friction than a fully uniform developer workflow should require.

## Recommendations

## Priority 1: Improve maintainability and development speed

### Status Update

- [x] Split app shell into focused composables
- [x] Assigned one state owner per renderer shell domain
- [x] Consolidated filter query-shaping ownership
- [x] Introduced domain-first IPC pattern for cases, database, and filter presets
- [ ] Roll the domain pattern across the remaining IPC modules
- [ ] Finish standardizing renderer-facing IPC error handling across remaining domains

1. Split the app shell.
   Move lifecycle orchestration out of [App.vue](/home/bernt-popp/development/VarLens/src/renderer/src/App.vue:79) into a small shell store plus focused composables for database switching, import completion, and mode transitions.

2. Make one owner per state domain.
   Stop spreading shell-level concerns across injected state, Pinia stores, and component refs unless there is a hard reason. Pick one authority for each of:
   - selected case / active mode
   - database lifecycle
   - import progress lifecycle
   - panel/dialog shell state

3. Collapse the IPC contract into domain modules with a single source of truth.
   Co-locate:
   - shared request/response types
   - preload binding
   - handler registration
   - renderer client wrappers

4. Standardize the error model.
   Prefer either:
   - promise rejection with typed error mapping at the client edge, or
   - a strict `Result<T, E>` envelope everywhere

   The current mixed `T | SerializableError` convention is workable but noisy.

5. Consolidate filter query-shaping ownership.
   There is already an explicit note in [src/shared/types/filters.ts](/home/bernt-popp/development/VarLens/src/shared/types/filters.ts:17) that shared filter types and renderer composables must stay in sync and should likely be consolidated. That should be treated as a real maintainability task, not just a comment.

Priority 1 execution note:
Cases, database, and filter preset IPC contracts now follow the shared `src/shared/ipc/domains/` plus preload/main domain-module layout. The remaining follow-on is to apply that same shape across the rest of `src/main/ipc/handlers` and finish the renderer-wide error-model cleanup.

## Priority 2: Prepare for hosted PostgreSQL and larger datasets

1. Introduce a dialect boundary now.
   Keep repository interfaces, but isolate SQLite-specific behavior:
   - PRAGMA management
   - FTS trigger maintenance
   - WAL/checkpoint behavior
   - `ANALYZE`/optimize routines
   - SQLite-specific raw SQL

2. Separate query intent from query execution details.
   The business layer should request:
   - variant search
   - cohort summary
   - shortlist ranking
   - export pipeline

   It should not care whether that is powered by SQLite FTS, PostgreSQL text search, or an external index.

3. Replace full rebuild thinking with incremental data products.
   For larger datasets, the current model of rebuilding summaries after import/delete is too expensive. Move toward:
   - staging tables
   - append/merge jobs
   - incremental summary maintenance
   - explicit background job states

4. Plan PostgreSQL as a second adapter, not a replacement.
   Keep SQLite as the offline/local backend. Add a hosted backend path for larger shared datasets and WGS-scale use cases.

## Priority 3: Improve snappiness

1. Add virtualization or row-windowing for the major tables.
   This is the single highest-ROI renderer performance change.

2. Precompute more row view models before render.
   Reduce repeated lookup work inside `VariantTable` slots.

3. Pause hidden work explicitly.
   The current `keep-alive` and `v-show` choices preserve state well, but hidden views should not continue expensive annotation or table-related work unnecessarily.

4. Make keyboard navigation scroll behavior adaptive.
   Use instant scroll for rapid repeat interactions, reserve smooth scroll for deliberate jumps.

## Priority 4: Improve testability and release confidence

1. Add a stable Electron startup smoke test and make it mandatory in CI.
   Playwright’s Electron support is intended exactly for this kind of app-level smoke coverage.  
   Source: https://playwright.dev/docs/api/class-electron

2. Add an explicit `test:e2e` script and a small deterministic smoke subset.

3. Align docs, scripts, Makefile targets, and CI names.
   One canonical local workflow should match one canonical CI workflow.

4. Add release guards:
   - tag version must match `package.json`
   - release policy for unsigned artifacts must be explicit
   - GitHub Actions should be pinned by SHA where practical

## Priority 5: Make the repo genuinely cross-assistant

1. Add `AGENTS.md` as the neutral, canonical automation contract.
2. Keep `CLAUDE.md`, but derive it from the same repo rules.
3. Add `GEMINI.md` only if it adds platform-specific instructions, not duplicate repo policy.
4. Expose canonical commands:
   - `npm run ci:full`
   - `npm run test:e2e`
   - `npm run test:smoke`
   - `npm run verify`
5. Document required validation order for native modules and Electron rebuilds in one place.

## Recommended 90-Day Direction

### Phase 1: Hardening

- Refactor `App.vue` shell responsibilities
- stabilize Playwright Electron smoke
- unify local/CI command surface
- standardize IPC error handling

### Phase 2: Boundary cleanup

- domain-split IPC contract
- remove manual contract drift between preload/shared/renderer
- isolate SQLite-specific storage behavior behind adapters

### Phase 3: Scale path

- prototype PostgreSQL adapter for a narrow slice
- move search strategy off SQLite-specific FTS assumptions
- design incremental cohort summaries and staged ingest for larger datasets

## Bottom Line

VarLens is already a good desktop genomics application codebase. It is not yet a broadly general backend platform.

If the goal is:

- **better maintainability and faster feature delivery**, focus on shell simplification and IPC contract consolidation
- **hosted PostgreSQL and WGS-scale growth**, invest in a storage abstraction and incremental data architecture now
- **better snappiness**, virtualize the large tables and reduce hidden/background renderer work
- **better testability and multi-assistant development**, make startup smoke tests and repo workflow contracts canonical

The foundation is strong enough to justify that investment. The biggest risk is not technical debt explosion; it is continuing to add features before the current boundaries are made cheaper to evolve.

## External References

- Electron performance: https://www.electronjs.org/docs/latest/tutorial/performance
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Vue performance best practices: https://vuejs.org/guide/best-practices/performance.html
- Playwright Electron API: https://playwright.dev/docs/api/class-electron
- Vitest coverage guide: https://vitest.dev/guide/coverage.html
- Kysely overview: https://kysely.dev/
- PostgreSQL partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL text search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
