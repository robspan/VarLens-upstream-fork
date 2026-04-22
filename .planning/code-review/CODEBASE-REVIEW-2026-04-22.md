# VarLens Codebase Review (Current)

**Date:** 2026-04-22  
**Branch:** `main`  
**Head:** `f937c07`  
**Baseline reviewed:** `.planning/code-review/CODEBASE-REVIEW-2026-04-16.md`  
**Scope:** Current repository state, recent git history after 2026-04-16, active `.planning/plans` and `.planning/specs`, maintainability artifacts, and current official guidance for Electron, Vue, Playwright, GitHub Actions, and Kysely

## Executive Summary

The 2026-04-16 review is now materially stale in three important ways:

1. The IPC domain rollout is no longer "scaffolded for 3 of 30 handlers." It is effectively complete for the application-facing surface, with `src/shared/ipc/domains/*`, `src/preload/domains/*`, and `src/main/ipc/domains/*` present across the active domains, plus per-domain tests under `tests/shared/ipc/domains/`.
2. The repo is no longer Claude-only from an agent-contract perspective. `AGENTS.md` is now the canonical cross-agent contract and `CLAUDE.md` is a thin overlay that imports it.
3. The startup-smoke / CI-trust problem is no longer a primary weakness. Linux startup smoke is a real CI gate, and `release.yml` refuses to publish a tag whose exact SHA did not pass `build.yml`.

That means the current codebase is stronger than the 2026-04-16 score implied. The review should now focus less on organization-level cleanup that has already landed, and more on the remaining structural bets:

- SQLite-native storage and worker assumptions
- renderer table performance ceilings after Phase 1
- workflow supply-chain hardening in GitHub Actions
- Electron fuse auditing and packaged-app integrity posture
- planning-document status drift versus current code and git history

**Updated overall rating: 7.5 / 10**

VarLens is now a well-structured Electron desktop application with strong local-security defaults, a credible typed IPC boundary, real CI gates, and unusually good agent-facing repo discipline. It is not blocked by shell or IPC chaos anymore. Its main limitations are scale strategy, data-layer portability, and a few remaining workflow hardening tasks more than broad documentation drift.

## Method

This review used the current working tree as the source of truth, then checked recent git history and planning artifacts to determine whether prior review findings were still current.

That mattered here because several `.planning/plans` and `.planning/specs` had drifted away from the shipped code. After the cleanup in this review pass, most prior code-review snapshots and completed planning docs are archived, the remaining live planning docs carry explicit 2026-04-22 status banners, and the obvious version/framework mismatches in `AGENTS.md`, `README.md`, and the VitePress intro/overview pages were corrected. The general rule still holds: **current source + git history are more reliable than checkbox state in planning files unless someone is actively maintaining those markers**.

## Current Strengths

### 1. Desktop security posture remains strong

