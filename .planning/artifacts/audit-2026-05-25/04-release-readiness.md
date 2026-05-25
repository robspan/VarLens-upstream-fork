# Release Readiness & Engineering Hygiene Audit — 2026-05-25

Scope: re-audit `release/supply-chain` posture (rated 8.0/10 in `.planning/code-review/CODEBASE-REVIEW-2026-05-06.md`),
CI gates, agent-health baseline, dependency health, packaging/signing, observability, docs, and perf gates.
Codebase: VarLens v0.59.4 (package.json), latest git tag `v0.59.3`.

## Executive Summary

VarLens has a defensible release pipeline (SHA-pinned actions, gitleaks on push & tag,
tag-SHA build verification with retry, fuse baseline with `strictlyRequireAllFuses: true`,
signed Windows installers via SSL.com eSigner). The May 6 CI gate findings remain only
**partially fixed**: the aggregator still ignores `cancelled`/`skipped (after upstream failure)`,
the version comparison between tag and `package.json` is still missing, packaged-binary smoke
is still Linux-only, and `.github/workflows/release.yml` is excluded from the path filter.

The single highest-impact finding outside CI is **PHI-leak risk in main-process logs**:
`MainLogger` writes raw messages (including HGVS / chr:pos coordinates) to
`~/.config/varlens/logs/main.log` without the `sanitizeLogMessage()` redactor that the
renderer-side `LogService` already calls. Genetic variant data lives in those logs.

Other release-blockers are documentation hygiene (CHANGELOG missing seven releases, user-facing
docs changelog frozen at v0.22.0), an uncommitted version-bump (package.json 0.59.4 with no
matching tag), and one **high-severity transitive CVE** (`js-cookie ≤3.0.5` via
`@vue/test-utils → js-beautify`; dev-only so practical impact is limited).

Renderer perf regression gates (Phase 1 harness) are **not wired to CI** — `renderer-perf-phase1.e2e.ts`
exists and Playwright `testMatch: '**/*.e2e.ts'` would pick it up, but no workflow ever calls Playwright
outside of `startup-smoke.e2e.ts` and `packaged-smoke.e2e.ts`. The "release-blocker perf threshold"
exists only as prose in `AGENTS.md` (WGS PG/SQLite ≤2.0×), enforced by a comparison script the developer
must run by hand.

Agent-health baseline is 22 files (task brief said 25 — out of date). The split priority is dominated by
the three shared-type modules — `src/shared/types/api.ts` (906 LOC, 68 fan-in nodes, 62 commits/6mo) is
the load-bearing context bottleneck for any agent touching IPC.

## CI / Release Gaps

### CR-1 [HIGH] Aggregator still ignores `cancelled` / `skipped (after failure)`

- Evidence: `.github/workflows/build.yml:266-281`. The `ci` job only fails on
  `result == "failure"`. If `checks` is `cancelled` (concurrency cancellation on a
  push-after-push pattern), or `package` is `skipped` because `checks` failed, the
  aggregator returns success.
- Why it matters: a passing required-status-check on a branch where required CI was
  effectively not run lets a PR merge.
- Fix: change the bash to fail if any of `secrets-scan`, `checks`, `package` is **not**
  `success` and **not** `skipped because changes.outputs.code == 'false'`. Concretely,
  treat `cancelled` and `skipped` as failure unless `needs.changes.outputs.code == 'false'`.
- Validation: synthetic PR with a forced `workflow_dispatch` cancellation; confirm
  `ci` job fails and PR merge stays blocked.

### CR-2 [HIGH] Tag-vs-`package.json` version not validated

- Evidence: `.github/workflows/release.yml:26-28` extracts `version=${GITHUB_REF_NAME#v}`
  and uses it for artifact filenames. Nowhere does the workflow compare to
  `package.json` "version". artifactName patterns in `package.json:137,146,149,157`
  pin to `${version}` (electron-builder reads from `package.json`), but the GitHub
  release tag is from the git ref. A `v0.60.0` tag against `package.json: "0.59.4"`
  would publish artifacts named `Varlens-Setup-0.59.4.exe` under a `v0.60.0` release.
- Why it matters: latest-mac.yml / latest-linux.yml / latest.yml use the
  package.json version for the version field; auto-update clients will reject
  updates that disagree with the tag, but users will download mismatched binaries.
