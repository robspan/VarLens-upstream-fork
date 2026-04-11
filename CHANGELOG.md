# Changelog

All notable changes to VarLens are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.56.0] — 2026-04-11

### Added — Unified case shortlist

- **Shortlist tab** — a ranked, cross-type variant view that appears in
  `CaseView` whenever a case contains at least one variant type
  (SNV/indel, SV, CNV, or STR). Surfaces top candidates in one sorted
  list so triage doesn't require jumping between per-type tabs. On
  single-type cases the same tab still appears because the algorithmic
  ranking is valuable regardless of type count.
- **Three built-in shortlist presets** seeded by migration v27:
  _Tier 1 candidates_ (strict, cross-type, ClinVar P/LP and starred
  rows pinned to top), _All rare damaging_ (broad, score-driven, no
  pins), and _Recessive candidates_ (SNV/indel only). Switch between
  them from the preset picker in the panel header.
- **Algorithmic scoring pipeline** — two-stage Stage 1 candidate
  generation (shared `buildBaseWhere` + extension JOINs + per-case
  annotation join, ordered by `v.id` for deterministic cap) + Stage 2
  pure-TypeScript per-type scorers (`scoreSnv` / `scoreSv` / `scoreCnv`
  / `scoreStr`) feeding a normalized weighted `combine()` and a
  `compareScoredRows` partition sort (starred → clinvar-pinned →
  rank_score DESC → configurable tie-breakers → id ASC).
- **Rank score tooltip** — hover any row's score badge to see the
  per-component breakdown (impact / pathogenicity / rarity / ClinVar /
  phenotype) with any active pin flag.
- **Auto-refresh on annotation** — starring, commenting, or
  ACMG-classifying any variant in the current case (from any tab,
  including Shortlist itself) triggers a same-case shortlist refetch
  within one IPC round-trip via the new `variants:annotationChanged`
  broadcast. No manual Refresh click needed.
- **Row-level actions** — row click opens `VariantDetailsPanel`
  unchanged (`ShortlistRow extends Variant` structurally); kebab menu
  offers "View details" and "View in \<type\> tab" to switch to the
  per-type tab with state preserved via `v-show`.
- **HGVS c. / p. notation on SNV/indel rows** — the variant cell now
  shows a stacked layout with the genomic coordinate on top and HGVS
  cDNA + protein notation underneath (in monospace, muted caption
  style). Annotator-prefixed and bare notation forms are both
  normalized without double-prefixing.
- **Scrollable paginated table** — the Shortlist table body scrolls
  independently of the footer, paginates at 50 rows/page by default
  with a `[25, 50, 100, 250, 500]` per-page selector.

### Added — Case View preferences

- **Default active tab** preference under **Gear menu → Application
  Preferences → Case View**. Choose between `Shortlist (ranked view)`
  (default) and `SNV/Indel (per-type table)`. The setting persists
  across sessions (localStorage) and takes effect the next time any
  case opens. The Shortlist tab itself is still always shown on
  non-empty cases — the preference only controls which tab is
  default-active, not whether it exists.

### Added — Scoring config module + reference docs

- **`scoring-config.ts`** (`src/main/services/scoring/scoring-config.ts`)
  — every numeric threshold used by the Shortlist scorer lives in a
  single typed config object: CADD saturation ceiling (40), rarity AF
  cutoff (0.01), SV precise/imprecise factors and length bucket
  threshold (1 kb), CNV copy-number branching, STR status and
  known-locus shortcut, VEP IMPACT and ClinVar lookup tables. No magic
  numbers anywhere in the per-type scorers. Tuning a constant is a
  one-file edit.
- **Scoring heuristic reference** at
  `.planning/docs/shortlist-scoring-heuristic.md` — developer-facing
  reference documenting every component, every formula, every null
  fallback, every built-in preset, and every Phase-1 limitation.
  Single source of truth for the scorer.
- **User-facing feature page** at `docs/features/shortlist.md` —
  clinician / researcher reference with annotated screenshots,
  preset descriptions, sort order explanation, row actions, and a
  walkthrough of the Case View gear-menu preference.

### Added — Database

