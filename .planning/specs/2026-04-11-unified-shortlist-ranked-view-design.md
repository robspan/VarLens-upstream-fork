# Unified case shortlist — ranked cross-type variant view (design)

**Status:** Design approved by user, pending spec review before plan writing
**Date:** 2026-04-11
**Scope:** Phase 1 (read-only shortlist UI) + full Phase 2 data model (IPC prepared for future editor)
**Target branch:** `feature/unified-shortlist` (final single PR)
**Exploration source:** `.planning/docs/unified-variant-view-ranking-exploration.md`
**Related issues:** #125 (flag system, separate spec), #149 (cohort alert system, separate spec)

---

## 1. Overview

VarLens imports SNV/indel, SV, CNV, and STR variants into a single `variants` table (discriminated by `variant_type`) with three extension tables (`variant_sv`, `variant_cnv`, `variant_str`). The CaseView surfaces these as per-type tabs, which forces clinicians to hop between tables when triaging a case. Users want an **aggregated ranked shortlist** spanning all types, driven by configurable filter+score presets, with drill-down back into the per-type views.

This spec delivers that in Phase 1 as a **read-only shortlist tab** with three built-in presets (Tier 1 candidates / All rare damaging / Recessive candidates). The UI is minimal: preset picker + ranked table + per-row drill-down. The backend is fully configured for the Phase 2 editor that follows — IPC accepts both saved presets and ad-hoc configurations.

### Foundational work already landed (v0.55.0)

- `VARIANT_EXTENSION_REGISTRY` (single source of truth for SV/CNV/STR schemas)
- `buildBaseWhere({scope})` (shared filter → SQL translator, used by 3 query paths)
- `buildExtensionJoinClauses` / `buildExtensionExistsClauses` (extension JOIN + WHERE emitters)
- `resolveSortColumn()` (sort key allowlist including extension dotted keys)
- `FilterState.columnFilters: ColumnFiltersParam` wired end-to-end
- Migration v26 with extension FTS tables

The shortlist builds on this foundation — zero changes to any of those modules.

---

## 2. Goals and non-goals

### Goals (Phase 1)

1. Ranked cross-type variant list per case, using a configurable score formula
2. Three built-in shortlist presets covering common clinical workflows
3. Drill-down from shortlist row into `VariantDetailsPanel` (existing) + "View in [type] tab" link
4. Auto-refresh when any variant annotation changes in the same case
5. Display and filter by starred status (`case_variant_annotations.starred`)
6. Top-N hard cap at 500 (Electron IPC safety)
7. IPC surface prepared for Phase 2 editor (`presetId | adHocConfig` discriminated union)
8. Score components tooltip on hover (clinical trust affordance)
9. Vitest snapshot tests per scoring function (CI regression gate on formula changes)

### Non-goals (out-of-scope)

1. **Preset editor UI** — deferred to Phase 2 as a separate spec
2. **Cross-case/cohort shortlist** — deferred to #149 as a separate spec ("alert system for hot variants missing curation")
3. **Multi-meaning flag system** — deferred to #125 as a separate spec
4. **Phenotype ranker (HPO similarity)** — deferred to Phase 4; scorer has the hook
5. **In-shortlist pagination** — topN is the feature; raising topN is the user's lever
6. **Playwright E2E tests** — unit + integration coverage is sufficient for Phase 1
7. **Performance regression gates** — `elapsedMs` is logged for observability, no hard perf assertions
8. **Canonical column abstraction** — tracked separately; scorer uses physical column names

### Success criteria

- New user opens a case with >1 variant type → sees a "Shortlist" tab as the default active tab
- Selecting "Tier 1 candidates" preset shows up to 50 ranked rows with ClinVar P/LP pinned to the top
- Starring a variant in any tab within the same case refreshes the shortlist within one IPC round-trip
- Scoring-module test coverage ≥95% line, ≥90% branch
- Service/handler/composable coverage ≥80% line
- `elapsedMs` telemetry shows p95 shortlist queries under 200ms on the reference case (67 cases, ~83 variants/case average from memory)

---

## 3. Architecture: two-stage retrieval

The shortlist is a **candidate-generation + ranking** pipeline running in the main process, orchestrated by a new `ShortlistService` that composes existing infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│ Renderer: ShortlistTab.vue                              │
│   preset picker → useShortlistQuery(caseId)             │
└────────────────┬────────────────────────────────────────┘
                 │ IPC: variants:shortlist
                 │ payload: discriminated union:
                 │   { caseId, presetId }  OR
                 │   { caseId, adHocConfig }
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Main process: ShortlistService.getShortlist()           │
│                                                          │
│  Stage 1 — candidate generation (SQL)                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ for type in config.variantTypeScope:            │    │
│  │   mergedFilters = merge(config.baseFilters,     │    │
│  │                   config.perTypeOverrides?[t]) │    │
│  │   candidates[t] = queryVariantsByType(          │    │
│  │     caseId, t, mergedFilters,                   │    │
│  │     limit = topN * 4  // safety cap             │    │
│  │   )                                             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  Stage 2 — ranking (pure TypeScript)                    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ for row in [...candidates]:                     │    │
│  │   ext = fetchExtension(row)   // if applicable  │    │
│  │   scored = scoreRow(row, ext, config.rankConfig)│    │
│  │ all.sort(compareScoredRows(tieBreakers))        │    │
│  │ topN = all.slice(0, config.topN)                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  Return: { rows: topN, totalCandidates, elapsedMs }     │
└─────────────────────────────────────────────────────────┘
```

### Rationale for two-stage over SQL CASE scoring

See `.planning/docs/unified-variant-view-ranking-exploration.md` and the brainstorm transcript for full detail. The condensed reasoning:

1. **Every mature variant prioritizer does it this way.** Exomiser, LIRICAL, Phen2Gene, GADO, VIP all compute rank scores in application code over DB-fetched candidates. Exomiser specifically moved away from H2 SQL toward MVStore + Java scoring (`exomiser-core/.../VariantEvaluation.java` branches on `isSymbolic()` for per-SV-type scoring — the exact same shape as VarLens's SNV/SV/CNV/STR problem).
2. **Phase 4 (phenotype ranker) is impossible in pure SQL.** HPO similarity requires a Resnik-style similarity service (LIRICAL pattern).
3. **The 2025 Exomiser paper warns about normalized score biases.** Score formulas iterate; SQL CASE expressions are migration work.
4. **Elasticsearch deprecated `function_score` in favor of `script_score`** (`elastic/elasticsearch#42811`) — the canonical search-ranking precedent for moving from declarative to programmatic scoring.
5. **VarLens scale is modest** (median ~83 variants/case, large cases 1k–2k). better-sqlite3 fetches 10^5 rows in tens of ms; V8 TimSort on 10^4 objects is sub-10ms. Pure-SQL would save nothing measurable.
6. **Testability.** Pure TypeScript `score(row, weights): number` is trivially Vitest snapshot-testable; a SQL CASE expression cannot be unit-tested in isolation.
7. **Existing VarLens precedent.** `AssociationDataBuilder` already uses this exact pattern (SQL fetches rows, JS computes burden scores). Nothing novel.

### New modules