- Fix: add a step right after "Extract version from tag" in `create-release` that
  asserts `node -p "require('./package.json').version" == "${VERSION_FROM_TAG}"`
  and fails the workflow otherwise.
- Validation: dry-run with mismatched tag locally via `act` or `workflow_dispatch`.

### CR-3 [MEDIUM] `.github/workflows/release.yml` not in build.yml path filter

- Evidence: `.github/workflows/build.yml:36-49` includes `.github/workflows/build.yml`
  in `code:` filter but **not** `release.yml` or `docs.yml`. A PR that breaks
  `release.yml` skips the full CI pipeline (`code == 'false'`) and lands on main.
- Why it matters: release workflow correctness is only exercised when a tag is
  pushed, and a broken release.yml is discovered only when releasing.
- Fix: change the filter to `'.github/workflows/**'` (covers all three workflows).
  This is a one-line change and was explicitly flagged on May 6 — still open.
- Validation: open a PR that adds a syntax error to release.yml; confirm
  `changes.outputs.code == 'true'`.

### CR-4 [MEDIUM] Packaged-binary smoke still Linux-only

- Evidence: `.github/workflows/build.yml:241-259` only runs `packaged-smoke.e2e.ts`
  on `runner.os == 'Linux'`. The macOS and Windows runners produce artifacts via
  `electron-builder --publish never` but never launch them. macOS in particular has
  fuse interactions (asar integrity), code-signing nuances, and arch (arm64 only)
  to validate.
- Why it matters: a packaging regression that breaks the macOS .dmg or the
  Windows .exe portable runner is discovered by users, not CI.
- Fix: add a minimal smoke step on macOS (launch the unpacked `.app`) and Windows
  (launch the portable .exe with `--no-sandbox`). Even a 5-second "does the
  window open" guard catches 80% of packaging regressions.
- Validation: intentionally break `scripts/configure-fuses.mjs` (e.g. set
  `OnlyLoadAppFromAsar: true` with mis-staged asar) and confirm cross-OS smoke
  catches it.

### CR-5 [MEDIUM] No macOS notarization

- Evidence: `package.json:88-167` `build` block has no `mac.notarize`, no
  `afterSign` hook, no `appleId`/`teamId` env wiring. All three workflows set
  `CSC_IDENTITY_AUTO_DISCOVERY=false`. The macOS DMG/ZIP is produced unsigned
  ad-hoc.
- Why it matters: on macOS 10.15+ unsigned binaries trigger Gatekeeper. Users
  see "Varlens.app is damaged and cannot be opened" without a path-clear
  workaround besides `xattr -dr com.apple.quarantine`. For a clinical-genetics
  desktop app, this is a real adoption barrier.
- Fix: either acquire an Apple Developer ID + automate notarization via
  `notarytool` in an `afterSign` hook, OR document a clear "first-launch
  override" path on the user docs. Acquiring the cert is the right answer
  but is an org spend question; document the workaround in the meantime.
- Validation: build a `.dmg` locally, copy it to an internet-quarantined
  mac, open it; reproduce the dialog.

### CR-6 [LOW] WGS perf compare script does not exit non-zero on budget failure

- Evidence: `scripts/perf/compare-wgs-import.mjs` writes a markdown comparison
  but its exit-code semantics are not enforced for budget violations. The May 6
  review flagged this. Opt-in command (`pg-query-perf`) chains the perf tests
  but doesn't `set -e` on a budget breach.
- Why it matters: a contributor running `make pg-query-perf` against a slow
  PR can plausibly get a "PASSED" feeling from no terminal red, even when
  the ratio creeps above 2.0×.
- Fix: in `scripts/perf/compare-wgs-import.mjs`, `process.exit(1)` when the
  comparison budget fails. In `Makefile:241-243`, use `set -e` so the second
  vitest invocation can't mask the first one's failure.
- Validation: seed a fixture run with an artificially slow timing; confirm
  non-zero exit.

### CR-7 [LOW] Release `secrets-scan` duplicates `build.yml` secrets-scan on the same SHA

