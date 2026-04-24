# VarLens Codebase Review (Current)

**Date:** 2026-04-22  
**Branch:** `main`  
**Head:** `15f5dc2`  
**Baseline reviewed:** `.planning/archive/completed-docs/CODEBASE-REVIEW-2026-04-16.md`  
**Scope:** Current repository state after planning cleanup, workflow hardening, Electron fuse hardening, Mol* integration cleanup, recent type-safety fixes, and PostgreSQL storage-session parity work through Phase 7

## Update — 2026-04-23

**Current HEAD:** `b08d01a`  
**Shipped since this review was written:**

- **v0.56.6 released** (tag `v0.56.6`, 10 platform artifacts published). Addresses **Priority A** end-to-end via PR #169: `onlyLoadAppFromAsar: true` is flipped on all three platforms, fuse configuration is owned by `scripts/configure-fuses.mjs` with `strictlyRequireAllFuses: true` as a drift detector against Electron upgrades, a new Linux packaged-binary smoke (`tests/e2e/packaged-smoke.e2e.ts`) guards against fuse-caused boot regressions, and the baseline is documented in `AGENTS.md`.
- **Priority D resolved** in commit `a8a80fc` — `release/**` is now in the ESLint ignore list; a local `make dist` no longer poisons `make ci`.
- **Dependency hygiene pass** via PR #171: 8 dev-deps, 2 prod-deps, and `actions/download-artifact` in `docs.yml`/`release.yml` bumped together; lockfile regenerated under `.nvmrc`-pinned Node 24.14.1 so `npm ci` stays strictly consistent. Dependabot PRs #166, #167, #168, #170 closed.

**Now-open priorities** (unchanged from the original list):

- **Priority B** — pick the next renderer-performance phase from the perf harness, not from habit.
- **Priority C** — design a real storage adapter boundary before any Postgres work.
- **Priority E** — optional `package.json` script mirroring for discoverability.

**Not in scope of this update** (explicit follow-ups):

