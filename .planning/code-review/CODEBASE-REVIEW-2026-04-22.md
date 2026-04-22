# VarLens Codebase Review (Current)

**Date:** 2026-04-22  
**Branch:** `main`  
**Head:** `1449c74`  
**Baseline reviewed:** `.planning/archive/completed-docs/CODEBASE-REVIEW-2026-04-16.md`  
**Scope:** Current repository state after planning cleanup, workflow hardening, initial Electron fuse hardening, Mol* integration cleanup, and recent type-safety fixes

## Executive Summary

The 2026-04-16 review is now fully superseded.

The codebase is in a materially better state than that review described:

1. The IPC domain rollout is effectively complete for the active app-facing surface.
2. `AGENTS.md` is now the canonical agent contract and matches the real repo workflow.
3. GitHub Actions are SHA-pinned, startup smoke is a real CI gate, and release publishing is tied to a previously green build on the exact tagged SHA.
4. The Electron security baseline is stronger: key fuses are now checked in, and the old fragile pdbe-molstar public-script packaging path is gone.
5. The planning tree has been cleaned up enough that stale live plans/specs are no longer the main source of confusion.

**Updated overall rating: 8.0 / 10**

VarLens is now a well-structured Electron desktop app with credible local-security defaults, a strong typed IPC boundary, solid CI/release discipline, and much better repo hygiene than the prior reviews captured. The remaining work is narrower and more strategic: storage-boundary design, the next renderer-performance phase, packaged-app integrity follow-through, and small local workflow rough edges.

## Method

This review uses the current tree and recent git history as the source of truth, then treats `.planning/` documents as historical context only where they still match shipped code.

That distinction mattered in this pass. The remaining live plan/spec docs had become reference-only, so they were archived:

- `.planning/archive/completed-plans/2026-04-11-post-0.56.0-cleanup-plan.md`
- `.planning/archive/completed-specs/2026-04-11-post-0.56.0-cleanup-design.md`
- `.planning/archive/completed-plans/2026-04-15-performance-measurement-and-renderer-tables-phase1-plan.md`
- `.planning/archive/completed-specs/2026-04-15-performance-measurement-and-renderer-tables-design.md`

At this point, today's review is the only live code-review snapshot, and there are no active execution plans/specs left in `.planning/plans` or `.planning/specs` until the next real phase is intentionally opened.

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

### Resolved in part: Electron fuse hardening has started, but packaged-app integrity still has one obvious next step

This is no longer an “audit missing” problem. The repo now has a checked-in initial fuse baseline in `package.json`:

- `runAsNode: false`
- `enableNodeOptionsEnvironmentVariable: false`
- `enableNodeCliInspectArguments: false`
- `enableCookieEncryption: true`
- `enableEmbeddedAsarIntegrityValidation: true`

That is real progress. The next step is now narrower and clearer: evaluate and, if safe, enable `onlyLoadAppFromAsar`.

The Mol* cleanup removed the most suspicious unpacked-renderer exception, so the repo is in a much better position to make that decision deliberately rather than deferring it indefinitely.

Sources:
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electron.build/tutorials/adding-electron-fuses.html

### Medium: Local verification is still brittle when packaged artifacts exist

The repo's canonical local gate is `make ci`, but it is not fully hermetic yet.

During review work, packaged output under `release/**` contaminated linting because `eslint.config.js` excludes `out/**`, `dist/**`, `.planning/**`, and `docs/**`, but not `release/**`.

That means a legitimate local packaging run can poison later verification until the generated output is manually cleaned.

**Recommendation**

- ignore `release/**` in ESLint unless packaged output is intentionally part of lint scope
- keep `make ci` resilient to expected generated artifacts
- if packaged-output validation is wanted, put it behind a separate explicit target

### Medium: Data-layer portability remains the main strategic architecture gap

The core long-term conclusion from earlier reviews still holds.

- `DatabaseService` remains SQLite-native.
- `VariantRepository` still owns SQLite-specific FTS behavior.
- worker assumptions still target local encrypted SQLite files.
- Kysely is still being used for typed SQL help, not as a real dialect boundary.

There has been useful prep work:

- FTS trigger lifecycle management is more isolated
- incremental cohort-summary SQL exists

But that is still preparatory. It does not change the headline conclusion that a true storage adapter boundary does not exist yet. VarLens is operationally stronger now, but it is still not prepared for a hosted-Postgres pivot or much larger-scale data growth without deliberate architecture work.

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

| Area | 2026-04-16 | 2026-04-22 | Notes |
|---|---:|---:|---|
| Security / desktop boundary | 8.0 | 8.3 | Strong defaults remain; fuse baseline is now checked in |
| Architecture | 7.5 | 8.1 | IPC/domain structure is now materially stronger |
| Maintainability | 7.5 | 8.3 | Planning drift was cleaned up; repo guidance now matches reality |
| Testability / CI trust | 7.5 | 8.4 | Startup smoke, release gating, and cleaner verification flow help materially |
| UX / snappiness | 7.0 | 7.2 | Phase 1 landed; next step still needs evidence |
| PostgreSQL / hosted backend readiness | 3.0 | 3.3 | Small prep work exists; adapter boundary is still absent |
| Supply chain / CI posture | 7.0 | 8.0 | Action SHA pinning landed |
| WGS-scale readiness | 4.0 | 4.0 | No meaningful change |
| Dev workflow / agent-readiness | 7.0 | 8.5 | `AGENTS.md` is strong and stale live planning docs are gone |
| **Overall** | **7.0** | **8.0** | Broad cleanup is done; remaining issues are narrower and more strategic |

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

### Priority C — Introduce a real storage adapter boundary before any Postgres work

- isolate SQLite-specific repository behavior
- define adapter boundaries around query and rebuild flows
- keep Kysely as a tool inside the boundary, not the boundary itself

### Priority D — Make local verification hermetic — ✅ Resolved (commit `a8a80fc`)

- `release/**` is in `eslint.config.js` ignore list; a local `make dist` no longer poisons subsequent `make ci` runs.

### Priority E — Optional command-surface mirroring

- mirror a few high-value `make` targets into `package.json` only if it improves discoverability without weakening the “Makefile is canonical” rule

## Bottom Line

VarLens is no longer primarily paying down shell chaos, IPC sprawl, or stale planning drift. Those problems have been reduced to the point where they should stop dominating reviews.

The remaining work is more focused:

- finish packaged-app integrity hardening
- choose the next renderer-performance phase from evidence
- add a real storage abstraction boundary if larger-scale or hosted data is still a real future direction
- smooth out a few local workflow rough edges

That is a healthier and more accurate picture of the current codebase.

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