- Evidence: `.github/workflows/release.yml:106-124` re-runs gitleaks on the
  tagged SHA. `build.yml` already ran on the same SHA (verified in step
  "Verify Build workflow passed"). Duplicate cost and a second false-positive
  surface.
- Why it matters: minor — wastes ~30 s and a runner. The build's
  `secrets-scan` is the contract gate already.
- Fix: drop the duplicate and rely on the build-workflow verification. Keep
  the scan only if release.yml ever introduces secrets-bearing files that
  build.yml does not see (none today).
- Validation: tag a no-op release; confirm release succeeds without the
  duplicate.

### CR-8 [LOW] No Linux .rpm; no Windows MSI; no AppImage signature

- Evidence: `package.json` linux targets are `["AppImage", "deb"]`. No `rpm`,
  no `snap`, no `flatpak`. Windows uses NSIS + portable + zip; no `msi`.
  AppImage doesn't carry a signature.
- Why it matters: Fedora / RHEL / openSUSE users have no first-class
  installer. Corporate Windows deploys often require MSI for GPO. Unsigned
  AppImages can't be verified offline.
- Fix: defer rpm/msi until user demand surfaces; document in user docs which
  Linux distros are first-class. AppImage signing is a one-line
  `--sign-key` flag if a GPG key is available.

## Agent-Health Split Priority List

The baseline at `scripts/agent-health-baseline.json` has **22 entries** (task brief
said 25 — out of date). Composite priority blends three signals:

- **Knowledge-graph fan-in** (from `.understand-anything/knowledge-graph.json`,
  computed via `node -e` over edges where source/target are file or function nodes
  within the listed file). High fan-in = changes ripple widely.
- **Git churn** (commits in last 6 months touching the file). High churn = the
  current shape is actively being patched, so a split pays off fastest.
- **Raw line count**.

Priority order (top = split first):