- macOS and Windows packaged-binary smoke tests.
- Tightening `GrantFileProtocolExtraPrivileges` — needs its own compatibility assessment before flipping.
- Moving the renderer off `file://` toward a custom protocol (Electron's longer-term hardening direction).
- Two open Dependabot CVEs nested inside `vitepress` (`vite`, `esbuild`); tracked in #154 pending a vitepress major upgrade.

## Update — 2026-04-24

**Current HEAD:** `15f5dc2`

**Shipped since the 2026-04-23 update:**

- **v0.56.11 released** (tag `v0.56.11`, 10 platform artifacts published). Includes PR #175: `cases:availableBuilds` now routes through the active `StorageSession` read executor, with SQLite pool/fallback coverage and a PostgreSQL implementation.
- The storage-session migration has progressed through Phase 5. `cases:list`, `cases:query`, and `cases:availableBuilds` are now the first cases-domain vertical slices behind the session/executor boundary.
- Phase 5 execution docs have been archived:
  - `.planning/archive/completed-plans/2026-04-24-storage-session-phase-5-cases-available-builds.md`
  - `.planning/archive/completed-specs/2026-04-24-storage-session-phase-5-cases-available-builds.md`
- **v0.56.13 released** (tag `v0.56.13`, release workflow `24906248599`, published 2026-04-24). Includes PR #177: PostgreSQL Parity Phase 7 variant read parity.
- Phase 7 is complete and archived:
  - `.planning/archive/completed-plans/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`
  - `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`
- Variant read parity now has a PostgreSQL-backed schema, seed data, read repository, storage-session routing, and gated Docker-backed E2E coverage for the Phase 7 slice.
- Phase 7 deliberately deferred PostgreSQL `variants:filterOptions` and `variants:columnMeta`; that deferral is recorded in `.planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md`.

**Priority C is now partially resolved as architecture and partially open as parity execution.** The storage-session boundary exists and has carried real cases and variants vertical slices, but PostgreSQL mode is still not ready for users. The fastest credible path remains:

1. close the remaining read-side gaps by domain,
2. introduce backend-aware write/import/export/delete/rebuild execution,
3. add Docker-backed PostgreSQL integration tests once schema coverage is stable,
4. only then expose renderer storage settings.

**Planning state to reconcile next:**

- Phase 6 case metadata/cases-filter docs are still active/proposed under `.planning/plans` and `.planning/specs`.
- Phase 7 variant read parity has already shipped and is archived.
- The next PostgreSQL step should either execute Phase 6 next or intentionally rewrite/archive it if the implementation order has superseded it. Do not open a Phase 8 plan until this Phase 6 status is resolved.

**Still not ready for user-facing PostgreSQL mode:**

- import/export/delete/rebuild workers are still SQLite-file-backed,
- `database:overview` is still SQLite-path logic,
- variant read parity exists, but variant filter metadata, cohort, tag, annotation, transcript, gene-list, region-file, panel, analysis-group, auth, comments/metrics, audit, and preset parity remain incomplete,
- lifecycle UX is still local-file-centric.

## Executive Summary

The 2026-04-16 review is now fully superseded.

The codebase is in a materially better state than that review described:

1. The IPC domain rollout is effectively complete for the active app-facing surface.
2. `AGENTS.md` is now the canonical agent contract and matches the real repo workflow.
3. GitHub Actions are SHA-pinned, startup smoke is a real CI gate, and release publishing is tied to a previously green build on the exact tagged SHA.
4. The Electron security baseline is stronger: key fuses are now checked in, and the old fragile pdbe-molstar public-script packaging path is gone.
5. The planning tree has been cleaned up enough that stale live plans/specs are no longer the main source of confusion.

**Updated overall rating: 8.4 / 10**

VarLens is now a well-structured Electron desktop app with credible local-security defaults, a strong typed IPC boundary, solid CI/release discipline, and much better repo hygiene than the prior reviews captured. The remaining work is narrower and more strategic: PostgreSQL parity execution on top of the storage-session boundary, the next renderer-performance phase, packaged-app integrity follow-through beyond Linux smoke, and small local workflow rough edges.

## Method

This review uses the current tree and recent git history as the source of truth, then treats `.planning/` documents as historical context only where they still match shipped code.

That distinction mattered in this pass. The remaining live plan/spec docs had become reference-only, so they were archived:

- `.planning/archive/completed-plans/2026-04-11-post-0.56.0-cleanup-plan.md`
- `.planning/archive/completed-specs/2026-04-11-post-0.56.0-cleanup-design.md`
- `.planning/archive/completed-plans/2026-04-15-performance-measurement-and-renderer-tables-phase1-plan.md`
- `.planning/archive/completed-specs/2026-04-15-performance-measurement-and-renderer-tables-design.md`

At this point, today's review is the live code-review snapshot. The active planning set is small but not empty: Phase 6 case metadata/cases-filter docs and the storage-session boundary design remain active, while Phase 7 has been completed and archived.

## Current Strengths

### 1. Desktop security posture remains strong

- `src/main/index.ts` still enforces `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- `src/preload/index.ts` exposes a typed `window.api` surface instead of broad Electron primitives.
- External URL opens still flow through validation before `shell.openExternal`.

This remains aligned with Electron's core guidance for isolating the renderer and minimizing IPC exposure.  
Sources:
- https://www.electronjs.org/docs/latest/tutorial/context-isolation
- https://www.electronjs.org/docs/latest/tutorial/security

### 2. IPC architecture is now a real strength

- `src/main/ipc/index.ts` is organized around domain modules for the active IPC surface.
- Corresponding shared, preload, and main domain modules exist under:
  - `src/shared/ipc/domains/`
  - `src/preload/domains/`
  - `src/main/ipc/domains/`
- Per-domain tests exist under `tests/shared/ipc/domains/`.

The remaining cleanup here is legacy type-shape consolidation, not missing architecture.

### 3. CI and release gates are credible

- `.github/workflows/build.yml` runs Linux startup smoke against the built Electron app.
- `.github/workflows/release.yml` refuses to publish unless `build.yml` passed on the exact tagged SHA.
- Workflow actions are now pinned to immutable full commit SHAs with readable tag comments.

That combination gives the repo real startup verification and better CI supply-chain discipline.

### 4. Agent and contributor guidance is now trustworthy

- `AGENTS.md` is canonical and repo-specific.
- The command surface is clearly centered on `Makefile`.
- The guidance now matches the actual stack, IPC shape, fuse posture, and verification flow.

This is no longer a repo where future agents need to rediscover the real workflow by trial and error.

### 5. The Mol* integration is substantially safer and less fragile

- The renderer no longer depends on a copied public pdbe-molstar script.
- The viewer runtime is loaded through the normal Vite asset graph.
- The old renderer-side `asarUnpack` exception for the viewer bundle is gone.

That is a meaningful packaging and security improvement, and it also removes one of the most plausible explanations for the unexplained Windows instability around the old integration.

### 6. Planning hygiene is much better

- older code reviews are archived
- finished cleanup/perf plan+spec docs are archived
- user-facing docs and repo-facing docs were synchronized with the current codebase

The planning tree is now much less likely to send a future reviewer down an already-finished path.

## Findings

### Resolved: planning-status drift is no longer a top problem

This was the right cleanup priority earlier in the day, and it has now been handled well enough that it should drop out of the active risk list.

The remaining rule should be simple:

- keep code reviews as dated snapshots
- archive finished plans/specs promptly
- only leave docs in `.planning/plans` or `.planning/specs` when someone is actually maintaining them as live working documents

That rule is now also easier to enforce because the live planning set has been reduced to zero active plans/specs rather than a handful of stale reference docs.

### Resolved: GitHub Actions SHA pinning has landed

This was a valid gap at the start of the review pass, but it is no longer an open finding.

The workflows now use immutable full-SHA action refs with same-line tag comments that keep Dependabot updates maintainable. That aligns with GitHub's hardening guidance and materially lowers the supply-chain risk of CI drift.

The standing policy should remain:

- require full-SHA pins for new external actions
- keep the human-readable tag comment
- let Dependabot handle normal ref refreshes

Sources:
- https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/github/administering-a-repository/keeping-your-actions-up-to-date-with-github-dependabot

### ✅ Fully resolved (2026-04-23, v0.56.6, PR #169): Electron fuse hardening

Originally filed as "resolved in part" — the remaining step was flipping `onlyLoadAppFromAsar`. That shipped with PR #169 along with the broader hardening:

- `onlyLoadAppFromAsar: true` flipped on all three platforms.
- Fuse configuration moved from the declarative `build.electronFuses` in `package.json` into `scripts/configure-fuses.mjs` (an `afterPack` hook) which calls `context.packager.addElectronFuses(...)` with `strictlyRequireAllFuses: true`. Electron upgrades that introduce new fuses now fail the build until the baseline declares them.
- Baseline documented in `AGENTS.md` under "Electron fuse baseline".
- `tests/e2e/packaged-smoke.e2e.ts` launches `release/linux-unpacked/varlens` directly (via `child_process.spawn` — Playwright's `_electron.launch` is blocked by the `EnableNodeCliInspectArguments: false` fuse because it injects `--inspect=0`) and asserts the `IPC handlers registered` log line. Wired into `make ci-packaged-smoke-linux`, `make ci-full`, and `build.yml`.

Sources:
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electron.build/tutorials/adding-electron-fuses.html

### ✅ Resolved (commit `a8a80fc`): Local verification is now hermetic to packaged artifacts

`eslint.config.js` was updated to ignore `release/**` in addition to `out/**`, `dist/**`, `.planning/**`, and `docs/**`. A local `make dist` can now run without poisoning subsequent `make ci` / `make lint` invocations.

### Medium: Data-layer portability remains the main strategic architecture gap

The core long-term conclusion from earlier reviews still holds.

- `DatabaseService` remains SQLite-native.
- `VariantRepository` still owns SQLite-specific FTS behavior.
- worker assumptions still target local encrypted SQLite files.
- Kysely is still being used for typed SQL help, not as a real dialect boundary.

There has been useful prep work:

- FTS trigger lifecycle management is more isolated
- incremental cohort-summary SQL exists

That conclusion now needs a narrower wording. A true storage-session boundary does exist, and PostgreSQL vertical slices have shipped through cases and variants reads. What still does not exist is complete backend parity: writes, imports, exports, deletes, summary rebuilds, overview/lifecycle UX, and most non-variant domains are still SQLite-oriented. VarLens is operationally stronger now, but it is still not prepared for a user-facing hosted-Postgres mode or much larger-scale data growth without continued parity work.

Sources:
- https://kysely.dev/docs/dialects
- https://www.postgresql.org/docs/current/ddl-partitioning.html
- https://www.postgresql.org/docs/current/textsearch-tables.html

### Medium: Renderer Phase 2 should still be chosen from evidence, not habit

The previous overcorrection toward “virtualization next” is still not justified as a default conclusion.

Phase 1 measurement and first-pass responsiveness work landed. That is enough to make the next decision disciplined rather than speculative, but not enough to pre-commit the answer.

The correct next move is still:

1. start from the current perf harness and latest measurements
2. identify the highest remaining cost centers
3. then choose among:
   - further row-cost reduction
   - hidden-work suppression
   - selective virtualization
   - table primitive replacement

Virtualization remains an option, not a predetermined plan.

Sources:
- https://vuejs.org/guide/best-practices/performance
- https://www.electronjs.org/docs/latest/tutorial/performance

### Low: npm-script discoverability still lags the Makefile

The Makefile is correctly the source of truth, but `package.json` still does not mirror a few high-value entry points that some contributors and tools will look for first.

This is a small ergonomics issue, not a structural one. It is only worth doing if it can be done without diluting the rule that `make` is canonical.

### Resolved: recent `stream-json` typecheck breakage is fixed

The node-side typecheck failure caused by unresolved `stream-json` typings is no longer an active issue. Local declarations and callback typing cleanup were added, and direct node-side `tsc` now passes again.

That matters because it removes a misleading source of “repo instability” that was really just a narrow typing gap in the import pipeline.

## Updated Scorecard

| Area | 2026-04-16 | 2026-04-22 | 2026-04-23 | 2026-04-24 | Notes |
|---|---:|---:|---:|---:|---|
| Security / desktop boundary | 8.0 | 8.3 | 8.7 | 8.7 | `onlyLoadAppFromAsar` flipped; strict-require drift detector live; packaged-binary smoke on Linux |
| Architecture | 7.5 | 8.1 | 8.1 | 8.4 | Storage-session boundary is now carrying real PostgreSQL vertical slices |
| Maintainability | 7.5 | 8.3 | 8.4 | 8.5 | Phase docs are mostly archived promptly; Phase 6 status still needs reconciliation |
| Testability / CI trust | 7.5 | 8.4 | 8.6 | 8.7 | Release gate verified on exact tagged SHA; Phase 7 added Docker-backed PostgreSQL E2E coverage |
| UX / snappiness | 7.0 | 7.2 | 7.2 | 7.2 | Unchanged — Priority B still open |
| PostgreSQL / hosted backend readiness | 3.0 | 3.3 | 3.3 | 4.2 | Cases and variant read slices exist; writes/import/export/delete/rebuild and many domains remain open |
| Supply chain / CI posture | 7.0 | 8.0 | 8.2 | 8.2 | No material change after dependency batch |
| WGS-scale readiness | 4.0 | 4.0 | 4.0 | 4.5 | Variant read schema/query slice improves read readiness, but import/scale path remains open |
| Dev workflow / agent-readiness | 7.0 | 8.5 | 8.5 | 8.6 | Agent plan/archive discipline improved; active Phase 6 status needs cleanup |
| **Overall** | **7.0** | **8.0** | **8.3** | **8.4** | Priority A + D shipped; C is now in parity execution; B and E remain open |

## Revised Priorities

### Priority A — Finish packaged-app integrity hardening — ✅ Resolved (0.56.6, PR #169)

- `onlyLoadAppFromAsar: true` is now flipped on all three platforms.
- Fuse configuration moved to `scripts/configure-fuses.mjs` (afterPack hook) with `strictlyRequireAllFuses: true` — Electron upgrades that add a fuse now fail the build until the baseline declares it.
- Baseline documented in `AGENTS.md` "Electron fuse baseline" subsection.
- New Linux packaged-binary smoke test (`tests/e2e/packaged-smoke.e2e.ts`) catches boot regressions caused by fuse flipping; wired into `make ci-packaged-smoke-linux`, `make ci-full`, and `.github/workflows/build.yml`.
- Not in scope: macOS/Windows packaged-binary smoke, tightening `GrantFileProtocolExtraPrivileges`, or long-term move off `file://` — each tracked as a separate follow-up.

### Priority B — Decide the next renderer-performance phase from measurements

- use the current perf harness as the entry point
- choose the next renderer move from actual bottlenecks, not generic frontend advice

### Priority C — Continue PostgreSQL parity on the storage-session boundary — 🟡 Partially resolved

- storage-session/read-executor architecture exists and has shipped through cases and variant read slices
- keep Kysely as a tool inside backend-specific repositories, not the boundary itself
- next reconcile the still-active Phase 6 case metadata/cases-filter docs, then close that parity gap or explicitly supersede/archive the docs
- do not expose renderer PostgreSQL settings until write/import/export/delete/rebuild and remaining major read domains are honest

### Priority D — Make local verification hermetic — ✅ Resolved (commit `a8a80fc`)

- `release/**` is in `eslint.config.js` ignore list; a local `make dist` no longer poisons subsequent `make ci` runs.

### Priority E — Optional command-surface mirroring

- mirror a few high-value `make` targets into `package.json` only if it improves discoverability without weakening the “Makefile is canonical” rule

## Bottom Line

**As of 2026-04-24**, packaged-app integrity hardening and local-verification hermeticity have shipped, and PostgreSQL parity has moved from architecture-only work into real vertical slices through v0.56.13. The remaining work is genuinely strategic:

- **B** — choose the next renderer-performance phase from evidence, using the current perf harness as the entry point.
- **C** — continue PostgreSQL parity on the storage-session boundary, starting by reconciling or executing the still-active Phase 6 case metadata/cases-filter docs.
- **E** — optional `package.json` script mirroring for discoverability.

VarLens is no longer primarily paying down shell chaos, IPC sprawl, stale planning drift, packaged-app hardening, or local-verification friction. The next review should start from whichever of B or C gets picked up, but the immediate planning cleanup is to resolve the Phase 6 document state before opening new PostgreSQL phases.

## External References

- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-builder fuse configuration: https://www.electron.build/tutorials/adding-electron-fuses.html
- Electron performance guide: https://www.electronjs.org/docs/latest/tutorial/performance
- Vue performance guide: https://vuejs.org/guide/best-practices/performance
- Playwright Electron docs: https://playwright.dev/docs/api/class-electronapplication
- GitHub Actions security hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- Kysely dialects: https://kysely.dev/docs/dialects
- PostgreSQL partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL text search tables and indexes: https://www.postgresql.org/docs/current/textsearch-tables.html