- Migration **v27**: `filter_presets.kind` discriminator column
  (`'filter' | 'shortlist'`) with a CHECK constraint, a new
  `idx_filter_presets_kind` index, and `INSERT OR IGNORE` seeding for
  the three built-in shortlist presets. Existing rows backfill to
  `kind='filter'`. Safe to replay.

### Added — IPC

- New `variants:shortlist` handler — Zod-validated discriminated
  union params (`presetId | adHocConfig`), both branches `.strict()`
  so ambiguous payloads carrying both keys are rejected. Service-layer
  sort-key allowlist + post-resolution tie-breaker key normalization
  (dotted `sv.vaf` → flat `sv_vaf` aliases) so both preset and ad-hoc
  configs produce identical comparator behavior.
- New `variants:annotationChanged` broadcast from the
  `annotations:upsertPerCase` handler wrapper. Drives same-case
  shortlist refresh in the renderer via the new `useShortlistQuery`
  composable subscription.
- **Preset payload validation at load time** — `ShortlistService`
  validates `preset.filterJson.shortlist` through `ShortlistConfigSchema`
  before using it, so a hand-edited or older-schema preset surfaces a
  `DatabaseError` with structured Zod issues instead of producing `NaN`
  limits downstream.

### Added — UI polish

- **Distinct Shortlist tab treatment** — a 3px leading accent bar in
  `primary` (slate navy) + bolder font + right-border separator signals
  the tab as categorically different from the raw per-type tabs. Icon
  is `mdiStarFourPoints` in `primary` tonal harmony with other tab
  labels. Intentionally restrained (Material 3 accent-border pattern +
  clinical-dashboard conventions — signal hierarchy through restraint,
  not color blocks).
- **Proper `@mdi/js` icon imports** across `CaseView.vue`,
  `ShortlistPanel.vue`, and `ShortlistTable.vue`. Fixes the
  `<path> attribute d: Expected number, "mdi-..."` console warnings
  that were surfacing because VarLens uses Vuetify's `mdi-svg` icon set
  (which expects SVG path strings from `@mdi/js`, not `mdi-*` CSS
  class names).
- `data-testid="app-settings-menu"` added to the gear button in the
  top toolbar as a stable E2E testing seam.

### Fixed

- **Singleton preset store** — `useFilterPresetStore` is now a proper
  shared singleton (module-level refs) so `ShortlistPanel` and
  `FilterToolbar` read the same preset list. Previously each consumer
  got a fresh empty store, leaving the shortlist picker perpetually
  blank on cold starts. `useShortlistQuery` also calls
  `loadPresets()` defensively on setup for race-free first render.
- **Concurrent-fetch race guard** in `useShortlistQuery` —
  monotonically increasing request id + active-id tracking ensures a
  slower earlier fetch can't overwrite `result` with stale data when
  preset / case / annotation / refresh events all fire together.
- **`ShortlistQueryError extends DatabaseError`** so Stage-1 failures
  surface as `ErrorCode.DB_ERROR` with a meaningful message in the
  retry banner, not a generic `ErrorCode.UNKNOWN`.
- **`RankScoreTooltip` reactivity** — row list is now a `computed()`
  derived from `props.components` instead of a setup-time const, so
  the tooltip updates when a component instance is reused across
  table re-renders.
- **`ShortlistConfigSchema.perTypeOverrides`** uses `z.partialRecord`
  instead of `z.record`, so presets can specify overrides for a subset
  of variant types without Zod rejecting the missing keys. Fixes the
  Tier 1 preset which only sets sv/cnv/str overrides.

### Changed

- **`docs/` tree is now version-controlled.** Previously the entire
  VitePress docs site was local-only via two broad gitignore rules
  (`.vitepress/` and `docs/public/screenshots/*.png`). Tightened the
  rules to keep only `docs/.vitepress/{dist,cache}/` ignored, and
  added an explicit negation exception for `docs/public/screenshots/*.png`.
  The 29 existing feature-doc screenshots plus the 2 new
  Shortlist-specific ones now ship with the repo so anyone building
  the docs site sees the published images without needing a local
  Playwright + ONT-fixture run.