- `src/main/index.ts` keeps `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- `src/preload/index.ts` exposes a narrow typed `window.api` surface instead of raw Electron primitives.
- External URL access still flows through validated shell handlers.

This remains aligned with Electron's guidance to keep context isolation enabled and expose one preload method per IPC capability rather than broad raw IPC access.  
Sources:
- https://www.electronjs.org/docs/latest/tutorial/context-isolation
- https://www.electronjs.org/docs/latest/tutorial/security

### 2. IPC architecture is now a real strength, not an active weakness

- `src/main/ipc/index.ts` registers domain modules for the active app-facing IPC surface and keeps only a narrow legacy set for `shell`, `shortlist`, `system`, and `updater`.
- The corresponding domain triples exist under:
  - `src/shared/ipc/domains/`
  - `src/preload/domains/`
  - `src/main/ipc/domains/`
- Per-domain tests exist under `tests/shared/ipc/domains/`.
- `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md` now explicitly records the rollout as complete on 2026-04-17 and retires the circuit-breaker.

The remaining follow-up here is mostly type-shape cleanup in `src/shared/types/api.ts`, not a missing architectural pattern.

### 3. CI and release gates are substantially better than the prior review captured

- `.github/workflows/build.yml` runs Linux startup smoke against the built Electron app.
- `.github/workflows/release.yml` blocks release unless `build.yml` passed on the tagged SHA.
- `Makefile` exposes `ci`, `ci-full`, and `ci-startup-smoke` as a coherent command surface.

This is a meaningful maturity jump. The current CI posture is no longer "good unit tests but weak end-to-end trust." It now has a real startup gate and a release guard.

### 4. Cross-agent repo guidance is now canonical and credible

- `AGENTS.md` is present and correctly repo-specific.
- `CLAUDE.md` imports `AGENTS.md` and limits itself to Claude-harness behavior.
- The content is grounded in actual repo quirks: dual native-module rebuilds, canonical `make` targets, typed IPC rules, logging rules, UI traps, and `.planning/` conventions.

This is now one of the better multi-agent repo contracts I have seen in an Electron application.

### 5. Documentation drift is much lower after the current cleanup pass

- completed review snapshots and completed 2026-04-10 specs are archived
- the remaining live planning docs are explicitly marked as partial/reference status
- `AGENTS.md` now reflects the current IPC rollout state
- `README.md` and the VitePress intro/overview pages now match the current runtime and framework stack

The repo is in a noticeably better state for picking the next engineering phase than it was before this pass.

## Findings

### Resolved: Planning cleanup was the immediate next step, and it is now mostly done

The biggest documentation problem was no longer missing standards. It was **status drift inside `.planning/`**.

Examples:

- `.planning/specs/2026-04-11-post-0.56.0-cleanup-design.md` still says "Design approved, pending plan", but major parts of that work clearly shipped:
  - explicit Apple-Silicon-only macOS targets in `package.json`
  - installation docs updated in `docs/guide/installation.md`
  - coverage thresholds restored in `vitest.config.ts`
  - workflow action major-version bumps in `.github/workflows/*.yml`
  - the scoring vision doc under `.planning/docs/`
- `.planning/plans/2026-04-15-performance-measurement-and-renderer-tables-phase1-plan.md` still reads like an active execution plan, but the harness, perf snapshot plumbing, comparison script, and Linux startup-smoke gate already exist in the codebase.

This was a practical planning problem, not just a documentation nit. Future reviewers or agents could spend time re-triaging already-completed work, misclassifying shipped work as pending, or planning "next phases" on top of stale status markers.

As of this review pass, that cleanup has been substantially improved:

- completed 2026-04-10 planning docs were archived
- prior 2026-04-15 and 2026-04-16 review snapshots were archived
- the remaining live cleanup/perf docs now carry explicit 2026-04-22 status banners
- the active planning set is reduced to the genuinely still-useful reference docs
- the stale IPC/version/framework wording in `AGENTS.md`, `README.md`, and VitePress overview pages was corrected

**Current guidance**

- Review the active `.planning/specs` and `.planning/plans` first, before choosing the next substantive engineering phase.
- Archive completed plans/specs promptly, or add a dated status banner at the top when archival is deferred.
- Mark remaining live docs explicitly as `completed`, `partially landed`, or `superseded` where applicable.
- Treat code review docs as snapshots and planning docs as living docs only if someone is actually maintaining the status markers.

### Medium: The 2026-04-16 review overstates virtualization as the default next move

The prior review's "Priority B" recommendation leaned too hard toward virtualization as the obvious next renderer step.

That is not fully supported by this repo's own evidence:

- `.planning/specs/2026-04-15-performance-measurement-and-renderer-tables-design.md` explicitly says Phase 1 should optimize the current architecture first.
- `.planning/archive/completed-specs/2026-03-25-performance-optimization-design.md` records concrete problems with direct `v-data-table-virtual` use on wide tables.
- The current tables are still wide, slot-heavy, and server-paginated rather than unbounded client lists.

Vue's guidance does support virtualization for large lists, but that is a general recommendation. For VarLens specifically, the review should not lock in the next renderer phase yet. The right sequencing is:

1. clean up planning status
2. review the current perf evidence
3. then decide whether the next renderer phase is row-cost reduction, hidden-work suppression, selective virtualization, or something else

**Recommendation**

- Keep virtualization as an option, not as the default prescription.
- Require new perf evidence against the current harness before choosing between:
  - further row-cost reduction
  - hidden-work suppression
  - selective virtualization
  - table-primitive replacement

Sources:
- https://vuejs.org/guide/best-practices/performance
- https://www.electronjs.org/docs/latest/tutorial/performance

### Updated: GitHub Actions SHA pinning has landed, but it should remain an enforced maintenance rule

This gap was real at the start of the review pass, and it has now been substantially reduced.

The repository's workflow actions are now pinned to full commit SHAs across `build.yml`, `release.yml`, and `docs.yml`, with same-line human-readable tag comments for maintainability and Dependabot compatibility. That materially improves the immutability of the CI supply chain and aligns the repo with GitHub's current guidance.

The remaining risk is now less about today's workflow state and more about **future regressions**:

- new workflow steps could slip back to floating tags
- maintainers could remove the tag comments that make Dependabot updates clean
- the repo still relies on periodic review to ensure newly added third-party actions get the same treatment

That maintenance path is now documented in both `AGENTS.md` and `.github/dependabot.yml`, which is the right long-term shape for this repository.

This is not just abstract hygiene. 2025 supply-chain incidents such as the `tj-actions/changed-files` compromise materially raised the cost of floating-tag dependencies in CI, and full-length SHA pinning is the concrete control GitHub recommends for immutable action references.

**Recommendation**

- Keep workflow actions SHA-pinned as an ongoing repo policy, not a one-time cleanup.
- Require `uses: owner/repo@<full-sha> # owner/repo@vX.Y.Z` for any new external action.
- Let Dependabot own normal action-version refreshes; review humans should only need to check the resulting diff and upstream changelog.

Source:
- https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/github/administering-a-repository/keeping-your-actions-up-to-date-with-github-dependabot
- https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories

### Medium: Electron fuse posture should now be audited explicitly

The current review and `AGENTS.md` correctly emphasize Electron runtime defaults such as:

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

But the repo does not yet document or verify the packaged-build **fuse** configuration in the same explicit way.

That matters more now than it did in earlier reviews because newer Electron security guidance and 2025 research increased the importance of fuse-level hardening for packaged apps. At minimum, this should be an explicit audit item rather than an implicit assumption.

**Recommendation**

- inspect the current packaged build's fuse state
- move the chosen fuse configuration into a reproducible checked-in configuration path
- document the expected fuse set alongside the other Electron security defaults

Sources:
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electron.build/tutorials/adding-electron-fuses.html

### Medium: Local verification is brittle when packaged artifacts are present

The repo's canonical gate is `make ci`, but local verification is not fully hermetic today.

During this review, `make ci` failed in `lint:check` because ESLint traversed generated files under `release/linux-unpacked/resources/app.asar.unpacked/...`. The current ignore list in `eslint.config.js` excludes `out/**`, `dist/**`, `.planning/**`, `docs/**`, and `src/renderer/public/**`, but not `release/**`.

That means a perfectly valid local packaging run can poison later lint runs unless the build output is cleaned manually. For a repo that explicitly treats the Makefile as the source of truth, that is a workflow-quality issue worth fixing.

**Recommendation**

- ignore `release/**` in ESLint unless there is a deliberate reason to lint packaged output
- keep canonical verification commands resilient to expected generated artifacts
- if packaged-output linting is desired, move it into a separate explicit target instead of contaminating `make ci`

### Medium: Data-layer portability remains the main strategic architectural gap

Nothing in the current codebase changes the basic conclusion from the earlier reviews:

- `DatabaseService` is still SQLite-native.
- `VariantRepository` still owns SQLite-specific FTS and rebuild behavior.
- workers still assume local file-backed encrypted SQLite.
- summary rebuild flows still assume full local control over the storage engine.

Kysely is present, but still not acting as a dialect boundary. Its role remains closer to typed SQL assistance than portability infrastructure.

There has been some small real movement here that should be acknowledged:

- FTS trigger lifecycle has been extracted into its own management module
- incremental cohort-summary SQL exists instead of everything being expressed only as full rebuilds

Those are useful preparatory steps, but they are still preparatory. They do not change the headline conclusion that the adapter boundary is absent and the runtime behavior remains SQLite-native.

So the repo is substantially healthier operationally, but it is still **not prepared for hosted Postgres or WGS-scale growth without deliberate architecture work**.

This remains the most important long-term technical limitation.

Sources:
- https://kysely.dev/docs/dialects
- https://www.postgresql.org/docs/current/ddl-partitioning.html
- https://www.postgresql.org/docs/current/textsearch-tables.html

### Low: npm script discoverability still lags the Makefile

The repo now has a strong canonical command surface in `Makefile`, and `AGENTS.md` documents that correctly.

But `package.json` still does not mirror a few high-value entry points such as:

- `test:e2e`
- `test:smoke`
- `verify`
- `ci:full`

This is a mild ergonomics problem, not a structural problem. It mainly affects contributors or tools that look at `package.json` first and never inspect the Makefile.

## Updated Scorecard

| Area | 2026-04-16 | 2026-04-22 | Notes |
|---|---:|---:|---|
| Security / desktop boundary | 8.0 | 7.8 | Strong defaults remain; fuse posture now deserves explicit audit |
| Architecture | 7.5 | 8.0 | IPC/domain structure is now materially stronger |
| Maintainability | 7.5 | 8.0 | Biggest remaining issue is planning status drift, not shell/IPC sprawl |
| Testability / CI trust | 7.5 | 8.2 | Startup smoke and release gating are now first-class |
| UX / snappiness | 7.0 | 7.1 | Phase 1 harness is real; next steps still require evidence |
| PostgreSQL / hosted backend readiness | 3.0 | 3.3 | Small prep work landed; adapter boundary still absent |
| Supply chain / CI posture | 7.0 | 6.5 | CI gates improved, but floating action tags are now a more serious risk |
| WGS-scale readiness | 4.0 | 4.0 | No meaningful change |
| Dev workflow / agent-readiness | 7.0 | 8.1 | `AGENTS.md` is strong; Makefile is canonical; planning status drift holds this back |
| **Overall** | **7.0** | **7.5** | Earlier organizational weaknesses are mostly retired; security hardening bar is higher now |

## Revised Priorities

### Priority A — Clean up `.planning/` first

This is the highest-ROI documentation task now.

- archive completed plans/specs
- add explicit "completed / superseded / partially landed" headers where archival is deferred
- stop leaving active-phase checklists in the live planning directories after the code has already shipped

### Priority B — Decide the next perf phase only after cleanup

Do not prematurely lock in a virtualization migration or any other specific renderer strategy.

Use the existing harness to decide the next renderer move based on measured bottlenecks in:

- `startup-shell`
- `case-select-visible-rows`
- `cohort-toggle`
- `keyboard-nav-burst`

### Priority C — Introduce a real storage adapter boundary before any Postgres work

This remains the key strategic architecture task.

The right move is still:

- isolate SQLite-specific behavior
- define repository/adapter boundaries around variant queries and rebuild jobs
- keep Kysely as a tool inside the boundary, not the boundary itself

### Priority D — Harden workflow supply chain

- pin critical GitHub Actions to full commit SHAs
- keep least-privilege `GITHUB_TOKEN` permissions
- review third-party actions periodically

### Priority E — Audit and document Electron fuses

- inspect the current packaged fuse state
- check the configuration into the repo in a reproducible form
- document the intended fuse posture next to the other Electron security defaults

### Priority F — Optional command-surface mirroring

Mirror a few high-value `make` targets into `package.json` for discoverability, but do not split the source of truth. The Makefile should stay canonical.

## Bottom Line

The right update to the codebase story is:

VarLens is no longer a good desktop app that is still paying off shell and IPC structure debt. That debt has largely been paid down. The repo is now in the healthier phase where the most important remaining issues are:

- strategic data-layer design
- renderer ceilings after Phase 1
- workflow hardening
- documentation/status accuracy

That is a much better place to be.

The prior reviews were directionally useful, but the latest one needs to be superseded because it no longer reflects the current tree.

## External References

- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-builder fuse configuration: https://www.electron.build/tutorials/adding-electron-fuses.html
- Electron performance guide: https://www.electronjs.org/docs/latest/tutorial/performance
- Vue performance guide: https://vuejs.org/guide/best-practices/performance
- Playwright Electron docs: https://playwright.dev/docs/api/class-electronapplication
- GitHub Actions security hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- CISA alert on `tj-actions/changed-files`: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- Kysely dialects: https://kysely.dev/docs/dialects
- PostgreSQL partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL text search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
- OpenAI Codex planning guidance: https://cookbook.openai.com/articles/codex_exec_plans/