| # | File | LOC | Fan-in | Churn (6mo) | Why | Concrete split |
|---|------|-----|--------|-------------|-----|----------------|
| 1 | `src/shared/types/api.ts` | 906 | 68 | 62 | THE shared-type bottleneck. Every IPC change rebuilds context for any agent reading it. | `api/window.ts` (≤200, just `WindowAPI` re-exports), `api/cases.ts`, `api/variants.ts`, `api/import.ts`, `api/cohort.ts`, `api/annotations.ts`, `api/index.ts` (barrel). Target ≤300 each. |
| 2 | `src/shared/types/ipc-schemas.ts` | 1009 | 31 | 34 | Largest single file. High churn — every new domain adds Zod schemas here. | One file per domain: `ipc-schemas/cases.ts`, `ipc-schemas/variants.ts`, `ipc-schemas/import.ts`, `ipc-schemas/cohort.ts`, etc.  Mirrors the domain layout already used in `src/shared/ipc/domains/`. |
| 3 | `src/renderer/src/mocks/mockApi.ts` | 1214 | 0 | 42 | Largest file in repo. Test-only, but every renderer test loads it. | One mock per domain: `mocks/cases.ts`, `mocks/variants.ts`, etc. + `mocks/index.ts` barrel. Target ≤300 each. |
| 4 | `src/renderer/src/components/CohortTable.vue` | 760 | 0 | 48 | Highest-churn renderer file. Sibling of VariantTable; pattern duplication. | Extract `CohortTableColumns.vue` (column metadata), `CohortTableRow.vue` (per-row render), `CohortTableHeader.vue`; keep `CohortTable.vue` as the orchestrator (~250 LOC). Mirror the split into VariantTable to fix item 7 at the same time. |
| 5 | `src/main/database/VariantRepository.ts` | 758 | 17 fn-out | 31 | High churn AND broad downstream surface. Cohort parity work touches this constantly. | `VariantRepository.read.ts` (query/list/getById), `VariantRepository.write.ts` (insert/update), `VariantRepository.search.ts` (FTS), `VariantRepository.aggregate.ts` (counts/stats). |
| 6 | `src/renderer/src/composables/useAnnotations.ts` | 923 | 4 fn-in / 19 fn-out | 22 | Mixed concerns: VEP, MyVariant, gnomAD, SpliceAI, ACMG all in one composable. | One composable per provider: `useVepAnnotations.ts`, `useMyvariantAnnotations.ts`, `useGnomadAnnotations.ts`, `useSpliceaiAnnotations.ts`. Glue stays in `useAnnotations.ts` (~200 LOC). |
| 7 | `src/renderer/src/components/VariantTable.vue` | 668 | 2 | 38 | Cohort parity is mandatory (memory feedback). Split in tandem with item 4. | Same split as #4: extract column metadata, row, header. |
| 8 | `src/renderer/src/components/FilterToolbar.vue` | 737 | 1 | 36 | High churn — filter UX phase 1/2/3 work has been compacting. | Split by toolbar zone: `FilterToolbarChips.vue`, `FilterToolbarPresets.vue`, `FilterToolbarSearch.vue`, `FilterToolbarActions.vue`. |
| 9 | `src/shared/types/database.ts` | 672 | 38 | 4 | Very high fan-in but low churn — split is mechanical, payoff is purely agent-context. | Split by domain table cluster: `database/case-tables.ts`, `database/variant-tables.ts`, `database/annotation-tables.ts`, `database/index.ts` barrel. |
| 10 | `src/main/database/VariantFilterBuilder.ts` | 782 | 6 / 9 fn-out | 5 | Central, low-churn — split when the next filter feature lands. | Already plausibly splittable by filter category: `filters/clinical.ts`, `filters/genomic.ts`, `filters/inheritance.ts`, `filters/computed.ts`. |
| 11 | `src/renderer/src/components/cohort/CohortFilterBar.vue` | 642 | 2 | 26 | Cohort-parity sibling of FilterToolbar; same split shape. | Mirror item 8 inside cohort. |
| 12 | `src/renderer/src/components/cohort/CohortFilterDrawer.vue` | 680 | 0 | 15 | Same pattern as FilterDrawer. | Split into `CohortFilterDrawerHeader.vue`, `CohortFilterDrawerSections.vue`, `CohortFilterDrawerFooter.vue`. |
| 13 | `src/renderer/src/components/CaseList.vue` | 635 | 0 / 11 fn-out | 24 | High churn, all renderer-internal. | Extract `CaseListItem.vue`, `CaseListFooter.vue`. |
| 14 | `src/renderer/src/components/cohort/CohortDataTable.vue` | 627 | 0 | 26 | Similar pattern to CohortTable. | Often a thin wrapper; verify, then promote the column/row split or remove the duplication with CohortTable. |
| 15 | `src/renderer/src/components/FilterDrawer.vue` | 857 | 0 | 20 | Long, but lower fan-in. | Split as item 12. |
| 16 | `src/main/workers/postgres-import-worker.ts` | 964 | 5 / 22 fn-out | 16 | Worker code; isolated; broad fan-out into postgres modules. | Three responsibilities: COPY-stream upload, generated-column wait, batch accumulator. Split into `postgres-import-worker/main.ts` (orchestrator, ≤200 LOC), `postgres-import-worker/copy-pipeline.ts`, `postgres-import-worker/batch-state.ts`. |
| 17 | `src/main/storage/postgres/PostgresCohortRepository.ts` | 957 | 5 / 10 fn-out | 2 | Largest backend file, but low churn (just-landed in 0.59 series). | Split by capability: cohort-list, cohort-detail, cohort-rebuild (gated), cohort-aggregate. |
| 18 | `src/renderer/src/components/import/VcfImportDialog.vue` | 831 | 0 | 6 | Wizard; isolated. | Split by wizard step: `VcfImportStepPreview.vue`, `VcfImportStepMapping.vue`, `VcfImportStepFilters.vue`, `VcfImportStepConfirm.vue`. |
| 19 | `src/renderer/src/components/import/ImportWizard.vue` | 779 | 0 | 10 | Similar to VcfImportDialog. | Mirror split. |
| 20 | `src/renderer/src/composables/useLollipopPlot.ts` | 982 | 3 | 1 | Visualization, low churn. Split is opportunistic. | Split into `useLollipopPlotLayout.ts`, `useLollipopPlotInteractions.ts`, `useLollipopPlotRendering.ts`. |
| 21 | `src/renderer/src/composables/useGeneStructurePlot.ts` | 654 | 4 | 1 | Same family as item 20. | Same shape of split. |
| 22 | `scripts/postgres/seed-dev-workspace.mjs` | 667 | 6 / 6 fn-out | 2 | Dev tooling — lowest impact. | Split by phase: `seed/cases.mjs`, `seed/variants.mjs`, `seed/profiles.mjs`. |