- **`VariantTable.vue`** — new optional `interactive?: boolean` prop
  (default `true`) gates all seven `onKeyStroke` handlers (ArrowUp /
  ArrowDown / Enter / Escape / s / c / a). `CaseView` sets
  `:interactive="selectedVariantType !== 'shortlist'"` so hidden
  per-type-table keystrokes don't fire while the Shortlist tab is
  active. Zero behavior change when `interactive=true`.
- **Shortlist shown on single-type cases** (previous CHANGELOG
  language said "more than one variant type" — corrected to "at least
  one"). The gating was loosened mid-development after user feedback:
  the Shortlist has two reasons to exist (cross-type comparison AND
  algorithmic ranking), and reason (2) applies even when a case has
  only SNVs.

### Developer / test infrastructure

- **Playwright monkey test** (`tests/e2e/shortlist-monkey.e2e.ts`) —
  env-gated end-to-end exercise of the full Shortlist flow on an
  obfuscated ONT multi-type case: imports 4 VCFs, navigates, asserts
  auto-selection, rotates every preset, hovers the rank-score
  tooltip, toggles star, opens-in-tab, opens `VariantDetailsPanel`,
  then random-walks for 10 steps. All 12 phases pass end-to-end;
  console error log empty.
- **Docs screenshot test** (`tests/e2e/shortlist-docs-screenshots.e2e.ts`)
  — captures the four reference screenshots for the user-facing doc
  and emits bounding-box JSON sidecars so post-run ImageMagick
  annotation is reproducible. Shortlist feature is the first in the
  repo with this pattern.
- Test suite grew from **2719 → 2905 tests** (+186 new across the
  Wave 0-7 rollout plus the review / audit / polish commits).
- Coverage thresholds raised per-file for every new Shortlist module
  (`src/main/services/scoring/**`, `ShortlistService.ts`,
  `shortlist-query.ts`, `src/main/ipc/handlers/shortlist.ts`,
  `useShortlistQuery.ts`, `src/renderer/src/components/shortlist/**`).

Spec: `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`
Plan: `.planning/plans/2026-04-11-unified-shortlist-plan.md`
Scoring reference: `.planning/docs/shortlist-scoring-heuristic.md`
User-facing feature page: `docs/features/shortlist.md`

## [0.55.0] — 2026-04-11

### Added — Multi-variant type support

- **VCF import for SV, CNV, and STR** with auto-detection of caller type (Manta / Sniffles / DELLY / DRAGEN / CNVkit / ExpansionHunter / Straglr) from VCF header lines. Per-caller extension field parsers populate new `variant_sv` / `variant_cnv` / `variant_str` extension tables keyed by `variant_id`.
- **Import-time BED region filter** to restrict a VCF import to a set of regions before rows enter the database. The wizard auto-discovers sibling BED files next to the VCF.
- **Multi-file VCF import wizard** with auto-detection, per-file progress tracking, session-level housekeeping, and a "Continue in Background" affordance for long runs.
- **Variant type tabs** in the case view (SNV/Indel, SV, CNV, STR) with per-type column sets, type-specific detail sections, and auto-hiding of tabs with zero variants of that type.
- **Genome build and variant type selectors** in the cohort view with per-build case counts driving the available scopes.

### Added — Filter, sort, search across all variant types

- **Declarative extension registry** (`VARIANT_EXTENSION_REGISTRY`) shared between the main process and the renderer as a single source of truth for SV/CNV/STR filter and sort columns.
- **Shared `buildBaseWhere` where-clause builder** with scope gating (case / cohort-listing / cohort-burden) used by all three query paths — the case VariantFilterBuilder, cohort CohortSearch, and the burden AssociationDataBuilder.
- **Extension table JOINs and EXISTS predicates** so dotted filter keys like `sv.support`, `cnv.copy_number`, `str.repeat_count` work across all three paths.
- **FTS5 search across variant types** via two new virtual tables (`variant_sv_fts`, `variant_str_fts`, migration v26) and a new `search-clause-emitter` that UNIONs across all present FTS tables while keeping HGVS as a base-table LIKE at the outer combinator.
- **Sortable extension columns** in the variant table via Vuetify dotted-key support plus value getters that read the SELECT projection aliases.
- **`ExtensionColumnFilters` drawer** mounted in case view, cohort filter bar, and burden config panel with lazy per-column metadata loading and auto-hiding of empty type sections.
- **`FilterTypeNarrowingChip`** for feedback when a filter narrows results to a single variant type.
- **New IPC channels**: `variants:columnMeta` and `variants:typesPresent`, both routed through the database worker pool to keep aggregation queries off the main thread.
- **Burden analysis panel** (`AssociationConfigPanel`) migrated to the shared `FilterState` contract for Path 3 UI parity with the case and cohort views.

### Added — Cohort summary rebuild progress

- **Live phase progress** on the cohort summary rebuild indicator. The worker emits three phase events (`variant_summary` / `gene_burden` / `analyze`) between SQL statements; the renderer shows `phase label (i/N)` plus a live elapsed-time counter.
- **Soft ETA** derived from the previously observed rebuild duration, persisted in `localStorage`.
- **Compact shimmer notice** (~26 px, down from ~56 px) with a sweeping highlight band so the motion signal is visible even on empty tables. Honors `prefers-reduced-motion`.

### Changed

- **Optimistic case delete** — the sidebar now removes cases from the list immediately and fires the IPC asynchronously with rollback on failure, so the UI stays responsive during large deletes.
- **Cohort summary schema** — `cohort_variant_summary` and `gene_burden_summary` now group by `variant_type` and `genome_build`, and have a composite primary key reflecting the new grouping.

### Fixed

- **FTS5 trigger naming convention** — rebuild helpers now emit `_fts_`-infixed triggers (`variants_fts_ai` / `au` / `ad`) matching the production schema, preventing silent no-ops after migration.
- **Cohort burden scope** no longer references cohort-summary-only columns (`cohort_frequency`, `carrier_count`, `acmg_best`, `has_star`, `has_comment`) — those are now silently dropped for case / cohort-burden scopes so burden queries don't fail with column-not-found errors.
- **Extension column NULL semantics** — extension filters default to _excluding_ NULLs (opposite of base-column filters) so filtering by `cnv.copy_number` doesn't return cross-type noise from non-CNV rows.
- **Burden panel preset deselection** now correctly clears the derived filter state when you deselect the last impact / AF / CADD preset.
- **Case list pagination offset** is now decremented on optimistic delete (single + batch) so subsequent scroll loads don't skip or duplicate rows.
- **CaseView variant type default** — the SNV/Indel tab is no longer auto-selected for SV-only or CNV-only imports; the first non-empty tab is picked after the type counts resolve.
- **IPC clone of `columnFilters`** now deep-clones via `cloneForIpc` so nested Vue reactive proxies don't trip Electron structured-clone serialization.
- **CNV call classification** — variants with `./.` GT and SV callers emitting sequence ALTs are now correctly detected.

### Performance

- **CI pipeline** — lint (3 min → 1.4 s), test (66 s → 11.6 s), typecheck (8.4 s → 3 s) via cache, concurrency, project split, parallel runs, and path-filtered PR triggers.
- **Release workflow** — single-call artifact upload in publish-release; duplicated lint/typecheck/test dropped and gated on build.yml; native module caching across runs.
- **Cohort rebuild progress reporting** — worker-side `postMessage` events fire between SQL statements with sub-millisecond overhead vs. phases running in hundreds of ms to seconds (effectively zero impact on rebuild time).

### Tests

- **2704 vitest tests** pass (up from ~588 baseline), 17 skipped, zero regressions. Coverage: lines 33.9 → 35.52, functions 21.1 → 22.04, branches 28.0 → 31.42, statements 33.3 → 34.74.
- **7 new Playwright E2E smoke tests** in `tests/e2e/multi-variant-filter.e2e.ts` covering the filter / sort / search flows across SV / CNV / STR extension columns.
- **Synthetic test fixtures** for SV / CNV / STR / sibling BED / multi-file import scenarios.

[0.55.0]: https://github.com/berntpopp/VarLens/compare/v0.54.1...v0.55.0
