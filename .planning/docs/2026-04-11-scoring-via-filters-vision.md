# Scoring via Filters — Vision

**Date:** 2026-04-11
**Status:** Vision document (not a spec, not a plan)
**Triggered by:** v0.56.0 unified-shortlist release + three documented "Phase-1 scoring gaps"
**Supersedes:** `.planning/docs/shortlist-scoring-heuristic.md` §10 (Phase-1 limitations section only — §1-9 of that doc still describe the currently-shipped behavior)

## Why this doc exists

The v0.56.0 Shortlist shipped with three documented Phase-1 limitations in the scoring heuristic:

1. **SV / CNV / STR rarity is a hardcoded `rarityPlaceholder: 1.0`** — no real population-frequency source is wired in.
2. **`inheritanceModes` were silently stripped from the Recessive shortlist preset** because the shared filter translator `buildBaseWhere` (used by `src/main/database/shortlist-query.ts`) doesn't understand inheritance mode — trio/compound-het logic lives only in the Kysely-based `VariantFilterBuilder` and depends on `analysis_group_id` context.
3. **The `phenotype` score component is always zero** — every scorer reads `row.hpo_sim_score ?? 0` and every built-in preset sets `phenotype: 0` because VarLens has no HPO similarity pipeline.

The natural reaction is to file three spec sheets: one for gnomAD-SV wiring, one for inheritance forwarding, one for HPO. That fixes each gap individually but leaves the scoring module's core architectural flaw in place: **it reads raw database columns through a fixed formula**. Every future scoring improvement — structural constraints, allele-context boosts, gene-panel weighting, compound-het priority — would need to be plumbed through the same `extractFeature(row, dimension)` path, adding feature-specific branches to the scorer and new weight-vector fields to every preset.

This document captures a different direction.

## The mental model

**Today.** Scoring is a fixed formula over extracted raw columns.

```
score = sum(weights[dimension] * extractFeature(row, dimension))
        for dimension in [impact, pathogenicity, rarity, clinvar, phenotype]
```

`extractFeature()` is per-dimension and per-variant-type: it reads `row.consequence`, `row.cadd`, `row.gnomad_af`, etc., and returns a `[0, 1]` sub-score. The preset carries a fixed five-dimension weight vector. Adding a new scoring signal means adding a new `extractFeature` branch, a new weight-vector field, and a migration to update every existing preset's weight vector.

**Tomorrow.** Scoring is a weighted composition of filter-predicate matches.

```
score = sum(weights[filterName] * filterMatches(variant, filterName))
        for filterName in preset.scoringFilters
```

The unit of scoring becomes a **named filter predicate** — the same type of object the user already writes when they build a filter in the UI. A variant is tested against every filter the preset names; matches accumulate weight; totals rank the shortlist. The preset carries a list of `{ filter, weight }` pairs — not a five-dimensional vector. Adding a new scoring signal means registering a new filter predicate; existing presets continue to work unchanged.

## Worked example

A **"Severe recessive"** preset might weight three filters:

| Filter predicate           | Weight |
|----------------------------|--------|
| `homozygous`               | +40    |
| `loss_of_function`         | +40    |
| `rare_vs_gnomad (af<0.001)`| +20    |

Three variants scored against this preset:

- **Homozygous stop-gain, gnomAD AF = 0.0001** — matches all three filters → **100 points**
- **Het missense, gnomAD AF = 0.005** — matches zero filters → **0 points**
- **Homozygous missense, gnomAD AF = 0.02** — matches only `homozygous` → **40 points**

The preset reads like the clinical sentence it models: *"a severe recessive candidate is homozygous, loss-of-function, and rare"*. A clinician editing the preset adjusts weights and filter names, not abstract dimension labels.

## Filter audit (2026-04-11)

This section summarises findings from an Agent-tool audit of the current filter-builder code. Full details live in the spec (`2026-04-11-post-0.56.0-cleanup-design.md` §5.4); the table below captures the architectural gaps that motivate the redesign.

| Predicate family          | SNV          | SV            | CNV           | STR           | Blocker                                                                                      |
|---------------------------|--------------|---------------|---------------|---------------|----------------------------------------------------------------------------------------------|
| Gene symbol / consequence | ✅            | ⚠️ partial    | ⚠️ partial    | ⚠️ partial    | annotation-scoped predicates (`starredOnly`, `hasComment`, `acmg`) only surface for SNV via cohort-listing scope |
| Rarity (`gnomad_af_max`)  | ✅ real       | ❌ no column  | ❌ no column  | ❌ no column  | gnomAD-SV/CNV/STR not wired to schema; scoring uses hardcoded `rarityPlaceholder: 1.0`       |
| Inheritance mode          | ⚠️ SNV-only SQL special case | ❌ | ❌           | ❌            | Not a first-class predicate. `VariantFilterBuilder.build()` lines 561-694 bake it into `gt_num` SQL, requires `analysis_group_id`, silently skipped when null |
| Type-specific columns     | —            | ✅ rich        | ✅ rich        | ✅ rich        | Extension tables (`variant_sv`, `variant_cnv`, `variant_str`) expose many type-specific columns but none are composable into score-worthy filter predicates yet |
| FTS5 search               | ✅            | ✅             | ❌            | ✅             | CNV has `hasFts: false`                                                                      |