**Top 5 to split first (composite priority):**

1. `src/shared/types/api.ts` — agent context, broad blast radius
2. `src/shared/types/ipc-schemas.ts` — paired with #1
3. `src/renderer/src/mocks/mockApi.ts` — paired with #1/#2 (tests rebuild on every API change)
4. `src/renderer/src/components/CohortTable.vue` + `src/renderer/src/components/VariantTable.vue` (one PR; cohort-parity rule)
5. `src/main/database/VariantRepository.ts`

## Dependency Upgrade Plan

`npm audit` total (incl. dev): 1 high, 1 moderate, 5 low across 1210 deps.

| Severity | Package | Path | Notes / Action |
|----------|---------|------|----------------|
| HIGH | `js-cookie ≤3.0.5` (GHSA-qjx8-664m-686j, CVSS 7.5) | `@vue/test-utils → js-beautify → js-cookie` | **Dev-only**. Practical impact: zero in shipped app. Upgrade `js-beautify` via `overrides`, or wait for `@vue/test-utils` to update. Add an `overrides` entry: `"js-cookie": "^3.0.6"` once 3.0.6 ships. |
| MODERATE | `qs 6.11.1-6.15.1` (GHSA-q8mj-m7cp-5q26) | transitive | `fixAvailable: true` via `npm audit fix`. Apply. |
| LOW (x5) | `elliptic` + `browserify-sign` + `create-ecdh` + `crypto-browserify` + `pdbe-molstar` direct | `pdbe-molstar` chain | Fix requires `pdbe-molstar 3.1.3` (semver-major; current 3.12.0 is **newer**, advisor is confused — verify by reading the advisory). Likely already fixed in 3.12.0; npm audit's "fixAvailable" is misreporting because of pdbe-molstar's pre-release versioning. **Verify with `npm view pdbe-molstar versions`** before acting. |

`npm outdated` (current vs latest):