| File | Responsibility |
|---|---|
| `src/shared/types/shortlist.ts` | Shared type contracts: `ShortlistConfig`, `RankComponents`, `RankWeights`, `RankConfig`, `ScoredRow`, `ShortlistResult` |
| `src/main/services/scoring/index.ts` | Public scorer API: `scoreRow()`, `combine()`, `compareScoredRows()`, `mapConsequenceImpact()`, `mapClinvarBoost()` |
| `src/main/services/scoring/score-snv.ts` | Per-type scorer (applies to snv and indel) |
| `src/main/services/scoring/score-sv.ts` | Per-type scorer for SV |
| `src/main/services/scoring/score-cnv.ts` | Per-type scorer for CNV |
| `src/main/services/scoring/score-str.ts` | Per-type scorer for STR |
| `src/main/database/shortlist-query.ts` | Stage 1 helper: `queryVariantsByType()` — pure function composing `VariantFilterBuilder` per type. Row projection includes `is_starred` via LEFT JOIN on `case_variant_annotations` so Stage 2 can populate `rank_starred_pinned` without a second query |
| `src/main/database/ShortlistService.ts` | Orchestrator: composes `FilterPresetRepository`, `shortlist-query`, scoring module |
| `src/main/database/built-in-shortlist-presets.ts` | The three seeded presets |
| `src/main/ipc/handlers/shortlist.ts` | IPC handler `variants:shortlist` (Zod-validated) |
| `src/renderer/src/components/shortlist/ShortlistPanel.vue` | Panel host — preset picker + table + state routing |
| `src/renderer/src/components/shortlist/ShortlistTable.vue` | `v-data-table` specialized for the shortlist column set |
| `src/renderer/src/components/shortlist/RankScoreTooltip.vue` | Hoverable breakdown of `rank_components` |
| `src/renderer/src/composables/useShortlistQuery.ts` | Reactive shortlist fetch + annotation-event subscription |

### Modified existing modules

| File | What changes |
|---|---|
| `src/main/database/migrations.ts` | Add v27 block: `filter_presets.kind` column + seed 3 shortlist presets |
| `src/main/database/createRepositories.ts` | Wire `ShortlistService` into the `DatabaseService` composition |
| `src/main/ipc/handlers/annotations-logic.ts` | Emit `variants:annotationChanged` broadcast from `upsertPerCaseAnnotation` |
| `src/preload/index.ts` | Typed wrappers: `variants.shortlist()` + `variants.onAnnotationChanged()` |
| `src/shared/types/filters.ts` | Extend `FilterState` with optional `shortlist?: ShortlistConfig` |
| `src/shared/types/ipc-schemas.ts` | Add `ShortlistConfigSchema`, `RankConfigSchema`, `GetShortlistParamsSchema` |
| `src/renderer/src/views/CaseView.vue` | Extend `tabItems` computed to insert Shortlist tab when `variantTypes.length > 1`, default-active |
| `src/main/database/FilterPresetRepository.ts` | Extend `FilterPreset` type with `kind: 'filter' \| 'shortlist'`; `rowToPreset()` reads `row.kind`; `createPreset()`/`updatePreset()` accept `kind` (default `'filter'` for back-compat with existing callers) |
| `src/shared/types/filter-presets.ts` | Add `kind` field to `FilterPreset` / `FilterPresetCreate` / `FilterPresetUpdate` interfaces |
| `vitest.config.ts` | Coverage thresholds for new modules (final commit) |

### Modules NOT touched

- `VariantRepository.ts` — used by `shortlist-query.ts` through its existing public interface
- `VariantFilterBuilder.ts` — used as-is through `buildBaseWhere` + `buildExtensionJoinClauses`
- `cohort.ts`, `AssociationDataBuilder.ts` — case-scoped feature, no cohort changes
- `VariantDetailsPanel.vue` — reused unchanged for drill-down

---

## 4. Score engine

The scoring module is pure TypeScript, zero DB dependency, and fully unit-testable. Every decision in the scorer is a test case.

### Core types

```typescript
// src/shared/types/shortlist.ts

export type VariantTypeKey = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/** One score component in [0,1]. NULL input → per-type default, never NaN. */
export interface RankComponents {
  impact: number        // consequence class mapped to [0,1]
  pathogenicity: number // CADD / SV precision / CNV quality / STR disease
  rarity: number        // 1 - min(gnomad_af / 0.01, 1); SV/CNV/STR default 1.0
  clinvar: number       // ClinVar classification boost
  phenotype: number     // hpo_sim_score (Phase 4); always 0 in Phase 1
}

export interface RankWeights {
  impact: number
  pathogenicity: number
  rarity: number
  clinvar: number
  phenotype: number
}

export interface RankConfig {
  weights: RankWeights
  /** Pin ClinVar P/LP to the top of the sort regardless of rank_score. */
  clinvarPinTop?: boolean
  /** Pin starred variants to the top. Overrides clinvarPinTop when both true. */
  pinStarredTop?: boolean
}

export interface ScoredRow {
  rank_score: number             // ∈ [0,1], combine() output
  rank_components: RankComponents
  rank_clinvar_pinned: boolean
  rank_starred_pinned: boolean
}
```

**Invariant: every score component is in [0,1].** Enforced per-type by the scorer functions. `combine()` is a normalized weighted sum, bounded in [0,1] regardless of weight scale.

### The combine primitive

```typescript
// src/main/services/scoring/index.ts

export function combine(components: RankComponents, weights: RankWeights): number {
  const weightSum = weights.impact + weights.pathogenicity + weights.rarity
                  + weights.clinvar + weights.phenotype
  if (weightSum === 0) return 0  // defensive — user zeroed all weights
  const weighted = weights.impact * components.impact
                 + weights.pathogenicity * components.pathogenicity
                 + weights.rarity * components.rarity
                 + weights.clinvar * components.clinvar
                 + weights.phenotype * components.phenotype
  return weighted / weightSum  // normalize to [0,1]
}
```

Self-normalizing: weights need not sum to 1. Phase 2 editor sliders can use any scale.

### Shared helpers

```typescript
// src/main/services/scoring/index.ts

const CONSEQUENCE_IMPACT: Readonly<Record<string, number>> = {
  HIGH: 1.0, MODERATE: 0.66, LOW: 0.33, MODIFIER: 0.0
}
export function mapConsequenceImpact(consequence: string | null): number {
  return consequence == null ? 0 : (CONSEQUENCE_IMPACT[consequence] ?? 0)
}

const CLINVAR_BOOST: Readonly<Record<string, number>> = {
  Pathogenic: 1.0,
  Likely_pathogenic: 0.9,
  'Pathogenic/Likely_pathogenic': 0.95,
  Uncertain_significance: 0.3,
  Likely_benign: 0,
  Benign: 0
}
export function mapClinvarBoost(clinvar: string | null): number {
  return clinvar == null ? 0 : (CLINVAR_BOOST[clinvar] ?? 0)
}

export const ZERO_COMPONENTS: RankComponents = {
  impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0
}
```

### Per-type scorers

```typescript
// src/main/services/scoring/score-snv.ts

/** Applies to both 'snv' and 'indel' variant types. */
export function scoreSnv(row: Variant): RankComponents {
  return {
    impact: mapConsequenceImpact(row.consequence),
    pathogenicity: row.cadd == null ? 0 : Math.min(row.cadd / 40, 1),
    rarity: row.gnomad_af == null
      ? 1
      : Math.max(0, 1 - Math.min(row.gnomad_af / 0.01, 1)),
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

```typescript
// src/main/services/scoring/score-sv.ts

