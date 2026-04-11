# Changelog

All notable changes to VarLens are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Unified case shortlist** — ranked cross-type variant view per case.
  New "Shortlist" tab appears in CaseView when a case contains more than
  one variant type (SNV/indel + SV/CNV/STR). Three built-in presets
  (Tier 1 candidates / All rare damaging / Recessive candidates) drive a
  two-stage candidate-generation + ranking pipeline. Rows auto-refresh
  when any variant in the same case is annotated. Score components
  tooltip surfaces the per-term breakdown on hover. Hard cap of 500
  rows at the IPC boundary for Electron safety.
  Spec: `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`

### Database

- Migration v27: `filter_presets.kind` discriminator column
  (`'filter' | 'shortlist'`) with a CHECK constraint and a new index.
  Seeds three built-in shortlist presets. Existing rows backfill to
  `'filter'`.

### IPC

- New `variants:shortlist` handler (Zod-validated discriminated union
  params: `presetId | adHocConfig`).
- New `variants:annotationChanged` broadcast from
  `annotations:upsertPerCase` drives same-case shortlist refresh.

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