| Package | Current | Latest | Major behind | Action |
|---------|---------|--------|--------------|--------|
| `electron` | 40.10.1 | 42.2.0 | 2 majors | Plan upgrade — Electron 41/42 may flip new fuses. Read `scripts/configure-fuses.mjs` "WasmTrapHandlers" note. Each Electron major needs a deliberate verification cycle. |
| `vite` | 7.3.3 | 8.0.14 | 1 major | Defer until `vitepress` 2.x stabilizes (constraint already tracked, GH #154 in memory). |
| `vitepress` | 2.0.0-alpha.17 | 1.6.4 (stable) | Pre-release vs stable | Existing tracked decision: stay on 2.x alpha for the vite-7 compat. Re-evaluate when 2.0 ships. |
| `vuedraggable` | 4.1.0 | 2.24.3 | "Latest" is older — Vue 2 fork. Current 4.1.0 is correct for Vue 3. **Pin via `overrides` or document.** |
| `better-sqlite3-multiple-ciphers` | 12.9.0 | 12.10.0 | minor | Safe minor — pickup at next dependency-bump PR. |
| `stream-json` | 2.1.0 | 3.1.0 | 1 major | Used in import pipeline — verify there's no API change in the streaming JSON parser path. |
| `sass-embedded`, `markdown-it` | minor behind | — | Pick up next bump. |
| `@types/nock` | 11.1.0 | 10.0.3 (older) | Type stub mismatch — `@types/nock` typically tracks `nock`. Verify `nock` version, then either downgrade `@types/nock` or remove if `nock` ships its own types now (it does, since `nock` 14+). **Drop `@types/nock`.** |

No CVEs in shipped (`--omit=dev`) dependencies block release. Apply the `qs`
fix and the `nock` type-stub cleanup in the next dependency-bump PR.

## Test Coverage Gaps

Current: **328 test files** (Vitest + Playwright, `find tests -name '*.test.ts' -o -name '*.test.mts'`).
Up from the 32 mentioned in MEMORY.md — that note is dramatically stale.

Sample coverage check (highest-risk *missing* tests):

- **VCF import pipeline**: 22 tests across `tests/main/import/vcf/`. Strong coverage of
  header/line/allele-splitter/annotation/genotype parsers, mapper, strategy, info-field
  registry, gzip detection. **Gap**: no test for the `MultiSampleHandler` boundary (one
  case per sample) at the integration level — verified by `find` looking for
  `multi-sample.test.ts`, none. Inspect `tests/e2e/multi-variant-type.e2e.ts`; that's
  a UI-driven test, not an isolated unit on the splitter behavior.
- **IPC handlers**: 27 domain contracts (`src/shared/ipc/domains/*.ts`); 25 contract tests
  under `tests/shared/ipc/domains/`. Three domains without dedicated contract tests
  (`cases`, `database`, `filter-presets`) — but they are explicitly covered by
  `tests/shared/types/preload-contract.test.ts` which extracts and asserts their keys.
  No real gap.
- **Postgres executors**: 46 postgres-tagged tests including
  `postgres-read-executor.test.ts`, `postgres-import-executor.test.ts`,
  `postgres-startup-migrations.test.ts`. Good. **Gap**: no test for
  `PostgresCohortRepository` cohort-rebuild gate (capability returns false) — confirm via
  `find … -name 'postgres-cohort*.test.ts'`, none found at top of `tests/main/storage/`.
- **ACMG classification**: `tests/shared/utils/acmg.test.ts` +
  `tests/renderer/utils/acmg/{calculator,suggestions,serialization}.test.ts` +
  two E2E. Reasonable.
- **Filter DSL**: 15 filter-related tests including `variant-filter-builder.test.ts`,
  `inheritance-filters.test.ts`, postgres variants thereof, renderer
  `filterSerialization`/`filterClearing`/`filterDefaults`. Strong.

**Highest-risk missing tests** (recommend adding):

1. `tests/main/services/main-logger-redaction.test.ts` — asserts that
   `MainLogger.error("variant chr1:12345 c.123A>G failed")` writes a redacted
   string to its electron-log transport. **Currently fails** — see Obs-1.
2. `tests/main/import/vcf/multi-sample-handler.test.ts` — direct unit test of
   the "one case per sample" boundary in `VcfMapper`/`VcfStrategy`.
3. `tests/main/storage/postgres-cohort-capability.test.ts` — locks `cohort.rebuild = false`
   capability and asserts the gated UI/IPC behavior.
4. `tests/main/services/auto-updater.test.ts` exists (good) but verify it covers
   `quitAndInstall` error path; an auto-update that fails mid-install can wedge
   the app.
5. `tests/scripts/version-tag-consistency.test.ts` — a guard that
   `git describe --tags HEAD` (when set) matches `package.json` version.
   Belongs to CR-2's fix.

## What Was NOT Confirmed

- **Coverage thresholds** — read `vitest.config.ts:147-220` shows thresholds exist
  with per-glob overrides for `src/main/storage/postgres/copy-text-encoder.ts`, but the
  *numbers* were not audited. Per-feedback rule: never lower these. Did not run
  `COVERAGE=1 vitest run`.
- **Live `make ci` outcome** — not executed (task constraint).
- **CodeQL / Web CI / Dependabot workflows** — only `build.yml`, `release.yml`, `docs.yml`
  live in `.github/workflows/`; `gh workflow list` shows additional active workflows
  (`CodeQL`, `Web CI`, `Upstream sync check`, `Copilot code review`, `Dependabot Updates`)
  which must be **org-level / repo-level outside the workflow directory** or reusable
  workflow refs not introspected. They were not audited.
- **Signed AppImage / DMG hash propagation** — release.yml regenerates `latest.yml` for
  Windows after signing (lines 400-417). Does macOS need an equivalent step? Not signed
  (CR-5), so currently moot, but flag if notarization is added.
- **Auto-update path on first install** — `AutoUpdater` is wired (`src/main/services/AutoUpdater.ts`),
  schedule is 30 s delay + 4 h interval. No E2E that proves update download → install →
  relaunch on a real packaged binary. `tests/e2e/auto-update.e2e.ts` exists but content
  not inspected.
- **Telemetry** — confirmed **none** via grep for `telemetry|analytics|crashReporter`.
  That is itself a finding: no crash reporting means user-side `app crashed on startup`
  is invisible to the team. Listed under Observability gaps.
- **`release/` directory hygiene** — `ls release/` shows stale 0.58.2 AppImage and
  linux-unpacked tree. AGENTS.md says `make ci` traverses this directory with ESLint;
  not validated that the cleanup is enforced.

## Observability Gaps

### Obs-1 [HIGH] Main-process logs are not PHI-redacted

- Evidence: `src/main/services/MainLogger.ts:107-132` passes the raw `message` argument
  to `log.info` / `log.error` etc. The renderer-side `LogService` calls
  `sanitizeLogMessage()` from `src/renderer/src/utils/sanitizers.ts:30-49` first, which
  redacts HGVS, genomic coordinates, and patient IDs. Main side does not.
- Why it matters: any `mainLogger.error(\`Failed to import variant chr1:12345 c.123A>G…\`)`
  call writes raw PHI into `~/.config/varlens/logs/main.log` (5 MB rotation;
  `main.old.log` retained). For a clinical-genetics app the privacy posture is broken
  for log dumps a user might attach to a bug report.
- Fix: extract `sanitizeLogMessage` into `src/shared/utils/sanitizers.ts`, import from
  `MainLogger`, sanitize before `log.info/error`. The IPC emit path
  (`emit()` -> `webContents.send`) should also sanitize before broadcasting to
  prevent the renderer log store from indirectly receiving raw PHI.
- Validation: new test in `tests/main/services/main-logger-redaction.test.ts`.

### Obs-2 [MEDIUM] No crash reporter

- Evidence: zero matches for `crashReporter` in `src/main/`. Electron ships
  `crashReporter` API; not initialized.
- Why it matters: when the packaged app crashes on a user machine, the team
  has no signal beyond user bug reports. Hard to triage native module
  segfaults in particular.
- Fix: initialize Electron `crashReporter` with `submitURL: ''` (so dumps are
  written locally only — preserves no-telemetry posture). Expose a "show
  crash logs folder" link in the user-visible About dialog. Document the
  path. Optional: ship an opt-in upload to a self-hosted Sentry / Minio
  endpoint, defaulting OFF.
- Validation: spawn a deliberate native crash in dev (`process.crash()`), confirm
  dump appears in `userData/Crashpad/`.

### Obs-3 [LOW] Log rotation keeps one old file only

- Evidence: `MainLogger.ts:35-36` — `maxSize = 5 MB`, no `archiveLog` policy.
  electron-log default keeps only `main.old.log` (one rotation deep).
- Why it matters: a debug session that triggers a chatty import can blow past
  10 MB and lose the early context.
- Fix: configure `log.transports.file.archiveLogFn` to rotate 5 deep.

## Release Documentation Gaps

### Doc-1 [HIGH] CHANGELOG.md stale by seven releases

- Evidence: `CHANGELOG.md` last entry is `## [0.56.7] — 2026-04-23`. Tags since:
  `v0.58.0`, `v0.58.1`, `v0.58.2`, `v0.58.3`, `v0.59.0`, `v0.59.3` (latest).
  Current `package.json` is 0.59.4 (untagged).
- Why it matters: "Keep a Changelog" promise broken; users have no narrative
  diff. Release.yml auto-generates GitHub Release body from `git log`, but the
  curated CHANGELOG is the canonical history.
- Fix: backfill entries from `git log v0.56.7..v0.59.3 --no-merges` per
  release, group by Conventional Commit type. Going forward, add a
  "release-notes drafting" step to the release runbook (or automate via
  `release-please` / `changesets`).
- Validation: open a PR with the backfill; release.yml-style log
  regeneration should match.

### Doc-2 [HIGH] User docs changelog frozen at v0.22.0

- Evidence: `docs/about/changelog.md` last listed release is `### v0.22.0`.
  Defers to GitHub Releases for full list — but the docs page advertises
  "Recent Releases" with entries from ~v0.18-v0.22 range. Outdated by ~37
  releases.
- Why it matters: users following the website have no insight into the
  PostgreSQL backend story, VCF import, multi-variant types, etc.
- Fix: either regenerate docs changelog from `CHANGELOG.md` at build time
  (VitePress can include markdown via `<!--@include-->`), or remove the
  static list and link directly to GitHub Releases.

### Doc-3 [MEDIUM] Schema-migration story for users with existing varlens.db not user-visible

- Evidence: `src/main/database/migrations.ts:14-322` runs PRAGMA-user_version
  migrations from 0 → current on startup. `docs/guide/` has no entry on
  "Upgrading from older VarLens versions". A user with v0.30 → v0.59 db will
  silently get 30+ migrations replayed, no rollback path documented.
- Fix: add `docs/guide/upgrading.md` covering: where the database lives,
  recommended backup-before-upgrade, what to do if migration fails
  (re-import from JSON/VCF, restore backup). Link from the install guide.
- Validation: simulate "upgrade from v0.30" by importing the same case under
  both versions; document any user-facing schema differences (column
  additions etc.).

### Doc-4 [LOW] Version-bump commits not gated by CHANGELOG update

- Evidence: `chore: bump version to 0.59.4` (f23709db, current HEAD) did not
  touch CHANGELOG.md.
- Fix: add a release runbook step or a pre-commit hook that fails if
  `package.json` version changes without `CHANGELOG.md` `[Unreleased]`
  promotion.

## Performance Regression Gates

### Perf-1 [HIGH] `renderer-perf-phase1.e2e.ts` not invoked by CI

- Evidence: `playwright.config.ts:testMatch: '**/*.e2e.ts'` would pick it up,
  but only `startup-smoke.e2e.ts` and `packaged-smoke.e2e.ts` are explicitly
  invoked in `build.yml` and `Makefile`. The Phase 1 perf E2E exists but is
  invoked by no automation.
- Why it matters: the May 6 review repeatedly cited "renderer performance
  should continue from measurement". Without CI gating, a regression is found
  only when a contributor remembers to run the harness.
- Fix: add a `make perf-phase1` target that runs the harness against the
  `baseline/` artifact and a `make perf-phase1-compare` that diffs against
  the previous run; wire as an **opt-in CI job** (similar to WGS perf — not
  every PR pays the cost) or a nightly cron job that comments on a tracking
  issue.
- Validation: artificial regression in a renderer composable; confirm the
  scheduled job catches it.

### Perf-2 [MEDIUM] "Release-blocker perf threshold" lives only in `AGENTS.md` prose

- Evidence: AGENTS.md states "Phase 9 escalation rule is 'PG/SQLite ≤ 2.0×';
  sustained ratios above that trigger a follow-up phase." No script enforces
  this on commit. Latest figure 1.85× (in spec) is close to the cliff.
- Why it matters: a "follow-up phase" is a manual gate, not an enforceable
  one. A regression to 2.1× looks like a normal PR until someone happens to
  run WGS perf.
- Fix: pair with CR-6 — `compare-wgs-import.mjs` should exit non-zero when
  the ratio crosses the documented 2.0× threshold. Then `make pg-query-perf`
  (and a nightly job that runs it) is a real gate.

## Packaging & Signing Notes (no separate finding section needed beyond CR-5)

- Electron fuse baseline in `scripts/configure-fuses.mjs` is solid:
  `strictlyRequireAllFuses: true`, `EnableEmbeddedAsarIntegrityValidation: true`,
  `OnlyLoadAppFromAsar: true`, `RunAsNode: false`.
- SSL.com eSigner config matches MEMORY (CodeSignTool v1.3.2, batch signing,
  Setup + Portable exe). The 31 s retry on first failure is appropriate (TOTP
  drift).
- macOS arch: `arm64` only (`package.json:130-140`). **No Intel build.** This
  is a deliberate choice (Apple Silicon-only); users on Intel Macs hit a wall.
  Document on the install page.
- electron-builder `publish: { provider: github, releaseType: draft }` — works
  with the workflow's `--publish never` + post-build artifact upload pattern
  (per MEMORY: avoids the duplicate-draft race).

## Bottom Line

Release pipeline is structurally sound but has measurable, fixable gaps. None
are catastrophic, but four together (PHI in main logs, stale CHANGELOG by 7
releases, untagged version bump, missing tag/package version guard) mean a
0.59.4 release today would ship with avoidable user-visible problems.

The single fastest high-impact remediation is splitting `src/shared/types/api.ts`
because it unlocks every other agent-context improvement in the baseline.