/**
 * SV scoring. NULL defaults reflect current data availability:
 * - No gnomAD-SV frequency source → rarity = 1.0 (assume rare). When Phase
 *   4+ imports SV frequency, this flips to a real computation — code change,
 *   not config change.
 * - Pathogenicity is a proxy: vaf * precision factor.
 */
export function scoreSv(row: Variant, ext: VariantSvExt): RankComponents {
  const precisionFactor = ext.sv_is_precise ? 1.0 : 0.7
  const vaf = ext.vaf ?? 0.5
  return {
    impact: row.sv_length != null && row.sv_length >= 1000 ? 1.0 : 0.66,
    pathogenicity: Math.min(vaf * precisionFactor, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

```typescript
// src/main/services/scoring/score-cnv.ts

export function scoreCnv(row: Variant, ext: VariantCnvExt): RankComponents {
  const cn = ext.copy_number
  const impact = cn == null ? 0
               : cn <= 0 ? 1.0
               : (cn === 1 || cn >= 3) ? 0.66
               : 0
  return {
    impact,
    pathogenicity: ext.copy_number_quality == null
      ? 0
      : Math.min(ext.copy_number_quality / 100, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

```typescript
// src/main/services/scoring/score-str.ts

export function scoreStr(row: Variant, ext: VariantStrExt): RankComponents {
  const statusImpact = ext.str_status === 'pathologic' ? 1.0
                     : ext.str_status === 'intermediate' ? 0.66
                     : 0
  const knownLocus = ext.disease != null && ext.disease.trim() !== ''
  return {
    impact: statusImpact,
    pathogenicity: knownLocus ? 1.0 : 0.5,
    rarity: 1.0,
    clinvar: knownLocus ? 0.9 : mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

### Dispatch

```typescript
// src/main/services/scoring/index.ts

export function scoreRow(
  row: Variant,
  ext: VariantExtensionRow | null,
  config: RankConfig,
  isStarred: boolean
): ScoredRow {
  let components: RankComponents
  try {
    switch (row.variant_type) {
      case 'snv':
      case 'indel':
        components = scoreSnv(row)
        break
      case 'sv':
        components = scoreSv(row, ext as VariantSvExt)
        break
      case 'cnv':
        components = scoreCnv(row, ext as VariantCnvExt)
        break
      case 'str':
        components = scoreStr(row, ext as VariantStrExt)
        break
      default:
        components = ZERO_COMPONENTS
    }
  } catch (e) {
    mainLogger.error(
      `scoreRow failed for variant_type=${row.variant_type} id=${row.id}: ${toError(e).message}`,
      'shortlist.scoreRow'
    )
    components = ZERO_COMPONENTS
  }
  return {
    rank_score: combine(components, config.weights),
    rank_components: components,
    rank_clinvar_pinned: config.clinvarPinTop === true && components.clinvar >= 0.9,
    rank_starred_pinned: config.pinStarredTop === true && isStarred
  }
}
```

### Sort + tie-breaking

```typescript
export function compareScoredRows(
  a: ScoredRow & Variant,
  b: ScoredRow & Variant,
  tieBreakers?: SortItem[]
): number {
  // Starred pin overrides clinvar pin — user curation beats automation
  if (a.rank_starred_pinned !== b.rank_starred_pinned) {
    return a.rank_starred_pinned ? -1 : 1
  }
  if (a.rank_clinvar_pinned !== b.rank_clinvar_pinned) {
    return a.rank_clinvar_pinned ? -1 : 1
  }
  if (a.rank_score !== b.rank_score) return b.rank_score - a.rank_score
  if (tieBreakers != null) {
    for (const tb of tieBreakers) {
      const cmp = compareByKey(a, b, tb.key)
      if (cmp !== 0) return tb.order === 'desc' ? -cmp : cmp
    }
  }
  return a.variant_id - b.variant_id  // stable fallback
}
```

### Design commitments

1. **Score always in [0,1]** — invariant enforced by `combine()` normalization.
2. **NULL defaults are per-type, documented in JSDoc** — not configurable. SV rarity = 1.0 is a deliberate "assume rare" decision until gnomAD-SV lands.
3. **ClinVar pin-to-top is opt-in per preset.** Only "Tier 1 candidates" sets `clinvarPinTop: true`.
4. **Starred pin overrides ClinVar pin** — manual curation beats automatic signals (Exomiser precedent).
5. **`clinvar` remains a weight term even when pinned.** Pinning is a sort partition, not a weight replacement; within the pinned group, clinvar weight still orders P > P/LP > LP.
6. **No cross-type score normalization.** Per-type NULL defaults document the opinion; user tunes weights if they see bias in practice.
7. **Phenotype term reads `row.hpo_sim_score ?? 0`** — zero in Phase 1 because the column is unpopulated; Phase 4 populates it with zero code changes to scorer.
8. **Dispatch is a switch, not a registry.** Four types, hand-tuned biological knowledge per type — no generic plugin pattern.

---

## 5. Data model

### `ShortlistConfig` — the self-contained preset shape

```typescript
// src/shared/types/shortlist.ts

export interface ShortlistConfig {
  /** Omit = all types present in the case. */
  variantTypeScope?: VariantTypeKey[]

  /** Base filters applied to every type before per-type merge. */
  baseFilters: Partial<FilterState>

  /** Per-type filter overrides — shallow merged over baseFilters per type. */
  perTypeOverrides?: Partial<Record<VariantTypeKey, Partial<FilterState>>>

  /** Max rows returned after sort. Hard cap at 500 at Zod layer. */
  topN: number

  /** Applied AFTER rank_score desc — cannot replace rank_score as primary sort. */
  tieBreakers?: SortItem[]

  rankConfig: RankConfig
}
```

### `FilterState` extension (minimal)

```typescript
// src/shared/types/filters.ts

export interface FilterState {
  // ... existing fields unchanged ...

  /**
   * Shortlist configuration. Present only on presets with kind='shortlist'.
   * Undefined on regular filter presets.
   */
  shortlist?: ShortlistConfig
}
```

### Filter merge semantics

Shallow merge per type:

```
effective[type] = {
  ...config.baseFilters,
  ...config.perTypeOverrides?.[type]
}
```

- Scalar fields: last-wins
- Array fields: replaced wholesale (no deep merge)
- Matches the existing `useFilterPresetStore` multi-preset merge pattern

### `filter_presets.kind` discriminator (migration v27)

```sql
ALTER TABLE filter_presets ADD COLUMN kind TEXT NOT NULL DEFAULT 'filter'
  CHECK (kind IN ('filter', 'shortlist'));
CREATE INDEX IF NOT EXISTS idx_filter_presets_kind ON filter_presets(kind);
```

- Existing rows auto-backfill to `'filter'` via DEFAULT
- CHECK constraint fails closed on invalid kind values
- Index keeps preset list queries O(log n) with kind filter

### Migration v27 implementation

Added as a new block in `src/main/database/migrations.ts` after the existing `if (currentVersion < 26)` block:

```typescript
if (currentVersion < 27) {
  db.exec(`
    ALTER TABLE filter_presets ADD COLUMN kind TEXT NOT NULL DEFAULT 'filter'
      CHECK (kind IN ('filter', 'shortlist'));
    CREATE INDEX IF NOT EXISTS idx_filter_presets_kind ON filter_presets(kind);
  `)

  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO filter_presets
      (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
    VALUES (?, ?, ?, 1, 1, ?, 'shortlist', ?, ?)
  `)

  for (const preset of BUILT_IN_SHORTLIST_PRESETS) {
    stmt.run(
      preset.name,
      preset.description,
      JSON.stringify({ shortlist: preset.config }),
      preset.sortOrder,
      now,
      now
    )
  }

  db.exec('PRAGMA user_version = 27')
}
```

### Built-in shortlist presets (seeded in v27)

**1. "Tier 1 candidates" (strict, ClinVar-pinned, starred-pinned)**

```typescript
{
  name: 'Tier 1 candidates',
  description: 'Strict shortlist: rare HIGH/MOD impact, ClinVar P/LP + starred pinned to top.',
  sortOrder: 0,
  config: {
    variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
    topN: 50,
    baseFilters: {
      consequences: ['HIGH', 'MODERATE'],
      clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic'],
      maxGnomadAf: 0.001
    },
    perTypeOverrides: {
      sv:  { maxGnomadAf: 0.01 },
      cnv: { maxGnomadAf: 0.01 },
      str: {}
    },
    rankConfig: {
      weights: { impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0 },
      clinvarPinTop: true,
      pinStarredTop: true
    },
    tieBreakers: [
      { key: 'cadd', order: 'desc' },
      { key: 'chr', order: 'asc' },
      { key: 'pos', order: 'asc' }
    ]
  }
}
```

**2. "All rare damaging" (broad, score-driven)**

```typescript
{
  name: 'All rare damaging',
  description: 'Broad shortlist: any rare HIGH/MOD variant. Score-driven ordering, no pins.',
  sortOrder: 1,
  config: {
    variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
    topN: 200,
    baseFilters: {
      consequences: ['HIGH', 'MODERATE'],
      maxGnomadAf: 0.01,
      minCadd: 15
    },
    rankConfig: {
      weights: { impact: 0.4, pathogenicity: 0.3, rarity: 0.3, clinvar: 0, phenotype: 0 },
      clinvarPinTop: false,
      pinStarredTop: false
    },
    tieBreakers: [{ key: 'cadd', order: 'desc' }]
  }
}
```

**3. "Recessive candidates" (SNV/indel only, inheritance-aware)**

```typescript
{
  name: 'Recessive candidates',
  description: 'SNV/indel only. Homozygous or compound-het inheritance. Rare coding impact.',
  sortOrder: 2,
  config: {
    variantTypeScope: ['snv', 'indel'],
    topN: 100,
    baseFilters: {
      consequences: ['HIGH', 'MODERATE'],
      maxGnomadAf: 0.02,
      inheritanceModes: ['homozygous', 'candidate_compound_het', 'autosomal_recessive']
    },
    rankConfig: {
      weights: { impact: 0.3, pathogenicity: 0.2, rarity: 0.3, clinvar: 0.2, phenotype: 0 },
      clinvarPinTop: false,
      pinStarredTop: false
    },
    tieBreakers: [
      { key: 'gene_symbol', order: 'asc' },
      { key: 'cadd', order: 'desc' }
    ]
  }
}
```

All built-ins reference only fields that already work in `VariantFilterBuilder` — no new filter logic required.

### IPC contract

```typescript
// src/main/ipc/handlers/shortlist.ts (pseudo-code)

type GetShortlistParams =
  | { caseId: number; presetId: number }
  | { caseId: number; adHocConfig: ShortlistConfig }

interface ShortlistResult {
  rows: ShortlistRow[]           // top-N, pre-sorted
  totalCandidates: number        // pre-slice count
  presetUsed: FilterPreset | null
  elapsedMs: number
}

interface ShortlistRow {
  variant_id: number
  variant_type: VariantTypeKey
  chr: string
  pos: number
  gene_symbol: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  is_starred: boolean
  // ... extension-specific display columns (nullable) ...
  rank: number                   // 1-based sorted position
  rank_score: number
  rank_components: RankComponents
  rank_clinvar_pinned: boolean
  rank_starred_pinned: boolean
}
```

### Zod schemas (IPC boundary validation)

```typescript
// src/shared/types/ipc-schemas.ts — additions

export const RankWeightsSchema = z.object({
  impact: z.number().min(0).max(100),
  pathogenicity: z.number().min(0).max(100),
  rarity: z.number().min(0).max(100),
  clinvar: z.number().min(0).max(100),
  phenotype: z.number().min(0).max(100)
})

export const RankConfigSchema = z.object({
  weights: RankWeightsSchema,
  clinvarPinTop: z.boolean().optional(),
  pinStarredTop: z.boolean().optional()
})

export const ShortlistConfigSchema = z.object({
  variantTypeScope: z.array(z.enum(['snv', 'indel', 'sv', 'cnv', 'str'])).optional(),
  baseFilters: FilterStateSchema.partial(),
  perTypeOverrides: z.record(
    z.enum(['snv', 'indel', 'sv', 'cnv', 'str']),
    FilterStateSchema.partial()
  ).optional(),
  topN: z.number().int().min(1).max(500),
  tieBreakers: z.array(SortItemSchema).max(10).optional(),
  rankConfig: RankConfigSchema
})

export const GetShortlistParamsSchema = z.union([
  z.object({
    caseId: z.number().int().positive(),
    presetId: z.number().int().positive()
  }),
  z.object({
    caseId: z.number().int().positive(),
    adHocConfig: ShortlistConfigSchema
  })
])
```

### Design commitments

1. **`ShortlistConfig` is self-contained** — no inheritance from tab-level filter state
2. **`topN` hard cap at 500** — Zod-enforced at the IPC boundary, prevents Electron IPC pathologies (`electron/electron#7286`)
3. **Built-ins use only existing filter fields** — no new filter logic needed
4. **`tieBreakers` is append-only after rank_score** — cannot replace primary sort
5. **Migration v27 is additive** — existing rows backfill to `kind='filter'`, CHECK constraint fails closed on bad kinds
6. **Discriminated-union IPC params** — `presetId | adHocConfig`, no ambiguity

---

## 6. UI layer

### `CaseView.vue` tab integration

```typescript
// Extension to existing tabItems computed (currently ~line 83-97)

const tabItems = computed(() => {
  const counts = typeCounts.value
  const presentTypes = Object.entries(counts).filter(([, c]) => c > 0).map(([t]) => t)
  const snvCount = (counts.snv ?? 0) + (counts.indel ?? 0)

  const items: TabItem[] = []

  // Shortlist tab — prepended when >1 variant type is present
  if (presentTypes.length > 1) {
    items.push({ type: 'shortlist', label: 'Shortlist', count: null, icon: 'mdi-star-circle' })
  }

  items.push({ type: 'snv', label: 'SNV/Indel', count: snvCount })
  if ((counts.sv ?? 0) > 0)  items.push({ type: 'sv',  label: 'SV',  count: counts.sv! })
  if ((counts.cnv ?? 0) > 0) items.push({ type: 'cnv', label: 'CNV', count: counts.cnv! })
  if ((counts.str ?? 0) > 0) items.push({ type: 'str', label: 'STR', count: counts.str! })

  return items
})

const selectedVariantType = ref<string>(tabItems.value[0]?.type ?? 'snv')
```

Template addition:

```vue
<ShortlistPanel
  v-if="selectedVariantType === 'shortlist'"
  :case-id="caseId"
  @open-in-tab="selectedVariantType = $event"
/>
<VariantTable
  v-else
  :case-id="caseId"
  :variant-type="selectedVariantType"
  ...
/>
```

### `ShortlistPanel.vue` structure

```
┌─ ShortlistPanel ────────────────────────────────────────────────────┐
│  Preset: [Tier 1 candidates ▾]   Scored: 847 → top 50   [↻ Refresh] │
├─────────────────────────────────────────────────────────────────────┤
│  (loading)  <v-progress-linear indeterminate />                     │
│             <v-skeleton-loader type="table-row@5" />                │
│                                                                      │
│  (error)    <v-alert type="error">{{ error.message }}</v-alert>     │
│             [Retry]                                                 │
│                                                                      │
│  (empty)    <v-empty-state>                                         │
│               No variants matched the shortlist filters.           │
│             </v-empty-state>                                        │
│                                                                      │
│  (success)  <ShortlistTable :rows="result.rows"                     │
│                             @row-click="openDetails"                │
│                             @open-in-tab="emit('open-in-tab', $event)" │
│                             @toggle-star="toggleStar" />            │
└──────────────────────────────────────────────────────────────────────┘
```

### `ShortlistTable.vue` column set

```typescript
const columns: DataTableHeader[] = [
  { title: '#',        key: 'rank',             width: 60,  sortable: false },
  { title: 'Score',    key: 'rank_score',       width: 90,  sortable: false },
  { title: 'Type',     key: 'variant_type',     width: 80,  sortable: false },
  { title: 'Gene',     key: 'gene_symbol',      width: 140 },
  { title: 'Variant',  key: 'variant_notation', width: 220 },
  { title: 'Impact',   key: 'consequence',      width: 110 },
  { title: 'AF',       key: 'gnomad_af',        width: 90 },
  { title: 'ClinVar',  key: 'clinvar',          width: 130 },
  { title: '★',        key: 'is_starred',       width: 50,  sortable: false },
  { title: '',         key: 'actions',          width: 80,  sortable: false }
]
```

- **`rank_score` non-sortable**: ordering is the point of the shortlist; re-sorting defeats the contract
- **`variant_notation` computed in renderer** from row fields (e.g., `${chr}:${pos} ${ref}>${alt}` for SNV, `${chr}:${pos} ${sv_type} ${sv_length}bp` for SV)
- **`Type` rendered as Vuetify `v-chip`** with per-type semantic color (respects "no surface-variant" rule from CLAUDE.md)
- **Star column**: `mdi-star` filled (primary color) if `is_starred`, else `mdi-star-outline`. Click toggles via existing `annotations:upsertPerCase` IPC
- **Row click**: emits `row-click` → `ShortlistPanel` opens `VariantDetailsPanel` (unchanged)
- **Actions column**: `v-menu` with "View details" and "View in [type] tab" items

### `RankScoreTooltip.vue` — clinical trust affordance

Activated via `v-tooltip` on `rank_score` cell. Shows term-by-term breakdown:

```
Rank score: 0.95
────────────────────
Impact           0.25   (HIGH)
Pathogenicity    0.20   (CADD 32)
Rarity           0.25   (AF 0.0002)
ClinVar          0.25   (Pathogenic)
Phenotype        0.00
────────────────────
Pinned: ClinVar P/LP
```

Pure presentation, reads from `row.rank_components`. No new IPC, no composable logic.

### `useShortlistQuery.ts` composable

```typescript
// src/renderer/src/composables/useShortlistQuery.ts

export function useShortlistQuery(caseId: Ref<number>) {
  const presetStore = useFilterPresetStore()

  const shortlistPresets = computed(() =>
    presetStore.allPresets.filter(p => p.filterJson.shortlist != null)
  )
  const selectedPresetId = ref<number | null>(null)

  const result = ref<ShortlistResult | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function fetch() {
    if (selectedPresetId.value == null) return
    loading.value = true
    error.value = null
    try {
      result.value = await window.api.variants.shortlist({
        caseId: caseId.value,
        presetId: selectedPresetId.value
      })
      logService.info(
        `shortlist loaded: ${result.value.rows.length} rows in ${result.value.elapsedMs}ms`,
        'shortlist.fetch'
      )
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      result.value = null
    } finally {
      loading.value = false
    }
  }

  watch([selectedPresetId, caseId], fetch, { immediate: false })

  watch(shortlistPresets, (presets) => {
    if (selectedPresetId.value == null && presets.length > 0) {
      selectedPresetId.value = presets[0].id
    }
  }, { immediate: true })

  // Auto-refresh on same-case annotation changes
  onMounted(() => {
    const unsubscribe = window.api.variants.onAnnotationChanged((ev) => {
      if (ev.caseId === caseId.value) fetch()
    })
    onUnmounted(unsubscribe)
  })

  return { shortlistPresets, selectedPresetId, result, loading, error, refresh: fetch }
}
```

### Annotation-event broadcast (new infrastructure)

A small but new piece of infrastructure. Wave 1.E adds this end-to-end:

**Main process emitter** (`annotations-logic.ts`):

```typescript
// Inside upsertPerCaseAnnotation, after successful write
BrowserWindow.getAllWindows().forEach(win => {
  if (!win.isDestroyed()) {
    win.webContents.send('variants:annotationChanged', {
      caseId,
      variantId,
      kind: detectKind(annotationUpdates)  // 'star' | 'comment' | 'acmg'
    })
  }
})
```

**Preload wrapper** (`src/preload/index.ts`):

```typescript
variants: {
  // ... existing methods ...
  onAnnotationChanged: (cb: (ev: AnnotationChangeEvent) => void) => {
    const listener = (_event: IpcRendererEvent, ev: AnnotationChangeEvent) => cb(ev)
    ipcRenderer.on('variants:annotationChanged', listener)
    return () => ipcRenderer.off('variants:annotationChanged', listener)
  }
}
```

**Type contract** (`src/shared/types/api.ts`):

```typescript
export interface AnnotationChangeEvent {
  caseId: number
  variantId: number
  kind: 'star' | 'comment' | 'acmg' | 'evidence'
}
```

Adding the emit call requires ONE change in `annotations-logic.ts` (at the `upsertPerCaseAnnotation` success path), not scattered changes across handlers.

### Design commitments

1. **Shortlist tab only shows when `variantTypes.length > 1`** — SNV-only cases are served by the existing SNV tab
2. **`ShortlistTable.vue` is a new component** — NOT an extension of `VariantTable`; the column set divergence makes sharing actively harmful
3. **`rank_score` is non-sortable in the UI** — ranking is the feature
4. **No preset editing in Phase 1** — read-only dropdown
5. **Drill-down reuses `VariantDetailsPanel` unchanged** + tab-switch link
6. **Auto-refresh on same-case annotation changes is mandatory** — broadcast event, not tab-activate
7. **`variant_notation` formatter lives in the renderer** — backend stays data-only

---

## 7. Error handling, observability, security

### Error handling boundaries

**1. Preset resolution failures**

```typescript
const preset = this.presetRepo.getPreset(presetId)
if (preset == null) throw new NotFoundError('FilterPreset', presetId)
if (preset.filterJson.shortlist == null) {
  throw new ValidationError(
    `Preset "${preset.name}" is not a shortlist preset (kind='${preset.kind}')`
  )
}
```

Hard errors on wrong-kind preset — silently returning empty would be clinically misleading.

**2. Per-type query failures**

Stage 1 must abort on any per-type failure, not silently reduce scope:

```typescript
const candidates: Variant[] = []
const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []

for (const type of scope) {
  try {
    const rows = queryVariantsByType(caseId, type, mergedFilters[type], topN * 4)
    candidates.push(...rows)
  } catch (e) {
    queryErrors.push({ type, error: toError(e) })
  }
}

if (queryErrors.length > 0) {
  mainLogger.warn(
    `shortlist query errors: ${queryErrors.map(e => `${e.type}: ${e.error.message}`).join('; ')}`,
    'shortlist.service'
  )
  throw new ShortlistQueryError(
    `Shortlist query failed for ${queryErrors.map(e => e.type).join(', ')}`,
    { cause: queryErrors }
  )
}
```

**3. Scorer malformed input**

Per-row try/catch in `scoreRow()` — logs at error level, returns `ZERO_COMPONENTS` so the row sorts to bottom. Single malformed row must not poison the shortlist.

**4. Zod validation at IPC boundary**

`GetShortlistParamsSchema.safeParse()` in the handler; invalid input returns a typed `ValidationError` with Zod issues serialized.

### Observability

All services use `mainLogger` per CLAUDE.md (never `console.*`). Log sources:

- `shortlist.service` — orchestration (preset lookup, dispatch, assembly)
- `shortlist.query` — Stage 1 per-type queries
- `shortlist.scoreRow` — scorer errors only

Log levels:
- `info` on `getShortlist` success: `{ caseId, presetId | 'adHoc', elapsedMs, rowsIn, rowsOut }`
- `warn` on `queryErrors` collection (before throw)
- `error` on scorer failures / unexpected exceptions

`ShortlistResult.elapsedMs` returned to renderer; composable logs it via `logService.info` on each fetch. This builds real-world performance telemetry without dedicated infrastructure.

### Security

1. **SQL injection surface**: `tieBreakers` sort keys pass through `VariantFilterBuilder.applySort()` which uses the existing `resolveSortColumn()` allowlist — any key not in `BASE_SORTABLE_COLUMNS` or `EXTENSION_SORTABLE_DOTTED_KEYS` is rejected at the SQL composition layer. `ShortlistService` additionally validates each tieBreaker key via `resolveSortColumn()` before forwarding to `applySort()` and throws `ValidationError` on unknown keys (fail-fast rather than silent drop). The Zod schema at the IPC boundary only validates the shape `{key: string, order: 'asc' \| 'desc'}`; key-value validation happens at the service layer to avoid a shared-types → main-process DB module import cycle.
2. **JSON parsing of `filter_presets.filter_json`**: uses existing `FilterPresetRepository.rowToPreset()`. `FilterPresetSchema` in `ipc-schemas.ts` updated to include `shortlist?: ShortlistConfigSchema`; presets validated on read.
3. **Star write path**: reuses existing `annotations:upsertPerCase` IPC — no new write endpoint, no new permission boundary.
4. **IPC payload bounds**: `topN ≤ 500`, `tieBreakers` array length ≤ 10, all enforced at Zod layer.

---

## 8. Testing

### Main-process unit tests (pure, fast, in-process)

| File | What it covers |
|---|---|
| `tests/main/services/scoring/combine.test.ts` | Normalization, boundary cases (all-zero weights, single-term), `score ∈ [0,1]` invariant |
| `tests/main/services/scoring/score-snv.test.ts` | `scoreSnv()` snapshot assertions for fixture rows; NULL handling (no CADD, no AF, no ClinVar); boundary cases |
| `tests/main/services/scoring/score-sv.test.ts` | `scoreSv()` — impact by length, precision/VAF path, rarity=1.0 invariant |
| `tests/main/services/scoring/score-cnv.test.ts` | `scoreCnv()` — copy_number branching (0,1,2,3,>3,NULL), quality normalization |
| `tests/main/services/scoring/score-str.test.ts` | `scoreStr()` — str_status mapping, disease boost, ClinVar fallback |
| `tests/main/services/scoring/compare.test.ts` | `compareScoredRows()` — pin partition order (starred > clinvar > score), tie-breakers, stable fallback |

**Every per-type scorer uses inline snapshot assertions** (`toMatchInlineSnapshot`) so score-formula changes produce human-readable PR diffs. Example:

```typescript
it('snapshots components for a rare pathogenic SNV', () => {
  const row = buildVariantFixture({
    variant_type: 'snv',
    consequence: 'HIGH',
    cadd: 32,
    gnomad_af: 0.0002,
    clinvar: 'Pathogenic'
  })
  expect(scoreSnv(row)).toMatchInlineSnapshot(`
    {
      "impact": 1,
      "pathogenicity": 0.8,
      "rarity": 0.98,
      "clinvar": 1,
      "phenotype": 0
    }
  `)
})
```

### Main-process integration tests

| File | What it covers |
|---|---|
| `tests/main/database/ShortlistService.test.ts` | End-to-end with `:memory:` DB: preset-by-ID, adHoc config, Stage 1 correctness, Stage 2 ranking, topN cap, variantTypeScope narrowing, perTypeOverrides merge, SNV/indel collapse, cross-type ordering, clinvarPinTop effect, pinStarredTop effect, empty result |
| `tests/main/database/shortlist-query.test.ts` | `queryVariantsByType()` isolation: per-type filter composition, `topN*4` safety cap, correct extension JOINs per type |
| `tests/main/ipc/handlers/shortlist.test.ts` | IPC handler: Zod validation, discriminated union params, NotFoundError on bad preset ID, ValidationError on `topN > 500` |
| `tests/main/database/migrations.test.ts` (extend) | v27: `kind` column added, existing presets backfill to `'filter'`, 3 shortlist presets seeded, CHECK constraint rejects invalid kind |
| `tests/main/ipc/handlers/annotations.test.ts` (extend) | `upsertPerCaseAnnotation` emits `variants:annotationChanged` broadcast |

### Renderer tests

| File | What it covers |
|---|---|
| `tests/renderer/composables/useShortlistQuery.test.ts` | Composable lifecycle, auto-refresh on annotation event, loading/error transitions, unsubscribe on unmount |
| `tests/renderer/components/shortlist/ShortlistPanel.test.ts` | State routing: loading, empty, error, populated |
| `tests/renderer/components/shortlist/ShortlistTable.test.ts` | Column set matches spec, star toggle emits IPC, "View in tab" action emits event |
| `tests/renderer/components/shortlist/RankScoreTooltip.test.ts` | Term breakdown render from `rank_components`, "Pinned: ..." line |
| `tests/renderer/views/CaseView.test.ts` (extend) | `tabItems` insertion logic, default active tab when `presentTypes.length > 1` |

### Fixture infrastructure

`tests/fixtures/shortlist/cross-type-variant-fixture.ts` — exports `buildCrossTypeVariantFixture()` returning a deterministic 30-variant set:

- **SNV/indel (10)**: one HIGH rare ClinVar P, one MODERATE rare ClinVar LP, one HIGH rare no-clinvar high-CADD, one LOW common, four moderate distribution, two edge cases (CADD NULL, gnomAD NULL)
- **SV (5)**: one DEL 1kb precise, one DUP 500bp imprecise, one INV precise, one DEL 100kb precise, one breakend imprecise
- **CNV (3)**: one homozygous deletion (CN=0), one heterozygous duplication (CN=3), one ambiguous (CN=1.8, NULL quality)
- **STR (2)**: one pathologic known disease, one intermediate no disease

Each fixture variant has a documented expected rank position under "Tier 1 candidates" so test failures pinpoint the drift.

### Coverage targets (enforced via `vitest.config.ts` in final commit)

| Module | Line | Branch |
|---|---|---|
| `src/main/services/scoring/` | ≥95% | ≥90% |
| `src/main/database/ShortlistService.ts` | ≥85% | ≥80% |
| `src/main/database/shortlist-query.ts` | ≥90% | ≥85% |
| `src/main/ipc/handlers/shortlist.ts` | ≥85% | ≥80% |
| `src/renderer/src/composables/useShortlistQuery.ts` | ≥80% | ≥70% |
| `src/renderer/src/components/shortlist/**` | ≥75% | ≥65% |

### Testing non-goals (explicit)

- No Playwright E2E for the shortlist in Phase 1
- No performance regression assertions (telemetry only)
- No cross-case / cohort shortlist tests (out of scope)
- No flag-system integration tests (defers to #125)
- No phenotype ranker tests (phenotype term is 0 everywhere in Phase 1)

---

## 9. Wave-based parallel rollout

**Target**: one branch (`feature/unified-shortlist`), one PR → `main`, maximum parallelism during execution.

### Dependency graph

```
                   ┌────────────────────────────────┐
                   │ Wave 0: shared types (1 agent) │
                   │ feat(types): shortlist config  │
                   │   + IPC schema contracts       │
                   └──────────────┬─────────────────┘
                                  │
        ┌────────────┬────────────┼────────────┬──────────────┐
        │            │            │            │              │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐  ┌────▼─────┐  ┌─────▼──────┐
   │ W1.A    │  │ W1.B    │  │ W1.C    │  │ W1.D     │  │ W1.E       │
   │ scoring │  │migration│  │shortlist│  │UI leaves │  │annotation  │
   │ module  │  │ v27 +   │  │ -query  │  │ (Table + │  │-event      │
   │         │  │ presets │  │ helper  │  │ Tooltip) │  │broadcast   │
   └────┬────┘  └────┬────┘  └────┬────┘  └────┬─────┘  └─────┬──────┘
        │            │            │            │              │
        └────────────┴─────┬──────┴────────────┘              │
                           │                                   │
                ┌──────────▼──────────┐                        │
                │ Wave 2: ShortlistSvc│                        │
                │ orchestrator (1)    │                        │
                └──────────┬──────────┘                        │
                           │                                   │
                           └─────────────┬─────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Wave 3: IPC handler │
                              │ + preload (1)       │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Wave 4: composable  │
                              │ useShortlistQuery   │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Wave 5: ShortlistPnl│
                              │ composition         │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Wave 6: CaseView    │
                              │ tab wiring          │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Wave 7: coverage +  │
                              │ docs + release      │
                              └─────────────────────┘
```

### Wave commits

| Wave | Commits | Parallel width | Description |
|---|---|---|---|
| **0** | 1 | 1 | Shared types (`src/shared/types/shortlist.ts`, IPC Zod extensions in `ipc-schemas.ts`) |
| **1** | 5 | **5** | Scoring module + migration v27 + query helper + UI leaves + annotation-event broadcast |
| **2** | 1 | 1 | `ShortlistService` orchestrator (depends on W1.A, W1.B, W1.C) |
| **3** | 1 | 1 | `variants:shortlist` IPC handler + preload wrapper |
| **4** | 1 | 1 | `useShortlistQuery` composable |
| **5** | 1 | 1 | `ShortlistPanel` composition |
| **6** | 1 | 1 | `CaseView.vue` tab wiring |
| **7** | 1 | 1 | Coverage thresholds + docs + release notes |

**Total: 12 commits in final linear history.**

### Worktree orchestration

1. Orchestrator ensures `feature/unified-shortlist` is current at each wave's start
2. For parallel waves: dispatches N `Agent({ isolation: "worktree", ... })` calls in a single message
3. Each agent is briefed with explicit authorized file list (non-overlap enforced via brief)
4. Agents run `make ci` in their worktree before reporting complete
5. Orchestrator rebases each completed sub-branch onto `feature/unified-shortlist` (linear history)
6. Orchestrator runs `make ci` on integrated branch as a wave gate
7. Next wave begins only after CI is green
8. Worktrees cleaned up after integration

### File authorization per wave-1 worktree (non-overlap)

| Worktree | Authorized files | Produces |
|---|---|---|
| **W1.A scoring** | `src/main/services/scoring/**`, `tests/main/services/scoring/**` | `feat(scoring): per-type scorers + combine + compareScoredRows` |
| **W1.B migration** | `src/main/database/migrations.ts` (append v27 block), `src/main/database/built-in-shortlist-presets.ts` (new), `tests/main/database/migrations.test.ts` (append v27 tests) | `feat(db): migration v27 + built-in shortlist presets` |
| **W1.C query helper** | `src/main/database/shortlist-query.ts` (new), `tests/main/database/shortlist-query.test.ts` (new) | `feat(db): shortlist-query helper (Stage 1)` |
| **W1.D UI leaves** | `src/renderer/src/components/shortlist/ShortlistTable.vue` (new), `src/renderer/src/components/shortlist/RankScoreTooltip.vue` (new), corresponding tests | `feat(ui): ShortlistTable + RankScoreTooltip components` |
| **W1.E annotation events** | `src/main/ipc/handlers/annotations-logic.ts` (add `emit()` to `upsertPerCaseAnnotation`), `src/preload/index.ts` (add `onAnnotationChanged` wrapper), `src/shared/types/api.ts` (add `AnnotationChangeEvent` type), corresponding tests | `feat(ipc): variants:annotationChanged broadcast` |

### Integration strategy

- **Rebase-based linear history** (not merge commits)
- Each sub-branch rebases onto `feature/unified-shortlist` tip at wave start
- Post-completion: `git rebase --onto feature/unified-shortlist <base> <sub-branch>` then `git merge --ff-only` back
- Each wave produces exactly one new commit on the integration branch (per parallel task)
- Final PR commit list is identical to the wave table (12 commits, topological order)

### Wave gates

- CI must be green before a wave starts and before it completes
- Type errors in shared types are an escalation to a Wave-0 amendment commit
- Merge conflicts are architected out via non-overlapping file authorization — if a conflict occurs, the brief was wrong and the agent is re-dispatched with tighter scope

### Final PR assembly

After Wave 7 completes:
1. `git push origin feature/unified-shortlist`
2. `gh pr create --base main --head feature/unified-shortlist --title "feat: unified case shortlist with cross-type ranking" --body <assembled-from-spec>`
3. PR description references this spec file and links the 12 commits in narrative order

---

## 10. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Scoring formula produces clinically misleading ranks on real cases | **High** | Conservative built-ins (Tier 1 requires ClinVar P/LP OR strict filters); `RankScoreTooltip` surfaces term breakdown; inline snapshot tests regression-gate formula drift |
| 2 | Per-type score magnitude bias (SVs outrank SNVs or vice versa) | Medium | Deliberate: per-type NULL defaults are documented opinions (JSDoc); Phase 2 editor makes tuning cheap |
| 3 | Electron IPC pathology on large payloads (`electron/electron#7286`) | Low (mitigated) | Hard `topN ≤ 500` at Zod layer; narrow display column set; `elapsedMs` telemetry |
| 4 | Annotation-event broadcast infrastructure must be added (doesn't exist) | Low | Verified: single chokepoint at `upsertPerCaseAnnotation`. ~30 lines total across logic + preload + type. Falls into W1.E |
| 5 | Migration v27 collides with future external migration | Low | Additive, backward-compatible (`DEFAULT 'filter'`), CHECK constraint fails closed |
| 6 | Issue #125 (flag system) lands mid-flight → rebase conflicts | Low | Either ordering works: if #125 lands first, shortlist's star column uses flag chips; if shortlist lands first, #125 migrates its star column too |
| 7 | Phase 2 editor finds data model rigid | Low | Discriminated-union IPC params (`presetId | adHocConfig`) mean editor never needs new IPC — just POSTs full config |
| 8 | Test fixture drifts from real-world data | Medium | Fixture documented per-variant with expected rank positions; follow-up adds GIAB-sourced fixture when practical |
| 9 | Worktree merge conflicts despite non-overlap table | Low | Wave-0 type lock + explicit authorization table + agent briefs list prohibited files |
| 10 | Per-type scorer's extension column types don't match runtime row shape | Medium | `VariantExtensionRow` union type in shared types + runtime type checks at scorer dispatch; malformed rows return `ZERO_COMPONENTS` with error log |

---

## 11. Decisions log

Captured from the brainstorm session for reference. These are locked in; changing any of them requires updating this spec.

| # | Decision | Rationale |
|---|---|---|
| 1 | Case-scoped only; cohort deferred to #149 | Different feature shape; cohort alert system is discovery, not ranking |
| 2 | Phase 1 UI + full Phase 2 data model | Ship value now, preserve editor future; no schema churn when editor lands |
| 3 | Tab-based UI (Option 1 from exploration doc) | Additive, matches dynamic `tabItems` pattern, drill-down is intra-view |
| 4 | Default active tab = Shortlist when `variantTypes.length > 1` | Multi-type cases benefit most from cross-type ranking |
| 5 | Approach Y (hybrid SQL filter + JS score) | Exomiser/LIRICAL/VIP precedent; Phase 4 phenotype ranker impossible in SQL; Vitest snapshot testability; scale is modest |
| 6 | Per-type scorer functions, not unified polymorphic | Hand-tuned biological knowledge per type; matches Exomiser's `VariantEvaluation` pattern |
| 7 | Scores always in [0,1] via `combine()` normalization | Weight scale-independent; self-normalizing |
| 8 | No cross-type normalization | Deliberate opinion; per-type NULL defaults document; user tunes if needed |
| 9 | `clinvarPinTop` is opt-in per preset (default off except Tier 1) | Clinical trust: preset expresses intent |
| 10 | `pinStarredTop` overrides `clinvarPinTop` | Manual curation > automatic signal (Exomiser precedent) |
| 11 | Built-in Tier 1 has both pins ON | Workflow-first clinical preset |
| 12 | ClinVar boost scale: P=1.0, LP=0.9, P/LP=0.95 | P = two independent labs at pathogenic, stronger than single-lab P/LP |
| 13 | STR clinvar=0.9 when `disease` non-empty | Near-ClinVar-P for known disease loci |
| 14 | `impact` uses VEP IMPACT only, no SO term boost | Keep simple; CLAUDE.md contract is `consequence` = IMPACT |
| 15 | `tieBreakers` cannot replace rank_score as primary sort | Preserves "shortlist = ranked list" contract |
| 16 | `topN` hard cap at 500 at Zod layer | Electron IPC safety |
| 17 | `ShortlistConfig` self-contained, nested under `FilterState.shortlist` | Clean discrimination; editor can promote filter preset to shortlist preset without schema drift |
| 18 | Migration v27 with `kind` discriminator (not separate table) | One table simpler; CRUD layer unchanged; CHECK constraint fails closed |
| 19 | `ShortlistTable.vue` is a new component, not a `VariantTable` extension | Column set divergence makes sharing harmful |
| 20 | `rank_score` non-sortable in UI | Ranking is the feature |
| 21 | Auto-refresh on same-case annotation changes via broadcast IPC event | Mandatory in Phase 1; not deferred |
| 22 | Starring integration uses current binary `starred`; flag system (#125) separate | One-way coupling; ~40-line follow-up when #125 lands |
| 23 | Wave-based parallel execution, one PR | Parallelism where safe, serialization on dependencies, linear final history |

---

## 12. Open questions deferred to later phases

None blocking Phase 1. Noted for future specs:

1. **Per-type overrides UX** (Phase 2 editor) — tabs per type vs inline scope pickers
2. **Multi-type variant dedupe** — a deletion appearing as both SV and CNV; current implementation ranks both; Phase 2+ may dedupe
3. **Row cap semantics in Phase 2 editor** — if user raises `topN` above 500, how does the Zod cap surface?
4. **Case-level HPO terms storage** — needed for Phase 4 phenotype ranker; probably a new `case_hpo_terms` table or extension of existing case metadata
5. **Diagnostic "why didn't this variant appear?" mode** — Exomiser has it; Phase 2+ feature
6. **`case_import_files` provenance in shortlist row** — users may want to see "which VCF file this came from"; deferred

---

## 13. References

### Scientific literature

- **Jacobsen et al. 2025** — "An optimized variant prioritization process for rare disease diagnostics" ([Genome Medicine](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-025-01546-1))
- **Jacobsen et al. 2022** — "Phenotype-driven approaches to enhance variant prioritization and diagnosis of rare disease" ([Human Mutation](https://onlinelibrary.wiley.com/doi/full/10.1002/humu.24380))
- **Framework to score the effects of structural variants** ([PMC8997355](https://pmc.ncbi.nlm.nih.gov/articles/PMC8997355/))
- **ACMG/AMP variant interpretation guidelines (Richards et al. 2015)**

### Reference implementations

- **Exomiser** — `GeneScorer.calculateCombinedScore`, `VariantEvaluation.variantScore()` branching on `isSymbolic()` ([GitHub](https://github.com/exomiser/Exomiser))
- **LIRICAL** — `GenotypeLikelihoodRatio.java` ([GitHub](https://github.com/TheJacksonLaboratory/LIRICAL))
- **Phen2Gene** — pure-Python scoring in `lib/calculation.py` ([GitHub](https://github.com/WGLab/Phen2Gene))
- **GADO** — Java matrix-vector Z-score in `HpoGenePrioritisation.java` ([GitHub](https://github.com/molgenis/systemsgenetics))
- **VIP (MOLGENIS Variant Interpretation Pipeline)** — user-swappable YAML/JSON decision trees ([GitHub](https://github.com/molgenis/vip))

### Architecture precedents

- **Elasticsearch** — `function_score` → `script_score` deprecation ([#42811](https://github.com/elastic/elasticsearch/issues/42811))
- **Postgres generated columns** — maintainability guidance
- **better-sqlite3 benchmarks** ([docs/benchmark.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/benchmark.md))
- **Electron IPC large-payload behavior** ([#7286](https://github.com/electron/electron/issues/7286))
- **V8 TimSort** ([v8.dev/blog/array-sort](https://v8.dev/blog/array-sort))

### Internal documents

- `.planning/docs/unified-variant-view-ranking-exploration.md` — research track 4 exploration
- `.planning/specs/2026-04-10-multi-variant-filter-sort-search-design.md` — multi-variant foundation (v0.55.0)
- `.planning/plans/2026-04-10-multi-variant-filter-sort-search-plan.md` — 14-task plan (shipped)
- `CLAUDE.md` — project conventions (logger, UI rules, build workflow)

### Related open issues

- **#125** — Multi-meaning star/flag system with colors (separate spec, shortlist integrates via follow-up)
- **#149** — Cohort alert system for 'hot' variants missing tags/ACMG classification (separate spec, case-shortlist dependency)