### Three root causes

1. **Inheritance is imperative SQL, not a filter predicate.** Trio modes live inside `VariantFilterBuilder.build()` as parameterised subqueries that correlate the proband's `gt_num` against parent/sibling genotypes via the `analysis_group_members` table. Moving them into the filter registry is not a copy-paste — it requires reshaping them as filter predicates that any variant type can be tested against, with explicit handling for the "no analysis group" case.

2. **`shortlist-query.ts` → `buildBaseWhere` shares base columns but not the imperative inheritance branch.** The two filter-building paths in the codebase diverged when the shortlist was added: the older Kysely builder understands inheritance and uses `analysis_group_id` context; the newer shared translator was cloned from the base-column parts only. Unifying them requires the inheritance predicate refactor in (1) as a prerequisite.

3. **Preset JSON shapes differ.** Shortlist presets use `ShortlistConfig` (`baseFilters` + `perTypeOverrides` + `rankConfig` with a fixed 5-dimension weight vector). Classic filter presets use flat `FilterState` with `inheritanceModes`, `columnFilters`, `starredOnly`, etc. A unified preset shape that carries a list of `{ filter, weight }` pairs is a prerequisite for the whole redesign.

## Migration path (high-level)

This is a direction, not a schedule. Each bullet is its own future spec when its turn comes.

1. **Lift inheritance mode out of `VariantFilterBuilder.build()` into a named filter predicate** in the filter registry. The predicate takes `analysis_group_id` as context; shortlist queries supply it from the case record. The old SQL branch in `VariantFilterBuilder` stays until callers migrate, then gets deleted.

2. **Wire per-type rarity data sources as filter predicates** — gnomAD-SV first (it unblocks SV and CNV simultaneously), then an STR-specific source. Rarity becomes a filter predicate named `rare_vs_gnomad`, not a scoring column named `rarity`. Scoring reads the filter-match result; the specific AF cutoff is a filter parameter.

3. **Unify preset JSON shapes** so shortlist and classic filter presets share the same `filter[]` array. The `ShortlistConfig.baseFilters` + `perTypeOverrides` shape dissolves into a flat `filters: FilterPredicate[]` plus `scoringFilters: { filter, weight }[]`. A migration rewrites every existing preset in place.

4. **Rewrite the scoring module as a weighted sum over filter-match booleans.** Drop `extractFeature()` and its per-dimension branches. The scorer takes a `ScoredPreset` and a `Variant`, runs each filter predicate against the variant, and sums `weight * matches`. The existing `consequenceImpact` / `clinvarBoost` lookup tables become parameters of filter predicates (`is_high_impact_consequence`, `is_pathogenic_clinvar`).

5. **HPO phenotype becomes a filter predicate** — `phenotype_similar(patient_hpo, gene, threshold)` — not a separate scoring dimension. Prerequisites: a case-level phenotype entry UI and an HPO similarity algorithm (decided in its own spec). The new "HPO-guided" preset weights this predicate positively; existing presets continue to ignore it.

## Explicitly out of scope

This vision doc names a direction. It does NOT decide:

- **Algorithm choice** for HPO similarity (Resnik vs simGIC vs Phenomizer) — decided in the HPO subsystem spec.
- **Data source decisions** for gnomAD-SV (bundled vs downloaded on first launch, file size budget, licensing) — decided in the rarity subsystem spec.
- **Implementation file lists** for any migration step — each step gets its own spec when its turn comes.
- **Timeline or phase assignment** — none of the five migration steps is scheduled here.

## Not a deprecation of v0.56.0 scoring

The current formula-based scorers (`src/main/services/scoring/score-snv.ts`, `score-sv.ts`, `score-cnv.ts`, `score-str.ts` and the shared `scoring-config.ts`) stay in `main` until their replacement lands. This document is a direction, not a deletion. The next scoring subsystem spec — whichever one lands first — is the first commit that actually changes scoring code.

## References

- v0.56.0 spec: `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`
- Current scoring heuristic: `.planning/docs/shortlist-scoring-heuristic.md`
- Post-0.56.0 cleanup spec (source of the filter audit): `.planning/specs/2026-04-11-post-0.56.0-cleanup-design.md` §5.4
- Filter builder: `src/main/database/VariantFilterBuilder.ts:561-694` (inheritance branch)
- Shared filter translator: `src/main/database/shortlist-query.ts` → `buildBaseWhere`
- Built-in shortlist presets: `src/main/database/built-in-shortlist-presets.ts`
- Classic filter preset shape: `src/shared/types/filter-presets.ts`
