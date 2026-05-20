# Agent Health Guardrails

## Purpose

VarLens already has strong project instructions and CI gates, but most LLM-sustainable
coding practices are still advisory. The goal is to add a small, enforceable guardrail layer
that keeps Claude and Codex work bounded, reviewable, and easy to validate without turning
`AGENTS.md` into a long process manual.

The first version should prevent new structural drift, surface existing hotspots, and preserve
room for deliberate exceptions.

## Background

Current guidance from agent vendors points in the same direction:

- Keep always-loaded project instructions concise, specific, and maintained.
- Put durable repository rules in project instruction files and move long or volatile notes into
  scoped documents.
- Give agents commands that verify their work instead of relying only on prose.
- Exclude noisy, generated, sensitive, or irrelevant files from agent context.
- Prefer small, well-bounded tasks that can be reviewed and tested independently.

VarLens currently has:

- `AGENTS.md` as the canonical cross-agent contract.
- `CLAUDE.md` importing `AGENTS.md` plus Claude-specific behavior.
- `make ci` and `make ci-full` as strong validation surfaces.
- ESLint restrictions for renderer-to-main imports and direct renderer `window.api` access.
- GitHub Actions with secrets scanning and pinned actions.

Missing pieces:

- A measurable agent-health command.
- A line-count baseline for existing large files.
- A regression policy for oversized files.
- Claude/Codex-focused context hygiene files.
- PR review prompts for LLM-generated or agent-assisted changes.

## Goals

- Add a fast local command that reports and eventually blocks agent-health regressions.
- Enforce the `600` LOC source-file policy without requiring immediate large-file cleanup.
- Track current oversized files as a baseline so existing debt is visible but not release-blocking.
- Add context exclusions for generated outputs, local artifacts, sensitive data, and large fixtures.
- Keep all agent-neutral policy in `AGENTS.md`; avoid duplicating guidance across agent-specific files.
- Make the rollout compatible with current `make ci` and GitHub Actions workflows.

## Non-Goals

- Refactor existing oversized files as part of this change.
- Introduce instructions for Gemini or Copilot unless those agents become part of the normal workflow.
- Replace ESLint, Prettier, TypeScript, or Vitest checks.
- Add fragile source parsing that produces noisy failures on Vue or TypeScript syntax.
- Block all large tests on day one.

## Proposed Design

### Agent Health Script

Add `scripts/check-agent-health.mjs`.

The script should:

- Scan authored source files under `src/` and `scripts/`.
- Report files over the configured source threshold, default `600` lines.
- Support separate test reporting with a looser threshold, default `800` lines.
- Ignore generated files, fixtures, migrations, snapshots, lockfiles, build outputs, public vendor
  bundles, coverage, caches, and `.planning/artifacts/`.
- Compare current oversized authored files to a committed baseline.
- Fail only when a non-exempt file newly exceeds the threshold or an existing oversized file grows.
- Print a concise table of existing oversized files so cleanup candidates stay visible.

The first version should focus on file size because it is reliable across `.ts`, `.mjs`, and `.vue`.
Function-size and complexity enforcement can be added later through ESLint once false positives are
understood.

### Baseline

Add a committed baseline file, for example:

`scripts/agent-health-baseline.json`

The baseline should store:

- Path.
- Current line count.
- Threshold.
- Category such as `source`, `test`, `fixture`, or `exempt`.
- Optional reason for explicit exemptions.

Initial known source files over `600` LOC include:

- `src/main/database/migrations.ts`
- `src/shared/types/ipc-schemas.ts`
- `src/preload/index.ts`
- `src/main/workers/postgres-import-worker.ts`
- `src/main/storage/postgres/PostgresCohortRepository.ts`
- `src/main/database/VariantFilterBuilder.ts`
- `src/main/database/VariantRepository.ts`
- large renderer components and composables such as `FilterDrawer.vue`, `VcfImportDialog.vue`,
  `ImportWizard.vue`, `CohortTable.vue`, `FilterToolbar.vue`, `VariantTable.vue`,
  `useLollipopPlot.ts`, and `useAnnotations.ts`

The baseline is not approval to keep growing these files. It prevents the new guard from blocking
the repository before cleanup work is planned.

### Command Surface

Add:

- `npm run agent:check`
- `make agent-check`

Recommended first rollout:

- Document `make agent-check` in `AGENTS.md`.
- Run it locally before PRs that touch source structure.
- Do not wire it into `make ci` until the baseline behavior is proven on this repository.

Recommended second rollout:

- Add `agent-check` to `make ci`.
- Add it to the GitHub Actions checks job before lint or after format check.

### Context Hygiene

Add `.aiexclude` for Claude-style context hygiene.

It should exclude:

- `node_modules/`
- `out/`, `dist/`, `release/`
- caches and coverage
- Playwright outputs
- local databases and logs
- local test caches
- large generated/performance artifacts
- sensitive genomic/clinical data formats unless they are committed test fixtures

Do not add Gemini or Copilot instruction files in this phase because the normal workflow is Claude
and Codex. `AGENTS.md` remains the canonical shared instruction file.

### PR Review Prompts

If the repository uses a PR template, add checklist items for:

- Agent-health command run.
- Touched oversized files did not grow, or the PR explains why.
- Behavior-boundary tests were added or updated where needed.
- No unrelated refactor is included.

If no PR template exists, either add a minimal `.github/pull_request_template.md` or defer this to
the second rollout.

### AGENTS.md Update

Keep the update short:

- Add `make agent-check` to canonical commands.
- State that current oversized files are tracked in a baseline and must not grow without a reason.
- Point long cleanup decisions to `.planning/`.

## Error Handling and Exit Codes

The script should use stable exit codes:

- `0`: no blocking regressions.
- `1`: blocking agent-health regression.
- `2`: script usage/configuration error.

Output should include:

- Thresholds used.
- New oversized files.
- Existing oversized files that grew.
- Existing oversized files that are unchanged or improved.
- Exemptions applied.

## Testing Strategy

- Add fixture-based tests for the line-count and baseline comparison logic.
- Test ignored paths, new oversized files, existing oversized files that grow, existing oversized
  files that shrink, and explicit exemptions.
- Run `npm run agent:check`.
- Run `make lint-check` after implementation.
- Run `make typecheck` if implementation touches TypeScript or shared config.

Full `make ci` is only required once `agent-check` is wired into the CI path or other production code
changes are made.

## Rollout Plan

Phase 1:

- Implement `scripts/check-agent-health.mjs`.
- Add baseline and command surface.
- Add `.aiexclude`.
- Update `AGENTS.md`.
- Optionally add PR template checklist.

Phase 2:

- Observe false positives during normal work.
- Tune exemptions or thresholds.
- Add `agent-check` to `make ci` and GitHub Actions once stable.

Phase 3:

- Evaluate function-size enforcement through ESLint or a parser-backed script.
- Add scoped `.planning/docs/agent-*.md` notes only for areas where repeated agent mistakes occur.

## Open Decisions

- Whether to add a minimal PR template in Phase 1 if the repository still has none.
- Whether test files should be report-only or fail on growth above `800` LOC.
- Whether the baseline should be generated by the script or hand-curated in the first commit.
