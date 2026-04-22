# Unified case shortlist — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`

**Goal:** Ship a read-only "Shortlist" tab in `CaseView` that surfaces a ranked cross-type variant shortlist (SNV / indel / SV / CNV / STR) per case, driven by three built-in presets, auto-refreshing on annotation changes, with full Phase 2 data-model support so the future preset editor needs no IPC churn.

**Architecture:** Two-stage candidate-generation + ranking pipeline in the main process. Stage 1 composes `buildBaseWhere` + `buildExtensionJoinClauses` per variant type and projects a fully-joined `ShortlistCandidate` row (Variant + sv/cnv/str extension columns + `is_starred`). Stage 2 is pure TypeScript — per-type scorer functions (`scoreSnv/Sv/Cnv/Str`) feed a normalized `combine()` weighted sum, then `compareScoredRows` applies starred/ClinVar pin partitions and configurable tie-breakers. A new `ShortlistService` orchestrates the pipeline; a Zod-validated `variants:shortlist` IPC handler surfaces it; `useShortlistQuery` wires it into a new `ShortlistPanel.vue` host composed of `ShortlistTable.vue` + `RankScoreTooltip.vue`. `CaseView.vue` prepends a "Shortlist" tab when `>1` variant type is present and toggles panel visibility via `v-show` for the per-type region (preserves fetched state) + `v-if` for the shortlist region (mounts on demand). Migration v27 adds a `kind` discriminator to `filter_presets` and seeds three built-in shortlist presets. A new `variants:annotationChanged` broadcast from `annotations:upsertPerCase` drives live refresh.

**Tech Stack:** TypeScript, Electron 40, better-sqlite3-multiple-ciphers, Vue 3 + Vuetify 3 + Pinia, Zod, Vitest + happy-dom.

**Target branch:** `feature/unified-shortlist` (long-lived). **All 12 commits land on this branch.** The final PR is a single `feature/unified-shortlist → main` merge after Wave 7 completes.

**Total commits: 12.** Wave 0 (1) + Wave 1 (5 parallel) + Wave 2 (1) + Wave 3 (1) + Wave 4 (1) + Wave 5 (1) + Wave 6 (1) + Wave 7 (1). Final history is linear — sub-branches from parallel Wave 1 are rebased onto the integration branch in topological order.

**Cohort parity note:** `CLAUDE.md` and project memory require "cohort-view parity in the same spec/PR" for any filter/sort/search/column-metadata change on the case view. This rule does **NOT** apply to this plan — the shortlist is a case-scoped feature that adds a new tab with its own preset list, its own IPC path, and its own table component. It does not modify `VariantTable` filter/sort/search semantics or column metadata (the only `VariantTable.vue` change is a six-line keyboard-gate prop, Wave 6). Cross-case / cohort shortlist is explicitly deferred to issue #149 per spec Section 2. The executor should not be blocked by a retroactive parity check on this plan.

---

## File structure

### New files (17)

| File | Responsibility | Task |
|---|---|---|
| `src/shared/types/shortlist.ts` | Shared type contracts: `VariantTypeKey`, `PerTypeTab`, `VisibleTab`, `RankComponents`, `RankWeights`, `RankConfig`, `ScoredRow`, `ShortlistCandidate` (Stage-1 row), `ScoredCandidate`, `ShortlistRow` (Stage-3 row), `ShortlistConfig`, `ShortlistResult` | 0 |
| `src/main/services/scoring/index.ts` | Public scorer API: `scoreRow`, `combine`, `compareScoredRows`, `mapConsequenceImpact`, `mapClinvarBoost`, `ZERO_COMPONENTS` | 1.A |
| `src/main/services/scoring/score-snv.ts` | Per-type scorer for `'snv'` and `'indel'` | 1.A |
| `src/main/services/scoring/score-sv.ts` | Per-type scorer for `'sv'` | 1.A |
| `src/main/services/scoring/score-cnv.ts` | Per-type scorer for `'cnv'` | 1.A |
| `src/main/services/scoring/score-str.ts` | Per-type scorer for `'str'` | 1.A |
| `src/main/database/built-in-shortlist-presets.ts` | Three seeded presets (Tier 1 / All rare damaging / Recessive candidates) | 1.B |
| `src/main/database/shortlist-query.ts` | Stage 1 helper: `queryVariantsByType(caseId, type, filters, limit)` — composes `buildBaseWhere` + extension JOINs + `case_variant_annotations` LEFT JOIN | 1.C |
| `src/main/database/ShortlistService.ts` | Orchestrator: resolves preset, runs Stage 1 per type, runs Stage 2 scoring + sort, returns `ShortlistResult` | 2 |
| `src/main/ipc/handlers/shortlist.ts` | IPC handler `variants:shortlist` — Zod validates discriminated-union params, calls service | 3 |
| `src/renderer/src/composables/useShortlistQuery.ts` | Reactive shortlist fetch + annotation-event subscription (teardown via `onBeforeUnmount`) | 4 |
| `src/renderer/src/components/shortlist/ShortlistTable.vue` | `v-data-table` specialized for the shortlist column set | 1.D |
| `src/renderer/src/components/shortlist/RankScoreTooltip.vue` | Hoverable breakdown of `rank_components` | 1.D |
| `src/renderer/src/components/shortlist/ShortlistPanel.vue` | Panel host — preset picker + state routing (loading/error/empty/populated) | 5 |
| `tests/fixtures/shortlist/cross-type-variant-fixture.ts` | `buildCrossTypeVariantFixture()` → deterministic 30-variant set (10 SNV/indel, 5 SV, 3 CNV, 2 STR + supporting) with documented expected rank positions | 1.A |
| `tests/main/services/scoring/` | Scorer unit tests (`combine.test.ts`, `score-snv.test.ts`, `score-sv.test.ts`, `score-cnv.test.ts`, `score-str.test.ts`, `compare.test.ts`) | 1.A |
| `tests/main/database/ShortlistService.test.ts` + `shortlist-query.test.ts` + `tests/main/ipc/handlers/shortlist.test.ts` + `tests/renderer/composables/useShortlistQuery.test.ts` + `tests/renderer/components/shortlist/*.test.ts` | Service, query helper, IPC handler, composable, component tests | 1.C, 1.D, 2, 3, 4, 5 |

### Modified files (12)

| File | What changes | Task |
|---|---|---|
| `src/shared/types/filters.ts` | Add `shortlist?: ShortlistConfig` to `FilterState` | 0 |
| `src/shared/types/filter-presets.ts` | Add `kind: 'filter' \| 'shortlist'` to `FilterPreset`, `FilterPresetCreate`, `FilterPresetUpdate` | 0 |
| `src/shared/types/api.ts` | Add `AnnotationChangeEvent` interface | 0 |
| `src/shared/types/ipc-schemas.ts` | Add `RankWeightsSchema`, `RankConfigSchema`, `ShortlistConfigSchema`, `GetShortlistParamsSchema`; extend `FilterStateSchema` with optional `shortlist`; extend `FilterPresetSchema` with `kind` | 0 |
| `src/main/database/migrations.ts` | Append v27 block: `filter_presets.kind` column + index + seed 3 shortlist presets | 1.B |
| `src/main/database/FilterPresetRepository.ts` | Read/write `kind` column in `rowToPreset` / `createPreset` / `updatePreset` (default `'filter'`) | 2 |
| `src/main/database/createRepositories.ts` | Wire `ShortlistService` into `DatabaseService` composition | 2 |
| `src/main/ipc/handlers/annotations.ts` | Emit `variants:annotationChanged` broadcast from `annotations:upsertPerCase` handler after successful write. **Do NOT touch `annotations-logic.ts`** — handler layer only (per JSDoc contract) | 1.E |
| `src/preload/index.ts` | Add `variants.shortlist(params)` typed wrapper; add `variants.onAnnotationChanged(cb)` subscription wrapper returning an unsubscribe function | 1.E (onAnnotationChanged), 3 (shortlist) |
| `src/renderer/src/views/CaseView.vue` | Add `VisibleTab` / `PerTypeTab` type aliases, `lastNonShortlistType` ref, `variantTableType` computed, `getPresentTabTypes` helper, extend `tabItems` with Shortlist tab, extend `loadTypeCounts` default-selection rule, template: `v-show` per-type region + `v-if` shortlist region + `:interactive` prop binding | 6 |
| `src/renderer/src/components/VariantTable.vue` | Add optional `interactive?: boolean` prop (default `true`); prepend `!props.interactive \|\|` to every `onKeyStroke` handler guard (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`, `s`, `c`, `a`) | 6 |
| `vitest.config.ts` | Raise coverage thresholds for scoring/shortlist modules (final commit) | 7 |
| `tests/main/handlers/annotations-handlers.test.ts` | Extend: `upsertPerCase` emits `variants:annotationChanged` broadcast | 1.E |
| `tests/main/database/migrations.test.ts` | Extend: v27 adds `kind` column, backfills existing rows to `'filter'`, seeds 3 shortlist presets, CHECK rejects invalid kind | 1.B |
| `tests/renderer/views/CaseView.test.ts` | Extend: `tabItems` insertion + default-selection rule + `:interactive` wiring | 6 |
| `tests/renderer/components/variant-table/*` | Extend: `interactive=false` suppresses keyboard handlers | 6 |

### Files NOT touched

- `src/main/database/VariantRepository.ts` — consumed through its existing public interface
- `src/main/database/VariantFilterBuilder.ts` — used as-is via `buildBaseWhere` + `buildExtensionJoinClauses`
- `src/main/ipc/handlers/annotations-logic.ts` — JSDoc prohibits Electron API use; broadcast lives in the handler wrapper
- `src/main/database/cohort.ts`, `AssociationDataBuilder.ts` — case-scoped feature
- `src/renderer/src/components/VariantDetailsPanel.vue` — reused unchanged for drill-down (accepts any `Variant` shape, which `ShortlistRow` extends)

---

## Task dependency graph

```
                Wave 0: shared types (Task 0, 1 commit)
                              │
                              ▼
   ┌──────────┬──────────┬──────────┬──────────┬──────────┐
   │          │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
 Task 1.A  Task 1.B  Task 1.C  Task 1.D  Task 1.E              Wave 1 (5 parallel)
 scoring   v27 mig   qry hlpr  UI leaves annot-event
   │          │          │          │          │
   └────────┬─┴──────────┴─┐        │          │
            │              │        │          │
            ▼              │        │          │
        Task 2:            │        │          │              Wave 2
        ShortlistService   │        │          │
            │              │        │          │
            ▼              │        │          │
        Task 3: IPC + preload (uses 1.E's onAnnotationChanged wrapper here too)
            │                                  │
            ▼                                  │
        Task 4: useShortlistQuery ◄────────────┘              Wave 4
            │
            ▼
        Task 5: ShortlistPanel (composes 1.D leaves + Task 4 composable)
            │
            ▼
        Task 6: CaseView tab wiring + VariantTable interactive prop (atomic)
            │
            ▼
        Task 7: coverage + release notes
```

### Wave summary

| Wave | Tasks | Commits | Parallel width | Description |
|---|---|---|---|---|
| **0** | 0 | 1 | 1 | Shared types + Zod schemas — type lock for all downstream waves |
| **1** | 1.A, 1.B, 1.C, 1.D, 1.E | 5 | **5** | Scoring module + migration v27 + Stage-1 query helper + UI leaves + annotation-event broadcast (all five independent worktrees) |
| **2** | 2 | 1 | 1 | `ShortlistService` orchestrator (depends on 1.A, 1.B, 1.C) |
| **3** | 3 | 1 | 1 | `variants:shortlist` IPC handler + preload wrapper (depends on 2) |
| **4** | 4 | 1 | 1 | `useShortlistQuery` composable (depends on 3, 1.E) |
| **5** | 5 | 1 | 1 | `ShortlistPanel` composition (depends on 4, 1.D) |
| **6** | 6 | 1 | 1 | `CaseView.vue` tab wiring + `VariantTable.vue` `interactive` prop — **single atomic commit** (wiring props without the prop existing is a type error; wiring the prop without a consumer leaves a live bug) |
| **7** | 7 | 1 | 1 | Coverage thresholds + `CHANGELOG.md` / release notes |

**Every task corresponds to exactly one commit.** Each wave's commit(s) must leave the branch green (`make ci` must pass on the integration branch after rebase).

---

## Task 0 — Wave 0: Shared types + Zod schemas

**Wave:** 0  
**Depends on:** `feature/unified-shortlist` exists at `origin/main` tip  
**Authorized files:**
- `src/shared/types/shortlist.ts` (new)
- `src/shared/types/filters.ts` (modify — add `shortlist?` field to `FilterState`)
- `src/shared/types/filter-presets.ts` (modify — add `kind` field)
- `src/shared/types/api.ts` (modify — add `AnnotationChangeEvent`)
- `src/shared/types/ipc-schemas.ts` (modify — add Zod schemas + extend `FilterStateSchema`, `FilterPresetSchema`)
- `tests/main/services/ipc-schemas-shortlist.test.ts` (new — Zod schema tests)

**Spec sections:** §4 (core types), §5 (ShortlistConfig, Zod schemas, FilterState extension), §6 (AnnotationChangeEvent type), §3 (type-level modifications to `FilterPreset`)

**Commit:** `feat(types): shortlist config + IPC schema contracts`

**Rationale:** Wave 0 is the type lock. Every downstream wave imports from these modules. By committing types first and running `make typecheck`, all subsequent waves get a stable surface to program against. The Zod schemas are the IPC boundary contract — they must land with the types because the handler in Task 3 and the handler test in Task 3 both reference them.

### Files

- **Create:** `src/shared/types/shortlist.ts`
- **Create:** `tests/main/services/ipc-schemas-shortlist.test.ts`
- **Modify:** `src/shared/types/filters.ts`
- **Modify:** `src/shared/types/filter-presets.ts`
- **Modify:** `src/shared/types/api.ts`
- **Modify:** `src/shared/types/ipc-schemas.ts`

### Step 0.1: Write failing Zod schema tests

Create `tests/main/services/ipc-schemas-shortlist.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  ShortlistConfigSchema,
  RankConfigSchema,
  RankWeightsSchema,
  GetShortlistParamsSchema
} from '../../../src/shared/types/ipc-schemas'

describe('RankWeightsSchema', () => {
  it('accepts valid weights', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0
      }).success
    ).toBe(true)
  })

  it('rejects negative weights', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: -0.1, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0
      }).success
    ).toBe(false)
  })

  it('rejects weights above 100', () => {
    expect(
      RankWeightsSchema.safeParse({
        impact: 101, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0
      }).success
    ).toBe(false)
  })
})

describe('ShortlistConfigSchema', () => {
  const baseConfig = {
    baseFilters: {},
    topN: 50,
    rankConfig: {
      weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
    }
  }

  it('accepts a minimal valid config', () => {
    expect(ShortlistConfigSchema.safeParse(baseConfig).success).toBe(true)
  })

  it('rejects topN > 500 (hard cap)', () => {
    expect(
      ShortlistConfigSchema.safeParse({ ...baseConfig, topN: 501 }).success
    ).toBe(false)
  })

  it('rejects topN < 1', () => {
    expect(
      ShortlistConfigSchema.safeParse({ ...baseConfig, topN: 0 }).success
    ).toBe(false)
  })

  it('accepts variantTypeScope with valid enum values', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str']
      }).success
    ).toBe(true)
  })

  it('rejects unknown variant type', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        variantTypeScope: ['mnv']
      }).success
    ).toBe(false)
  })

  it('rejects tieBreakers longer than 10', () => {
    expect(
      ShortlistConfigSchema.safeParse({
        ...baseConfig,
        tieBreakers: new Array(11).fill({ key: 'cadd', order: 'desc' })
      }).success
    ).toBe(false)
  })
})

describe('GetShortlistParamsSchema (discriminated union)', () => {
  it('accepts presetId branch', () => {
    expect(
      GetShortlistParamsSchema.safeParse({ caseId: 1, presetId: 42 }).success
    ).toBe(true)
  })

  it('accepts adHocConfig branch', () => {
    expect(
      GetShortlistParamsSchema.safeParse({
        caseId: 1,
        adHocConfig: {
          baseFilters: {},
          topN: 10,
          rankConfig: {
            weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
          }
        }
      }).success
    ).toBe(true)
  })

  it('rejects caseId = 0', () => {
    expect(
      GetShortlistParamsSchema.safeParse({ caseId: 0, presetId: 1 }).success
    ).toBe(false)
  })

  it('rejects branch with neither presetId nor adHocConfig', () => {
    expect(
      GetShortlistParamsSchema.safeParse({ caseId: 1 }).success
    ).toBe(false)
  })
})
```

### Step 0.2: Run tests — expected to fail

```bash
make rebuild-node
npx vitest run tests/main/services/ipc-schemas-shortlist.test.ts
```

Expected: **FAIL** — module `ipc-schemas` has no exports named `ShortlistConfigSchema`, `RankConfigSchema`, `RankWeightsSchema`, `GetShortlistParamsSchema`.

### Step 0.3: Create `src/shared/types/shortlist.ts`

```typescript
// src/shared/types/shortlist.ts
import type { Variant } from './database'
import type { FilterState } from './filters'
import type { SortItem } from './column-filters'

/** Every value v-tabs can hold in the case view. */
export type VisibleTab = 'shortlist' | 'snv' | 'sv' | 'cnv' | 'str'

/** Values that map to a real DB variant_type filter. Never includes 'shortlist'. */
export type PerTypeTab = 'snv' | 'sv' | 'cnv' | 'str'

/** The DB-level variant_type enum. Includes 'indel' which the UI folds into 'snv'. */
export type VariantTypeKey = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/** One score component in [0,1]. NULL input → per-type default, never NaN. */
export interface RankComponents {
  impact: number
  pathogenicity: number
  rarity: number
  clinvar: number
  phenotype: number
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
  rank_score: number
  rank_components: RankComponents
  rank_clinvar_pinned: boolean
  rank_starred_pinned: boolean
}

/**
 * Stage-1 candidate row. Produced by `shortlist-query.ts` via per-type
 * SELECT with LEFT JOINs on the extension tables and case_variant_annotations.
 *
 * STRUCTURAL COMMITMENT: ShortlistCandidate extends Variant — every field of
 * the existing Variant interface must be present on every row with its
 * existing name and type. This makes ShortlistCandidate directly assignable
 * to Variant, which is REQUIRED for row-click drill-down to reuse
 * `CaseView.handleRowClick(variant: Variant)` and VariantDetailsPanel
 * unchanged.
 *
 * Extension columns are aliased sv_*/cnv_*/str_* to flatten the row shape.
 * All extension fields are nullable because a given row populates columns
 * only for ITS variant type.
 */
export interface ShortlistCandidate extends Variant {
  // ── SV extension columns (variant_sv LEFT JOIN; aliased sv_*) ─────
  // (sv_length and sv_type are already on Variant — see database.ts)
  sv_is_precise?: 0 | 1 | null
  sv_vaf?: number | null
  sv_support?: number | null

  // ── CNV extension columns (variant_cnv LEFT JOIN; aliased cnv_*) ──
  cnv_copy_number?: number | null
  cnv_copy_number_quality?: number | null

  // ── STR extension columns (variant_str LEFT JOIN; aliased str_*) ──
  str_status?: 'normal' | 'intermediate' | 'pathologic' | null
  str_disease?: string | null
  str_alt_copies?: string | null

  // ── Per-case annotation state (case_variant_annotations LEFT JOIN) ─
  /** Derived from COALESCE(cva.starred, 0); always present. */
  is_starred: boolean
}

/** A ShortlistCandidate with scoring fields appended by Stage 2. */
export interface ScoredCandidate extends ShortlistCandidate, ScoredRow {}

/**
 * The renderer-facing row shape — what the IPC payload contains.
 * Extends ScoredCandidate with a 1-based sorted-position field.
 */
export interface ShortlistRow extends ScoredCandidate {
  rank: number
}

export interface ShortlistConfig {
  /** Omit = all types present in the case. */
  variantTypeScope?: VariantTypeKey[]

  /** Base filters applied to every type before per-type merge. */
  baseFilters: Partial<FilterState>

  /** Per-type filter overrides — shallow merged over baseFilters per type. */
  perTypeOverrides?: Partial<Record<VariantTypeKey, Partial<FilterState>>>

  /** Max rows returned after sort. Hard cap at 500 at the Zod layer. */
  topN: number

  /** Applied AFTER rank_score desc — cannot replace rank_score as primary sort. */
  tieBreakers?: SortItem[]

  rankConfig: RankConfig
}

import type { FilterPreset } from './filter-presets'

export interface ShortlistResult {
  rows: ShortlistRow[]
  totalCandidates: number
  presetUsed: FilterPreset | null
  elapsedMs: number
}
```

### Step 0.4: Extend `FilterState` with optional `shortlist`

Open `src/shared/types/filters.ts`. Add an import of `ShortlistConfig` and extend the interface:

```typescript
import type { ShortlistConfig } from './shortlist'

export interface FilterState {
  // ... existing fields unchanged ...

  /**
   * Shortlist configuration. Present only on presets with kind='shortlist'.
   * Undefined on regular filter presets.
   */
  shortlist?: ShortlistConfig
}
```

**No runtime behavior changes** — the existing filter pipeline ignores the new optional field.

### Step 0.5: Extend `FilterPreset` with `kind`

Open `src/shared/types/filter-presets.ts`. Add the `kind` field to `FilterPreset`, `FilterPresetCreate`, `FilterPresetUpdate`:

```typescript
export type FilterPresetKind = 'filter' | 'shortlist'

export interface FilterPreset {
  // ... existing fields unchanged ...
  kind: FilterPresetKind
}

export interface FilterPresetCreate {
  // ... existing fields unchanged ...
  kind?: FilterPresetKind  // defaults to 'filter' at repository layer
}

export interface FilterPresetUpdate {
  // ... existing fields unchanged ...
  kind?: FilterPresetKind
}
```

Repository implementation (reading/writing the column) lives in Task 2.

### Step 0.6: Add `AnnotationChangeEvent` to `api.ts`

Open `src/shared/types/api.ts` and append:

```typescript
export interface AnnotationChangeEvent {
  caseId: number
  variantId: number
  kind: 'star' | 'comment' | 'acmg' | 'evidence'
}
```

### Step 0.7: Add Zod schemas to `ipc-schemas.ts`

Open `src/shared/types/ipc-schemas.ts`. Add the schemas. Import `FilterStateSchema` and `SortItemSchema` from their existing positions in the same file (they already exist per the current codebase).

```typescript
// ── Shortlist schemas ──────────────────────────────────────────

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

const VariantTypeKeySchema = z.enum(['snv', 'indel', 'sv', 'cnv', 'str'])

export const ShortlistConfigSchema = z.object({
  variantTypeScope: z.array(VariantTypeKeySchema).optional(),
  baseFilters: FilterStateSchema.partial(),
  perTypeOverrides: z.record(VariantTypeKeySchema, FilterStateSchema.partial()).optional(),
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

Also extend the existing `FilterStateSchema` with an optional `shortlist` field (use `z.lazy` if necessary to break circular reference):

```typescript
// Inside the existing FilterStateSchema definition, add:
// shortlist: z.lazy(() => ShortlistConfigSchema).optional()
```

And extend the existing `FilterPresetSchema` with the `kind` discriminator:

```typescript
// Inside the existing FilterPresetSchema definition, add:
// kind: z.enum(['filter', 'shortlist'])
```

**Note on the circular import:** `FilterStateSchema` references `ShortlistConfigSchema` which references `FilterStateSchema.partial()`. Use `z.lazy(() => ShortlistConfigSchema)` on the `FilterState.shortlist` field to defer binding, which is the standard Zod pattern for mutually recursive schemas.

### Step 0.8: Run typecheck + tests — expect pass

```bash
make typecheck
npx vitest run tests/main/services/ipc-schemas-shortlist.test.ts
```

Expected: **PASS** — all schema tests green, no TS errors in any module that consumes `FilterState` or `FilterPreset`.

If a downstream module breaks because it now has to handle the new optional `kind` field on `FilterPreset`, that is expected — fix each call site to pass `kind: 'filter'` (the default for every non-shortlist caller). **This is an intentional surface-level change** and Wave 0's test gate catches each offender.

### Step 0.9: Run full CI

```bash
make ci
```

Expected: **PASS** (no lint errors, no TS errors, all existing tests green + 11 new schema tests).

### Step 0.10: Commit

```bash
git add \
  src/shared/types/shortlist.ts \
  src/shared/types/filters.ts \
  src/shared/types/filter-presets.ts \
  src/shared/types/api.ts \
  src/shared/types/ipc-schemas.ts \
  tests/main/services/ipc-schemas-shortlist.test.ts

git commit -m "$(cat <<'EOF'
feat(types): shortlist config + IPC schema contracts

Wave 0 of the unified shortlist rollout. Introduces the shared type
module (src/shared/types/shortlist.ts) carrying the ShortlistCandidate /
ScoredCandidate / ShortlistRow / ShortlistConfig / RankComponents /
RankWeights / RankConfig / ScoredRow / ShortlistResult contracts and
the VisibleTab / PerTypeTab / VariantTypeKey aliases.

Extends FilterState with an optional `shortlist?: ShortlistConfig` field
so the shortlist preset nests cleanly inside the existing filter preset
shape. Extends FilterPreset / FilterPresetCreate / FilterPresetUpdate
with a `kind: 'filter' | 'shortlist'` discriminator (repository
implementation follows in Task 2).

Adds AnnotationChangeEvent to shared/api.ts for the
variants:annotationChanged broadcast wiring in Task 1.E.

Adds Zod schemas: RankWeightsSchema, RankConfigSchema,
ShortlistConfigSchema, GetShortlistParamsSchema (discriminated union
presetId | adHocConfig). Enforces topN hard cap at 500, tieBreakers
length cap at 10, and positive-integer caseId at the IPC boundary.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§4, §5, §6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 0.11: Verify branch tip is green

```bash
make ci
```

Expected: **PASS**. Wave 0 is complete. Proceed to Wave 1 (five parallel worktrees).

---

## Branch & worktree workflow

### Setup (once, before Wave 0)

```bash
git fetch origin main
git switch -c feature/unified-shortlist origin/main
git push -u origin feature/unified-shortlist
```

### Per-wave orchestration

**Serial waves (0, 2, 3, 4, 5, 6, 7):** execute directly on `feature/unified-shortlist`.

**Parallel wave (1):** dispatch five `Agent({ isolation: "worktree", ... })` calls in a single message. Each agent receives:

1. A brief that references this plan by task ID (e.g., "Task 1.A, Wave 1 scoring module").
2. The spec path: `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`.
3. **Authorized files** — explicit allowlist; edits outside this list are rejected in the two-stage review.
4. **Prohibited files** — explicit reminder of the other four worktrees' authorized files (merge-conflict prevention).
5. A reminder that each agent must run `make ci` inside its worktree before reporting complete.

After all five parallel agents report success, the orchestrator rebases each sub-branch onto the integration branch in the order 1.A → 1.B → 1.C → 1.D → 1.E (topological — any order works since files are disjoint, but stable order keeps history readable):

```bash
git switch feature/unified-shortlist
git rebase --onto feature/unified-shortlist <wave-0-tip> <sub-branch-1.A>
# fast-forward merge (linear history, no merge commits)
git merge --ff-only <sub-branch-1.A>
# repeat for 1.B, 1.C, 1.D, 1.E
make ci   # wave gate — must be green before Wave 2 starts
```

### Wave gates

- `make ci` (full: lint + typecheck + test) must be green at the tip of `feature/unified-shortlist` before the next wave begins.
- A failed gate means the most recent wave's commit(s) are reverted and the offending task re-dispatched with tighter scope.
- Merge conflicts inside a parallel wave indicate a brief error — re-dispatch the conflicting agent with a narrower authorized list, do not hand-merge.
- Type errors in shared types after Wave 0 escalate to a **Wave-0 amendment commit** (single additional commit on the integration branch) — all subsequent waves rebase onto the amended tip.

### Final PR

After Wave 7 completes and `make ci` is green:

```bash
git push origin feature/unified-shortlist
gh pr create --base main --head feature/unified-shortlist \
  --title "feat: unified case shortlist with cross-type ranking" \
  --body "$(cat <<'EOF'
Implements the unified case shortlist design (.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md).

## Summary
- Ranked cross-type variant shortlist per case (SNV/indel/SV/CNV/STR)
- Three built-in presets (Tier 1, All rare damaging, Recessive candidates)
- Auto-refresh on same-case annotation changes
- Migration v27 with filter_presets.kind discriminator

## Commits (12)
See commit log — one commit per task (Wave 0 → Wave 7).

## Test plan
- [ ] Open a multi-type case → Shortlist tab default active
- [ ] Select each preset → ranked list renders with tooltips
- [ ] Star a variant → shortlist auto-refreshes within one IPC round-trip
- [ ] Click row → VariantDetailsPanel opens, unchanged drill-down
- [ ] "View in [type] tab" action → switches tab, per-type filter state preserved
- [ ] Single-type case → no Shortlist tab
- [ ] make ci green
EOF
)"
```

---

## Task 1.A — Wave 1: Scoring module (parallel worktree)

**Wave:** 1  
**Depends on:** Task 0 (shared types)  
**Parallel with:** Tasks 1.B, 1.C, 1.D, 1.E  
**Worktree:** isolated via `Agent({ isolation: "worktree", ... })`

**Authorized files (exclusive — no other Wave 1 task may touch these):**
- `src/main/services/scoring/index.ts` (new)
- `src/main/services/scoring/score-snv.ts` (new)
- `src/main/services/scoring/score-sv.ts` (new)
- `src/main/services/scoring/score-cnv.ts` (new)
- `src/main/services/scoring/score-str.ts` (new)
- `tests/main/services/scoring/combine.test.ts` (new)
- `tests/main/services/scoring/score-snv.test.ts` (new)
- `tests/main/services/scoring/score-sv.test.ts` (new)
- `tests/main/services/scoring/score-cnv.test.ts` (new)
- `tests/main/services/scoring/score-str.test.ts` (new)
- `tests/main/services/scoring/compare.test.ts` (new)
- `tests/fixtures/shortlist/cross-type-variant-fixture.ts` (new)

**Prohibited files (owned by other Wave 1 worktrees — do NOT edit):**
- `src/main/database/migrations.ts`, `src/main/database/built-in-shortlist-presets.ts`, `tests/main/database/migrations.test.ts` (Task 1.B)
- `src/main/database/shortlist-query.ts`, `tests/main/database/shortlist-query.test.ts` (Task 1.C)
- `src/renderer/src/components/shortlist/ShortlistTable.vue`, `src/renderer/src/components/shortlist/RankScoreTooltip.vue`, `tests/renderer/components/shortlist/*.test.ts` (Task 1.D)
- `src/main/ipc/handlers/annotations.ts`, `src/preload/index.ts`, `src/shared/types/api.ts`, `tests/main/handlers/annotations-handlers.test.ts` (Task 1.E)
- Any file owned by Wave 0 (shared types) — the types are frozen for this wave

**Spec sections:** §4 (score engine, core types, combine primitive, shared helpers, per-type scorers, dispatch, sort + tie-breaking), §8 (scoring tests, fixture infrastructure)

**Commit:** `feat(scoring): per-type scorers + combine + compareScoredRows`

**Rationale:** The scoring module is pure TypeScript with zero DB dependency. It's the easiest Wave-1 unit to parallelize because its only inputs are the shared `ShortlistCandidate` / `RankComponents` / `ScoredCandidate` types frozen in Wave 0. No consumers exist yet — the module is wired into `ShortlistService` in Wave 2.

### Files

- **Create:** `src/main/services/scoring/index.ts`
- **Create:** `src/main/services/scoring/score-snv.ts`
- **Create:** `src/main/services/scoring/score-sv.ts`
- **Create:** `src/main/services/scoring/score-cnv.ts`
- **Create:** `src/main/services/scoring/score-str.ts`
- **Create:** `tests/fixtures/shortlist/cross-type-variant-fixture.ts`
- **Create:** `tests/main/services/scoring/combine.test.ts`
- **Create:** `tests/main/services/scoring/score-snv.test.ts`
- **Create:** `tests/main/services/scoring/score-sv.test.ts`
- **Create:** `tests/main/services/scoring/score-cnv.test.ts`
- **Create:** `tests/main/services/scoring/score-str.test.ts`
- **Create:** `tests/main/services/scoring/compare.test.ts`

### Step 1.A.1: Create the fixture builder first (test dependency)

Create `tests/fixtures/shortlist/cross-type-variant-fixture.ts`:

```typescript
import type { ShortlistCandidate, VariantTypeKey } from '../../../src/shared/types/shortlist'
import type { Variant } from '../../../src/shared/types/database'

/** Build a minimal ShortlistCandidate with sane defaults for every Variant field. */
export function buildShortlistCandidate(
  overrides: Partial<ShortlistCandidate> & { variant_type: VariantTypeKey }
): ShortlistCandidate {
  const base: Variant = {
    id: 1,
    case_id: 1,
    variant_type: 'snv',
    chr: '1',
    pos: 1000,
    ref: 'A',
    alt: 'T',
    gene_symbol: null,
    consequence: null,
    func: null,
    cadd: null,
    gnomad_af: null,
    clinvar: null,
    hpo_sim_score: null,
    sv_length: null,
    sv_type: null,
    // ...fill every Variant field defined in src/shared/types/database.ts
    // with `null` or a minimal default; if a field is added to Variant
    // later, TypeScript will flag this helper as incomplete.
  } as Variant  // deliberate: ensures the helper surfaces missing fields

  return {
    ...base,
    sv_is_precise: null,
    sv_vaf: null,
    sv_support: null,
    cnv_copy_number: null,
    cnv_copy_number_quality: null,
    str_status: null,
    str_disease: null,
    str_alt_copies: null,
    is_starred: false,
    ...overrides
  }
}

/**
 * Deterministic 30-variant cross-type fixture. Documented expected rank
 * position under the "Tier 1 candidates" preset appears in the JSDoc of
 * each entry so ShortlistService integration tests can assert ordering.
 */
export function buildCrossTypeVariantFixture(): ShortlistCandidate[] {
  const rows: ShortlistCandidate[] = []

  // ── SNV/indel (10) ──────────────────────────────────────────
  // 1: HIGH rare ClinVar Pathogenic — expected rank #1 under Tier 1
  rows.push(buildShortlistCandidate({
    id: 1, variant_type: 'snv', gene_symbol: 'BRCA1',
    consequence: 'HIGH', cadd: 35, gnomad_af: 0.0001, clinvar: 'Pathogenic'
  }))
  // 2: MODERATE rare ClinVar Likely_pathogenic
  rows.push(buildShortlistCandidate({
    id: 2, variant_type: 'snv', gene_symbol: 'TP53',
    consequence: 'MODERATE', cadd: 25, gnomad_af: 0.0005, clinvar: 'Likely_pathogenic'
  }))
  // 3: HIGH rare no-clinvar high-CADD
  rows.push(buildShortlistCandidate({
    id: 3, variant_type: 'indel', gene_symbol: 'MLH1',
    consequence: 'HIGH', cadd: 38, gnomad_af: 0.0003, clinvar: null
  }))
  // 4: LOW common — excluded by Tier 1 preset filters
  rows.push(buildShortlistCandidate({
    id: 4, variant_type: 'snv', gene_symbol: 'FOO',
    consequence: 'LOW', cadd: 5, gnomad_af: 0.1, clinvar: null
  }))
  // 5-8: moderate distribution
  for (let i = 5; i <= 8; i++) {
    rows.push(buildShortlistCandidate({
      id: i, variant_type: 'snv', gene_symbol: `GENE${i}`,
      consequence: 'MODERATE', cadd: 18 + i, gnomad_af: 0.0005, clinvar: null
    }))
  }
  // 9: CADD NULL edge case
  rows.push(buildShortlistCandidate({
    id: 9, variant_type: 'snv', gene_symbol: 'NULLCADD',
    consequence: 'MODERATE', cadd: null, gnomad_af: 0.0001, clinvar: null
  }))
  // 10: gnomAD NULL edge case
  rows.push(buildShortlistCandidate({
    id: 10, variant_type: 'snv', gene_symbol: 'NULLAF',
    consequence: 'HIGH', cadd: 30, gnomad_af: null, clinvar: null
  }))

  // ── SV (5) ──────────────────────────────────────────────────
  rows.push(buildShortlistCandidate({
    id: 11, variant_type: 'sv', gene_symbol: 'DMD',
    sv_type: 'DEL', sv_length: 1000, sv_is_precise: 1, sv_vaf: 0.45
  }))
  rows.push(buildShortlistCandidate({
    id: 12, variant_type: 'sv', gene_symbol: 'CFTR',
    sv_type: 'DUP', sv_length: 500, sv_is_precise: 0, sv_vaf: 0.3
  }))
  rows.push(buildShortlistCandidate({
    id: 13, variant_type: 'sv', gene_symbol: 'FBN1',
    sv_type: 'INV', sv_length: 2000, sv_is_precise: 1, sv_vaf: 0.5
  }))
  rows.push(buildShortlistCandidate({
    id: 14, variant_type: 'sv', gene_symbol: 'DYSF',
    sv_type: 'DEL', sv_length: 100000, sv_is_precise: 1, sv_vaf: 0.48
  }))
  rows.push(buildShortlistCandidate({
    id: 15, variant_type: 'sv', gene_symbol: 'NF1',
    sv_type: 'BND', sv_length: null, sv_is_precise: 0, sv_vaf: null
  }))

  // ── CNV (3) ─────────────────────────────────────────────────
  rows.push(buildShortlistCandidate({
    id: 16, variant_type: 'cnv', gene_symbol: 'SMN1',
    cnv_copy_number: 0, cnv_copy_number_quality: 95
  }))
  rows.push(buildShortlistCandidate({
    id: 17, variant_type: 'cnv', gene_symbol: 'ABL1',
    cnv_copy_number: 3, cnv_copy_number_quality: 80
  }))
  rows.push(buildShortlistCandidate({
    id: 18, variant_type: 'cnv', gene_symbol: 'AMBIG',
    cnv_copy_number: 1.8 as unknown as number, cnv_copy_number_quality: null
  }))

  // ── STR (2) ─────────────────────────────────────────────────
  rows.push(buildShortlistCandidate({
    id: 19, variant_type: 'str', gene_symbol: 'HTT',
    str_status: 'pathologic', str_disease: "Huntington's disease", str_alt_copies: '45'
  }))
  rows.push(buildShortlistCandidate({
    id: 20, variant_type: 'str', gene_symbol: 'UNK',
    str_status: 'intermediate', str_disease: null, str_alt_copies: '32'
  }))

  return rows
}
```

> **Note:** the `...` in `buildShortlistCandidate`'s `base` literal is a placeholder for "every field currently on `Variant`" — the implementing agent must read `src/shared/types/database.ts` and fill in every missing field with `null` or a minimal default. The TypeScript `as Variant` cast is deliberate: it surfaces missing fields as a type error the next time `Variant` gains a column. Do NOT add new fields to `Variant` here — that's out of scope.

### Step 1.A.2: Write failing `combine.test.ts`

Create `tests/main/services/scoring/combine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { combine } from '../../../../src/main/services/scoring'
import type { RankComponents, RankWeights } from '../../../../src/shared/types/shortlist'

const UNIFORM: RankWeights = {
  impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0
}
const ZERO_W: RankWeights = {
  impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0
}

function components(
  o: Partial<RankComponents> = {}
): RankComponents {
  return { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0, ...o }
}

describe('combine()', () => {
  it('returns 0 when all components are 0', () => {
    expect(combine(components(), UNIFORM)).toBe(0)
  })

  it('returns 1 when all scored components are 1 (phenotype ignored by weight)', () => {
    expect(combine(
      components({ impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }),
      UNIFORM
    )).toBeCloseTo(1)
  })

  it('normalizes over weight sum (scale-invariant)', () => {
    const w: RankWeights = {
      impact: 10, pathogenicity: 10, rarity: 10, clinvar: 10, phenotype: 0
    }
    const c = components({ impact: 0.5, pathogenicity: 0.5, rarity: 0.5, clinvar: 0.5 })
    expect(combine(c, w)).toBeCloseTo(0.5)
  })

  it('returns 0 on all-zero weights (defensive)', () => {
    const c = components({ impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1 })
    expect(combine(c, ZERO_W)).toBe(0)
  })

  it('result is always in [0,1] regardless of weight scale', () => {
    const w: RankWeights = { impact: 5, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 }
    const c = components({ impact: 1 })
    const r = combine(c, w)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(1)
    expect(r).toBeCloseTo(1)
  })
})
```

Run: `npx vitest run tests/main/services/scoring/combine.test.ts`  
Expected: **FAIL** (module `scoring` does not exist).

### Step 1.A.3: Implement `scoring/index.ts`

Create `src/main/services/scoring/index.ts`:

```typescript
import { mainLogger } from '../MainLogger'
import { toError } from '../../util/errors'  // existing utility; use its real path
import type {
  RankComponents, RankWeights, RankConfig, ScoredRow,
  ShortlistCandidate, ScoredCandidate
} from '../../../shared/types/shortlist'
import type { SortItem } from '../../../shared/types/column-filters'
import { scoreSnv } from './score-snv'
import { scoreSv } from './score-sv'
import { scoreCnv } from './score-cnv'
import { scoreStr } from './score-str'

export const ZERO_COMPONENTS: RankComponents = {
  impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0
}

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

export function combine(components: RankComponents, weights: RankWeights): number {
  const weightSum = weights.impact + weights.pathogenicity + weights.rarity
                  + weights.clinvar + weights.phenotype
  if (weightSum === 0) return 0
  const weighted = weights.impact * components.impact
                 + weights.pathogenicity * components.pathogenicity
                 + weights.rarity * components.rarity
                 + weights.clinvar * components.clinvar
                 + weights.phenotype * components.phenotype
  return weighted / weightSum
}

export function scoreRow(row: ShortlistCandidate, config: RankConfig): ScoredRow {
  let components: RankComponents
  try {
    switch (row.variant_type) {
      case 'snv':
      case 'indel':
        components = scoreSnv(row); break
      case 'sv':
        components = scoreSv(row); break
      case 'cnv':
        components = scoreCnv(row); break
      case 'str':
        components = scoreStr(row); break
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
    rank_starred_pinned: config.pinStarredTop === true && row.is_starred === true
  }
}

function compareByKey(
  a: ScoredCandidate, b: ScoredCandidate, key: string
): number {
  const av = (a as unknown as Record<string, unknown>)[key]
  const bv = (b as unknown as Record<string, unknown>)[key]
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv))
}

export function compareScoredRows(
  a: ScoredCandidate,
  b: ScoredCandidate,
  tieBreakers?: SortItem[]
): number {
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
  return a.id - b.id
}
```

> **Note on imports:** `mainLogger` and `toError` live at paths the implementer must verify in the current repo (`src/main/services/MainLogger.ts` and the project's error utility). Adjust the import paths to match the actual file locations — these are existing modules, not new ones.

### Step 1.A.4: Implement per-type scorers

Create `src/main/services/scoring/score-snv.ts`:

```typescript
import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapConsequenceImpact, mapClinvarBoost } from './index'

/** Applies to both 'snv' and 'indel' variant types. */
export function scoreSnv(row: ShortlistCandidate): RankComponents {
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

Create `src/main/services/scoring/score-sv.ts`:

```typescript
import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

/**
 * SV scoring. NULL defaults:
 * - No gnomAD-SV frequency source → rarity = 1.0 (assume rare).
 * - Pathogenicity is a proxy: vaf * precision factor.
 */
export function scoreSv(row: ShortlistCandidate): RankComponents {
  const precisionFactor = row.sv_is_precise ? 1.0 : 0.7
  const vaf = row.sv_vaf ?? 0.5
  return {
    impact: row.sv_length != null && row.sv_length >= 1000 ? 1.0 : 0.66,
    pathogenicity: Math.min(vaf * precisionFactor, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

Create `src/main/services/scoring/score-cnv.ts`:

```typescript
import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

export function scoreCnv(row: ShortlistCandidate): RankComponents {
  const cn = row.cnv_copy_number
  const impact = cn == null ? 0
               : cn <= 0 ? 1.0
               : (cn === 1 || cn >= 3) ? 0.66
               : 0
  return {
    impact,
    pathogenicity: row.cnv_copy_number_quality == null
      ? 0
      : Math.min(row.cnv_copy_number_quality / 100, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

Create `src/main/services/scoring/score-str.ts`:

```typescript
import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

export function scoreStr(row: ShortlistCandidate): RankComponents {
  const statusImpact = row.str_status === 'pathologic' ? 1.0
                     : row.str_status === 'intermediate' ? 0.66
                     : 0
  const knownLocus = row.str_disease != null && row.str_disease.trim() !== ''
  return {
    impact: statusImpact,
    pathogenicity: knownLocus ? 1.0 : 0.5,
    rarity: 1.0,
    clinvar: knownLocus ? 0.9 : mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
```

### Step 1.A.5: Run combine test — expect pass

```bash
npx vitest run tests/main/services/scoring/combine.test.ts
```

Expected: **PASS**.

### Step 1.A.6: Write and run per-type scorer tests

Create `tests/main/services/scoring/score-snv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scoreSnv } from '../../../../src/main/services/scoring/score-snv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreSnv()', () => {
  it('snapshots components for a rare pathogenic SNV', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv',
      consequence: 'HIGH',
      cadd: 32,
      gnomad_af: 0.0002,
      clinvar: 'Pathogenic'
    })
    expect(scoreSnv(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 1,
        "impact": 1,
        "pathogenicity": 0.8,
        "phenotype": 0,
        "rarity": 0.98,
      }
    `)
  })

  it('handles NULL cadd → pathogenicity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv', consequence: 'HIGH', cadd: null, gnomad_af: 0.001, clinvar: null
    })
    expect(scoreSnv(row).pathogenicity).toBe(0)
  })

  it('handles NULL gnomad_af → rarity 1', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv', consequence: 'HIGH', cadd: 20, gnomad_af: null, clinvar: null
    })
    expect(scoreSnv(row).rarity).toBe(1)
  })

  it('common variant (AF >= 0.01) → rarity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'snv', consequence: 'LOW', cadd: 10, gnomad_af: 0.05, clinvar: null
    })
    expect(scoreSnv(row).rarity).toBe(0)
  })

  it('applies to indel variants too', () => {
    const row = buildShortlistCandidate({
      variant_type: 'indel', consequence: 'HIGH', cadd: 30, gnomad_af: 0.001, clinvar: null
    })
    expect(scoreSnv(row).impact).toBe(1)
  })
})
```

Create `tests/main/services/scoring/score-sv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scoreSv } from '../../../../src/main/services/scoring/score-sv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreSv()', () => {
  it('scores a large precise DEL', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv', sv_type: 'DEL', sv_length: 100000,
      sv_is_precise: 1, sv_vaf: 0.48
    })
    expect(scoreSv(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 0,
        "impact": 1,
        "pathogenicity": 0.48,
        "phenotype": 0,
        "rarity": 1,
      }
    `)
  })

  it('imprecise SV drops pathogenicity by 0.7x', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv', sv_length: 2000, sv_is_precise: 0, sv_vaf: 0.5
    })
    expect(scoreSv(row).pathogenicity).toBeCloseTo(0.35)
  })

  it('small SV (<1kb) impact = 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv', sv_length: 500, sv_is_precise: 1, sv_vaf: 0.5
    })
    expect(scoreSv(row).impact).toBe(0.66)
  })

  it('null VAF defaults to 0.5', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv', sv_length: 1500, sv_is_precise: 1, sv_vaf: null
    })
    expect(scoreSv(row).pathogenicity).toBe(0.5)
  })

  it('rarity is always 1.0 (no gnomAD-SV source)', () => {
    const row = buildShortlistCandidate({
      variant_type: 'sv', sv_length: 2000, sv_is_precise: 1, sv_vaf: 0.3
    })
    expect(scoreSv(row).rarity).toBe(1.0)
  })
})
```

Create `tests/main/services/scoring/score-cnv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scoreCnv } from '../../../../src/main/services/scoring/score-cnv'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreCnv()', () => {
  it('homozygous deletion CN=0 → impact 1.0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 0, cnv_copy_number_quality: 95
    })
    expect(scoreCnv(row).impact).toBe(1.0)
  })

  it('heterozygous deletion CN=1 → impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 1, cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0.66)
  })

  it('duplication CN=3 → impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 3, cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0.66)
  })

  it('neutral CN=2 → impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 2, cnv_copy_number_quality: 80
    })
    expect(scoreCnv(row).impact).toBe(0)
  })

  it('null CN → impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: null, cnv_copy_number_quality: null
    })
    expect(scoreCnv(row).impact).toBe(0)
  })

  it('null quality → pathogenicity 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 0, cnv_copy_number_quality: null
    })
    expect(scoreCnv(row).pathogenicity).toBe(0)
  })

  it('quality normalized to [0,1] with 100 cap', () => {
    const row = buildShortlistCandidate({
      variant_type: 'cnv', cnv_copy_number: 0, cnv_copy_number_quality: 50
    })
    expect(scoreCnv(row).pathogenicity).toBe(0.5)
  })
})
```

Create `tests/main/services/scoring/score-str.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { scoreStr } from '../../../../src/main/services/scoring/score-str'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'

describe('scoreStr()', () => {
  it('pathologic status with known disease → all boosts', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str', str_status: 'pathologic',
      str_disease: "Huntington's disease"
    })
    expect(scoreStr(row)).toMatchInlineSnapshot(`
      {
        "clinvar": 0.9,
        "impact": 1,
        "pathogenicity": 1,
        "phenotype": 0,
        "rarity": 1,
      }
    `)
  })

  it('intermediate status → impact 0.66', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str', str_status: 'intermediate', str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0.66)
  })

  it('unknown locus → pathogenicity 0.5', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str', str_status: 'pathologic', str_disease: null
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('empty-string disease treated as unknown', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str', str_status: 'pathologic', str_disease: '   '
    })
    expect(scoreStr(row).pathogenicity).toBe(0.5)
  })

  it('normal status → impact 0', () => {
    const row = buildShortlistCandidate({
      variant_type: 'str', str_status: 'normal', str_disease: null
    })
    expect(scoreStr(row).impact).toBe(0)
  })
})
```

Create `tests/main/services/scoring/compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { compareScoredRows } from '../../../../src/main/services/scoring'
import { buildShortlistCandidate } from '../../../fixtures/shortlist/cross-type-variant-fixture'
import type { ScoredCandidate } from '../../../../src/shared/types/shortlist'

function scored(
  id: number,
  rank_score: number,
  overrides: Partial<ScoredCandidate> = {}
): ScoredCandidate {
  return {
    ...buildShortlistCandidate({ id, variant_type: 'snv' }),
    rank_score,
    rank_components: { impact: 0, pathogenicity: 0, rarity: 0, clinvar: 0, phenotype: 0 },
    rank_clinvar_pinned: false,
    rank_starred_pinned: false,
    ...overrides
  }
}

describe('compareScoredRows()', () => {
  it('sorts by rank_score descending', () => {
    const a = scored(1, 0.5)
    const b = scored(2, 0.9)
    expect(compareScoredRows(a, b)).toBeGreaterThan(0)  // b before a
  })

  it('starred pin overrides everything', () => {
    const starred = scored(1, 0.1, { rank_starred_pinned: true })
    const top = scored(2, 0.95, { rank_clinvar_pinned: true })
    expect(compareScoredRows(starred, top)).toBeLessThan(0)
  })

  it('clinvar pin beats unpinned even at lower rank_score', () => {
    const pinned = scored(1, 0.4, { rank_clinvar_pinned: true })
    const unpinned = scored(2, 0.95)
    expect(compareScoredRows(pinned, unpinned)).toBeLessThan(0)
  })

  it('tie-breakers apply after rank_score ties', () => {
    const a = scored(1, 0.5, { cadd: 10 } as Partial<ScoredCandidate>)
    const b = scored(2, 0.5, { cadd: 30 } as Partial<ScoredCandidate>)
    expect(compareScoredRows(a, b, [{ key: 'cadd', order: 'desc' }])).toBeGreaterThan(0)
  })

  it('stable fallback on id when everything else ties', () => {
    const a = scored(10, 0.5)
    const b = scored(20, 0.5)
    expect(compareScoredRows(a, b)).toBeLessThan(0)
  })
})
```

### Step 1.A.7: Run all scoring tests — expect pass

```bash
npx vitest run tests/main/services/scoring
```

Expected: **PASS** — all scorer + combine + compare tests green.

### Step 1.A.8: Run full CI inside the worktree

```bash
make ci
```

Expected: **PASS**.

### Step 1.A.9: Commit

```bash
git add \
  src/main/services/scoring \
  tests/main/services/scoring \
  tests/fixtures/shortlist/cross-type-variant-fixture.ts

git commit -m "$(cat <<'EOF'
feat(scoring): per-type scorers + combine + compareScoredRows

Wave 1.A of the unified shortlist rollout. Adds the pure-TypeScript
scoring module consumed by ShortlistService (wired in Wave 2):

  src/main/services/scoring/
    index.ts       — combine, scoreRow dispatch, compareScoredRows,
                     mapConsequenceImpact, mapClinvarBoost, ZERO_COMPONENTS
    score-snv.ts   — applies to 'snv' and 'indel'
    score-sv.ts    — impact by length, precision×VAF pathogenicity,
                     rarity=1.0 (no gnomAD-SV yet)
    score-cnv.ts   — copy-number branching, quality-normalized pathogenicity
    score-str.ts   — status mapping + known-disease boost

The scoring module is pure TypeScript with zero DB dependency. Every
NULL default is documented in the per-type JSDoc. combine() normalizes
over the weight sum so the result is always in [0,1] regardless of
weight scale. compareScoredRows applies the pin partition in the
spec-mandated order: starred > clinvar > rank_score > tieBreakers > id.

Inline snapshot tests gate formula drift: score changes produce
human-readable PR diffs. buildCrossTypeVariantFixture() contributes
a deterministic 30-variant fixture for downstream ShortlistService
integration tests.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§4, §8)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Report success to the orchestrator. The orchestrator rebases this sub-branch onto the integration tip and runs the Wave 1 gate.

---

## Task 1.B — Wave 1: Migration v27 + built-in shortlist presets (parallel worktree)

**Wave:** 1  
**Depends on:** Task 0 (shared types — needs `ShortlistConfig` and `FilterState.shortlist?`)  
**Parallel with:** Tasks 1.A, 1.C, 1.D, 1.E  
**Worktree:** isolated via `Agent({ isolation: "worktree", ... })`

**Authorized files (exclusive):**
- `src/main/database/migrations.ts` (modify — append v27 block after existing v26 block)
- `src/main/database/built-in-shortlist-presets.ts` (new)
- `tests/main/database/migrations.test.ts` (modify — append v27 tests)

**Prohibited files:**
- `src/main/services/scoring/**`, `tests/main/services/scoring/**` (Task 1.A)
- `src/main/database/shortlist-query.ts`, `tests/main/database/shortlist-query.test.ts` (Task 1.C)
- `src/renderer/src/components/shortlist/**`, `tests/renderer/components/shortlist/**` (Task 1.D)
- `src/main/ipc/handlers/annotations.ts`, `src/preload/index.ts`, `tests/main/handlers/annotations-handlers.test.ts` (Task 1.E)
- `src/main/database/FilterPresetRepository.ts` — owned by Wave 2 (do NOT pre-empt)

**Spec sections:** §5 (migration v27 implementation, built-in shortlist presets), §8 (migration test extensions)

**Commit:** `feat(db): migration v27 + built-in shortlist presets`

**Rationale:** Migration v27 adds the `kind` discriminator column to `filter_presets` and seeds the three built-in presets. The seed runs via raw SQL inside the migration block — it does NOT depend on `FilterPresetRepository` (Wave 2 updates the repository to read/write `kind` for subsequent CRUD calls). Because migrations are forward-only, this commit must leave the schema in a valid state even if later waves fail — the three built-in presets become orphan rows until Wave 2 wires the service, but they remain queryable through the repository's existing code path (which will surface them as `kind: undefined` until Wave 2, which is acceptable — the test gate is the migration test, not the service test).

### Files

- **Modify:** `src/main/database/migrations.ts` — append v27 block after existing `if (currentVersion < 26)` block
- **Create:** `src/main/database/built-in-shortlist-presets.ts`
- **Modify:** `tests/main/database/migrations.test.ts` — append v27 test cases

### Step 1.B.1: Create `built-in-shortlist-presets.ts`

Create `src/main/database/built-in-shortlist-presets.ts`:

```typescript
import type { ShortlistConfig } from '../../shared/types/shortlist'

export interface BuiltInShortlistPreset {
  name: string
  description: string
  sortOrder: number
  config: ShortlistConfig
}

/**
 * Built-in shortlist presets seeded by migration v27.
 *
 * Each preset uses only filter fields already supported by
 * VariantFilterBuilder. The config.rankConfig.weights drive
 * combine() in the scoring module; clinvarPinTop / pinStarredTop
 * pin classes of rows above the score-driven ordering.
 */
export const BUILT_IN_SHORTLIST_PRESETS: readonly BuiltInShortlistPreset[] = [
  {
    name: 'Tier 1 candidates',
    description:
      'Strict ranking: rare HIGH/MOD impact, top-50. ClinVar P/LP and starred variants pinned to top.',
    sortOrder: 0,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 50,
      baseFilters: {
        // Intentionally NO `clinvars` hard filter — the preset RANKS via
        // clinvarPinTop, it does not gate on ClinVar. A rare HIGH SNV with
        // no ClinVar entry is still a Tier 1 candidate.
        consequences: ['HIGH', 'MODERATE'],
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
  },
  {
    name: 'All rare damaging',
    description:
      'Broad shortlist: any rare HIGH/MOD variant. Score-driven ordering, no pins.',
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
  },
  {
    name: 'Recessive candidates',
    description:
      'SNV/indel only. Homozygous or compound-het inheritance. Rare coding impact.',
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
] as const
```

> **Note:** the `baseFilters` / `perTypeOverrides` fields reference existing `FilterState` keys. The implementer must verify that `consequences`, `maxGnomadAf`, `minCadd`, `inheritanceModes` all exist on the current `FilterState` shape (`src/shared/types/filters.ts`). If any name differs in the current codebase, use the actual name — these are documentation placeholders based on the spec and must match reality.

### Step 1.B.2: Write failing migration tests

Open `tests/main/database/migrations.test.ts` and append a new `describe('v27', () => { ... })` block:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { runMigrations } from '../../../src/main/database/migrations'
import { BUILT_IN_SHORTLIST_PRESETS } from '../../../src/main/database/built-in-shortlist-presets'

describe('migration v27 — filter_presets.kind + shortlist seeds', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  it('adds kind column to filter_presets', () => {
    const cols = db.prepare(`PRAGMA table_info(filter_presets)`).all() as Array<{ name: string }>
    expect(cols.some(c => c.name === 'kind')).toBe(true)
  })

  it('backfills existing rows to kind=filter', () => {
    // Insert a pre-migration filter row via raw SQL — already migrated,
    // so just verify DEFAULT applies on a fresh insert without kind.
    db.prepare(`
      INSERT INTO filter_presets (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
      VALUES ('test', '', '{}', 0, 1, 999, ${Date.now()}, ${Date.now()})
    `).run()
    const row = db.prepare(`SELECT kind FROM filter_presets WHERE name = 'test'`).get() as { kind: string }
    expect(row.kind).toBe('filter')
  })

  it('seeds all three built-in shortlist presets', () => {
    const rows = db.prepare(`
      SELECT name, kind, is_built_in, filter_json
      FROM filter_presets
      WHERE kind = 'shortlist'
      ORDER BY sort_order
    `).all() as Array<{ name: string; kind: string; is_built_in: number; filter_json: string }>

    expect(rows).toHaveLength(BUILT_IN_SHORTLIST_PRESETS.length)
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].name).toBe(BUILT_IN_SHORTLIST_PRESETS[i].name)
      expect(rows[i].kind).toBe('shortlist')
      expect(rows[i].is_built_in).toBe(1)
      const parsed = JSON.parse(rows[i].filter_json)
      expect(parsed.shortlist).toBeDefined()
      expect(parsed.shortlist.topN).toBe(BUILT_IN_SHORTLIST_PRESETS[i].config.topN)
    }
  })

  it('CHECK constraint rejects invalid kind', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO filter_presets (name, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
        VALUES ('bad', '{}', 0, 1, 999, 'garbage', ${Date.now()}, ${Date.now()})
      `).run()
    }).toThrow()
  })

  it('idx_filter_presets_kind index exists', () => {
    const idx = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND name='idx_filter_presets_kind'
    `).get()
    expect(idx).toBeTruthy()
  })

  it('PRAGMA user_version = 27 after migration', () => {
    const v = db.pragma('user_version', { simple: true })
    expect(v).toBe(27)
  })
})
```

Run: `make rebuild-node && npx vitest run tests/main/database/migrations.test.ts`  
Expected: **FAIL** — v27 block not yet implemented.

### Step 1.B.3: Append v27 block to `migrations.ts`

Open `src/main/database/migrations.ts`. Add an import at the top:

```typescript
import { BUILT_IN_SHORTLIST_PRESETS } from './built-in-shortlist-presets'
```

After the existing `if (currentVersion < 26) { ... }` block, append:

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

> **Column list verification:** the INSERT column list above must match the *actual* `filter_presets` schema as of migration v26. The implementer must open `migrations.ts` and verify the column order — if `filter_presets` has additional columns (`user_id`, `created_by`, etc.), include them with appropriate default values (`NULL` for nullable, explicit defaults for NOT NULL). This is a correctness-critical check; do not copy-paste the column list without verification.

### Step 1.B.4: Run migration tests — expect pass

```bash
make rebuild-node
npx vitest run tests/main/database/migrations.test.ts
```

Expected: **PASS**.

### Step 1.B.5: Run full CI

```bash
make ci
```

Expected: **PASS**. If the existing repository-level tests fail because `FilterPresetRepository.rowToPreset()` now sees a `kind` column it doesn't know about, that's expected — the repository update is Wave 2's job. This Wave 1.B task MUST NOT modify `FilterPresetRepository.ts`. If an existing test breaks on a literal comparison that includes `kind`, document the breakage in the commit message so Wave 2 can fix it. **If the breakage is a full test-suite failure**, escalate to the orchestrator: the spec assumed `rowToPreset` is structurally tolerant (spreads unknown columns), and this needs resolution before Wave 1 can complete.

### Step 1.B.6: Commit

```bash
git add \
  src/main/database/migrations.ts \
  src/main/database/built-in-shortlist-presets.ts \
  tests/main/database/migrations.test.ts

git commit -m "$(cat <<'EOF'
feat(db): migration v27 + built-in shortlist presets

Wave 1.B of the unified shortlist rollout. Migration v27 adds a
kind discriminator column to filter_presets:

  ALTER TABLE filter_presets ADD COLUMN kind TEXT NOT NULL
    DEFAULT 'filter' CHECK (kind IN ('filter', 'shortlist'));
  CREATE INDEX idx_filter_presets_kind ON filter_presets(kind);

Seeds three built-in shortlist presets (Tier 1 candidates, All rare
damaging, Recessive candidates) defined in built-in-shortlist-presets.ts.
Each preset's ShortlistConfig references only existing FilterState
filter fields so no new filter logic is needed in Wave 2.

The DEFAULT clause backfills existing filter_presets rows to kind='filter'.
The CHECK constraint fails closed on invalid kind values. The index
keeps preset-by-kind lookups O(log n).

Built-in presets are seeded via raw SQL inside the migration block —
FilterPresetRepository is updated in Wave 2 to read/write the kind
column via its public CRUD interface.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.C — Wave 1: Stage-1 query helper (parallel worktree)

**Wave:** 1  
**Depends on:** Task 0 (shared types — needs `ShortlistCandidate`)  
**Parallel with:** Tasks 1.A, 1.B, 1.D, 1.E

**Authorized files (exclusive):**
- `src/main/database/shortlist-query.ts` (new)
- `tests/main/database/shortlist-query.test.ts` (new)

**Prohibited files:**
- `src/main/services/scoring/**`, `tests/main/services/scoring/**` (Task 1.A)
- `src/main/database/migrations.ts`, `built-in-shortlist-presets.ts` (Task 1.B)
- `src/renderer/src/components/shortlist/**` (Task 1.D)
- `src/main/ipc/handlers/annotations.ts`, `src/preload/index.ts` (Task 1.E)
- `src/main/database/VariantFilterBuilder.ts`, `variant-where-builder.ts`, `variant-extension-registry.ts` — consumed as-is, do NOT modify

**Spec sections:** §3 (Stage 1 boundary commitment), §4 (ShortlistCandidate contract, aliasing convention, `is_starred` derivation, Stage 1 SELECT composition)

**Commit:** `feat(db): shortlist-query helper (Stage 1)`

**Rationale:** This is the only DB access path in the shortlist pipeline. It takes a `caseId`, `variant_type`, merged `FilterState`, and a `limit`, composes the SELECT with `buildBaseWhere` + `buildExtensionJoinClauses` + a LEFT JOIN on `case_variant_annotations`, and returns an array of `ShortlistCandidate` — the flat row shape the scorer consumes. Stage 2 has zero DB access by design (spec §3).

### Files

- **Create:** `src/main/database/shortlist-query.ts`
- **Create:** `tests/main/database/shortlist-query.test.ts`

### Step 1.C.1: Write failing tests

Create `tests/main/database/shortlist-query.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { runMigrations } from '../../../src/main/database/migrations'
import { queryVariantsByType } from '../../../src/main/database/shortlist-query'
import type { FilterState } from '../../../src/shared/types/filters'

function seedMinimalCase(db: Database.Database, caseId: number): void {
  // Insert a case + one SNV + one SV + one CNV + one STR.
  // The exact column lists MUST match the live schema — the implementer
  // reads src/main/database/schema.ts and src/main/database/migrations.ts
  // to get the authoritative column lists. Below is illustrative only.
  db.prepare(`INSERT INTO cases (id, name, created_at) VALUES (?, ?, ?)`)
    .run(caseId, `case-${caseId}`, Date.now())
  db.prepare(`INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, consequence, cadd, gnomad_af, clinvar) VALUES (?, ?, 'snv', '1', 1000, 'A', 'T', 'BRCA1', 'HIGH', 35, 0.0001, 'Pathogenic')`).run(1, caseId)
  db.prepare(`INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, sv_length, sv_type) VALUES (?, ?, 'sv', '2', 2000, 'N', '<DEL>', 'DMD', 5000, 'DEL')`).run(2, caseId)
  db.prepare(`INSERT INTO variant_sv (variant_id, vaf, is_precise) VALUES (2, 0.45, 1)`).run()
  db.prepare(`INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol) VALUES (?, ?, 'cnv', '3', 3000, 'N', '<CNV>', 'SMN1')`).run(3, caseId)
  db.prepare(`INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality) VALUES (3, 0, 95)`).run()
  db.prepare(`INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol) VALUES (?, ?, 'str', '4', 4000, 'N', '<STR>', 'HTT')`).run(4, caseId)
  db.prepare(`INSERT INTO variant_str (variant_id, status, disease, alt_copies) VALUES (4, 'pathologic', 'Huntington disease', '45')`).run()
}

describe('queryVariantsByType()', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    seedMinimalCase(db, 1)
  })

  it('returns SNV rows matching Variant shape + is_starred', () => {
    const rows = queryVariantsByType(db, 1, 'snv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].variant_type).toBe('snv')
    expect(rows[0].id).toBe(1)
    expect(rows[0].is_starred).toBe(false)
    expect(rows[0].gene_symbol).toBe('BRCA1')
  })

  it('flattens SV extension columns into sv_* aliases', () => {
    const rows = queryVariantsByType(db, 1, 'sv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].sv_vaf).toBe(0.45)
    expect(rows[0].sv_is_precise).toBe(1)
    expect(rows[0].sv_length).toBe(5000)   // base Variant column, NOT sv_length alias
  })

  it('flattens CNV extension columns into cnv_* aliases', () => {
    const rows = queryVariantsByType(db, 1, 'cnv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].cnv_copy_number).toBe(0)
    expect(rows[0].cnv_copy_number_quality).toBe(95)
  })

  it('flattens STR extension columns into str_* aliases', () => {
    const rows = queryVariantsByType(db, 1, 'str', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].str_status).toBe('pathologic')
    expect(rows[0].str_disease).toBe('Huntington disease')
  })

  it('populates is_starred from case_variant_annotations', () => {
    db.prepare(`
      INSERT INTO case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)
      VALUES (1, 1, 1, ?, ?)
    `).run(Date.now(), Date.now())
    const rows = queryVariantsByType(db, 1, 'snv', {} as Partial<FilterState>, 100)
    expect(rows[0].is_starred).toBe(true)
  })

  it('respects the limit cap', () => {
    for (let i = 10; i < 20; i++) {
      db.prepare(`INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt) VALUES (?, 1, 'snv', '1', ?, 'A', 'T')`).run(i, i * 100)
    }
    const rows = queryVariantsByType(db, 1, 'snv', {} as Partial<FilterState>, 5)
    expect(rows).toHaveLength(5)
  })

  it('applies FilterState filters through buildBaseWhere', () => {
    const rows = queryVariantsByType(db, 1, 'snv', {
      consequences: ['HIGH']
    } as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].consequence).toBe('HIGH')

    const empty = queryVariantsByType(db, 1, 'snv', {
      consequences: ['LOW']
    } as Partial<FilterState>, 100)
    expect(empty).toHaveLength(0)
  })

  it('structural row shape matches ShortlistCandidate contract', () => {
    const rows = queryVariantsByType(db, 1, 'snv', {} as Partial<FilterState>, 100)
    const row = rows[0]
    // Required Variant fields
    expect(row).toHaveProperty('id')
    expect(row).toHaveProperty('case_id')
    expect(row).toHaveProperty('variant_type')
    expect(row).toHaveProperty('chr')
    expect(row).toHaveProperty('pos')
    expect(row).toHaveProperty('ref')
    expect(row).toHaveProperty('alt')
    // Annotation field
    expect(row).toHaveProperty('is_starred')
    expect(typeof row.is_starred).toBe('boolean')
  })
})
```

Run: `make rebuild-node && npx vitest run tests/main/database/shortlist-query.test.ts`  
Expected: **FAIL** — module `shortlist-query` does not exist.

### Step 1.C.2: Implement `shortlist-query.ts`

Create `src/main/database/shortlist-query.ts`:

```typescript
import type Database from 'better-sqlite3-multiple-ciphers'
import type { FilterState } from '../../shared/types/filters'
import type { ShortlistCandidate, VariantTypeKey } from '../../shared/types/shortlist'
import { buildBaseWhere } from './variant-where-builder'
import { buildExtensionJoinClauses } from './variant-extension-registry'
// NOTE: the exact imports depend on current exports — the implementer
// verifies the real names in variant-where-builder.ts and
// variant-extension-registry.ts before wiring.

/**
 * Stage 1 of the shortlist pipeline.
 *
 * Runs a per-type SELECT that returns a fully-joined row projection.
 * The returned rows are ShortlistCandidates — flat Variant+extension
 * shapes plus is_starred — which the scorer consumes with zero DB
 * access (Stage 2). This function is the ONLY DB touchpoint in the
 * shortlist hot path.
 *
 * @param db SQLite connection (already migrated to v27+)
 * @param caseId Case scope
 * @param variantType Exact DB variant_type value ('snv' | 'indel' | 'sv' | 'cnv' | 'str')
 * @param filters Merged FilterState (base + per-type overrides applied by caller)
 * @param limit Row cap — the caller passes `config.topN * 4` as a safety margin
 */
export function queryVariantsByType(
  db: Database.Database,
  caseId: number,
  variantType: VariantTypeKey,
  filters: Partial<FilterState>,
  limit: number
): ShortlistCandidate[] {
  // 1. Build WHERE clause via the shared builder, scoped to caseId + variantType.
  const baseWhere = buildBaseWhere({
    scope: { caseId, variantType },
    filters
  })

  // 2. Build extension JOINs (sv/cnv/str) for this variant type.
  const joins = buildExtensionJoinClauses(variantType)

  // 3. Compose SELECT:
  //    - v.* selects every base Variant column (preserving `id`)
  //    - extension columns are aliased with their table short name
  //    - is_starred derived from case_variant_annotations LEFT JOIN
  const sql = `
    SELECT
      v.*,
      ${buildExtensionColumnProjection(variantType)}
      COALESCE(cva.starred, 0) AS is_starred_int
    FROM variants v
    ${joins}
    LEFT JOIN case_variant_annotations cva
      ON cva.case_id = v.case_id AND cva.variant_id = v.id
    WHERE ${baseWhere.clause}
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...baseWhere.params, limit) as Array<
    Record<string, unknown>
  >

  // 4. Hydrate is_starred into boolean; strip is_starred_int.
  return rows.map((row) => {
    const { is_starred_int, ...rest } = row
    return { ...rest, is_starred: is_starred_int === 1 } as unknown as ShortlistCandidate
  })
}

/**
 * Returns the aliased extension column fragment for the SELECT list.
 * Empty string for types with no extension table (snv/indel).
 * The trailing comma is included so the caller's SELECT list stays valid.
 */
function buildExtensionColumnProjection(variantType: VariantTypeKey): string {
  switch (variantType) {
    case 'sv':
      return `
        sv.is_precise AS sv_is_precise,
        sv.vaf AS sv_vaf,
        sv.support AS sv_support,
      `
    case 'cnv':
      return `
        cnv.copy_number AS cnv_copy_number,
        cnv.copy_number_quality AS cnv_copy_number_quality,
      `
    case 'str':
      return `
        str.status AS str_status,
        str.disease AS str_disease,
        str.alt_copies AS str_alt_copies,
      `
    case 'snv':
    case 'indel':
    default:
      return ''
  }
}
```

> **Verification checklist for the implementer:**
> 1. The actual `buildBaseWhere` signature in `variant-where-builder.ts` may differ — it may return `{ sql, params }` or take a different `scope` shape. Read the current file and adapt.
> 2. `buildExtensionJoinClauses` in `variant-extension-registry.ts` — verify the function name and that it emits `LEFT JOIN variant_sv sv ON sv.variant_id = v.id` (or similar). If it emits joins under a different alias, update the column projection aliases accordingly.
> 3. The `case_variant_annotations` table schema (`case_id`, `variant_id`, `starred`) must be verified against `schema.ts` — if the column is named differently, adjust.
> 4. The v25 schema already stores `sv_length` and `sv_type` on `variants` directly (per CLAUDE.md). **DO NOT** project `sv.sv_length` or alias it — it comes from `v.*`.

### Step 1.C.3: Run tests — expect pass

```bash
npx vitest run tests/main/database/shortlist-query.test.ts
```

Expected: **PASS**.

### Step 1.C.4: Run full CI

```bash
make ci
```

Expected: **PASS**.

### Step 1.C.5: Commit

```bash
git add src/main/database/shortlist-query.ts tests/main/database/shortlist-query.test.ts

git commit -m "$(cat <<'EOF'
feat(db): shortlist-query helper (Stage 1)

Wave 1.C of the unified shortlist rollout. Adds the Stage-1 query
helper — the only DB-touching module in the shortlist hot path.

queryVariantsByType(db, caseId, variantType, filters, limit) composes:
  - buildBaseWhere({scope: {caseId, variantType}, filters}) for the
    WHERE clause (reuses the existing shared filter translator)
  - buildExtensionJoinClauses(variantType) for the extension LEFT JOINs
  - a LEFT JOIN on case_variant_annotations to derive is_starred
  - v.* + aliased extension columns (sv_*, cnv_*, str_*) for the
    fully-flattened row projection

Stage 2 (scoring) consumes the returned ShortlistCandidate[] with zero
DB access — the row projection is intentionally complete so no N+1
lookups reach production (spec §3 stage boundary commitment).

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§3, §4)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.D — Wave 1: ShortlistTable + RankScoreTooltip leaves (parallel worktree)

**Wave:** 1  
**Depends on:** Task 0 (shared types — needs `ShortlistRow`, `RankComponents`)  
**Parallel with:** Tasks 1.A, 1.B, 1.C, 1.E

**Authorized files (exclusive):**
- `src/renderer/src/components/shortlist/ShortlistTable.vue` (new)
- `src/renderer/src/components/shortlist/RankScoreTooltip.vue` (new)
- `tests/renderer/components/shortlist/ShortlistTable.test.ts` (new)
- `tests/renderer/components/shortlist/RankScoreTooltip.test.ts` (new)

**Prohibited files:**
- Every other Wave 1 worktree's authorized list
- `src/renderer/src/components/shortlist/ShortlistPanel.vue` — owned by Wave 5
- `src/renderer/src/composables/useShortlistQuery.ts` — owned by Wave 4

**Spec sections:** §6 (ShortlistTable column set, RankScoreTooltip breakdown, design commitments)

**Commit:** `feat(ui): ShortlistTable + RankScoreTooltip components`

**Rationale:** These are the pure-presentational leaves — no composable, no IPC, no composition into a host panel. `ShortlistTable` receives `rows: ShortlistRow[]` as a prop and emits `row-click` / `open-in-tab` / `toggle-star`. `RankScoreTooltip` receives `components: RankComponents` + `score: number` + `pinned: 'starred' | 'clinvar' | null` and renders the term breakdown. Both are trivially unit-testable with `@vue/test-utils` + happy-dom. Task 5 composes them inside `ShortlistPanel.vue`.

### Files

- **Create:** `src/renderer/src/components/shortlist/ShortlistTable.vue`
- **Create:** `src/renderer/src/components/shortlist/RankScoreTooltip.vue`
- **Create:** `tests/renderer/components/shortlist/ShortlistTable.test.ts`
- **Create:** `tests/renderer/components/shortlist/RankScoreTooltip.test.ts`

### Step 1.D.1: Write failing `RankScoreTooltip.test.ts`

Create `tests/renderer/components/shortlist/RankScoreTooltip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RankScoreTooltip from '../../../../src/renderer/src/components/shortlist/RankScoreTooltip.vue'

const components = {
  impact: 1, pathogenicity: 0.8, rarity: 0.98, clinvar: 1, phenotype: 0
}

describe('RankScoreTooltip', () => {
  it('renders the total score', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components, pinned: null }
    })
    expect(wrapper.text()).toContain('0.94')
  })

  it('renders each component row', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components, pinned: null }
    })
    const text = wrapper.text()
    expect(text).toContain('Impact')
    expect(text).toContain('Pathogenicity')
    expect(text).toContain('Rarity')
    expect(text).toContain('ClinVar')
    expect(text).toContain('Phenotype')
  })

  it('shows "Pinned: ClinVar P/LP" when pinned=clinvar', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.945, components, pinned: 'clinvar' }
    })
    expect(wrapper.text()).toContain('ClinVar P/LP')
  })

  it('shows "Pinned: Starred" when pinned=starred', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.5, components, pinned: 'starred' }
    })
    expect(wrapper.text()).toContain('Starred')
  })

  it('hides pin line when pinned=null', () => {
    const wrapper = mount(RankScoreTooltip, {
      props: { score: 0.5, components, pinned: null }
    })
    expect(wrapper.text()).not.toContain('Pinned:')
  })
})
```

Run: `npx vitest run tests/renderer/components/shortlist/RankScoreTooltip.test.ts`  
Expected: **FAIL** — component does not exist.

### Step 1.D.2: Implement `RankScoreTooltip.vue`

Create `src/renderer/src/components/shortlist/RankScoreTooltip.vue`:

```vue
<script setup lang="ts">
import type { RankComponents } from '../../../../shared/types/shortlist'

const props = defineProps<{
  score: number
  components: RankComponents
  pinned: 'starred' | 'clinvar' | null
}>()

interface Row {
  label: string
  value: number
}

const rows: Row[] = [
  { label: 'Impact',        value: props.components.impact },
  { label: 'Pathogenicity', value: props.components.pathogenicity },
  { label: 'Rarity',        value: props.components.rarity },
  { label: 'ClinVar',       value: props.components.clinvar },
  { label: 'Phenotype',     value: props.components.phenotype }
]

function pinLabel(): string {
  if (props.pinned === 'starred') return 'Pinned: Starred'
  if (props.pinned === 'clinvar') return 'Pinned: ClinVar P/LP'
  return ''
}
</script>

<template>
  <div class="rank-tooltip">
    <div class="rank-tooltip__score">Rank score: {{ score.toFixed(2) }}</div>
    <v-divider class="my-1" />
    <div v-for="row in rows" :key="row.label" class="rank-tooltip__row">
      <span class="rank-tooltip__label">{{ row.label }}</span>
      <span class="rank-tooltip__value">{{ row.value.toFixed(2) }}</span>
    </div>
    <template v-if="pinned !== null">
      <v-divider class="my-1" />
      <div class="rank-tooltip__pin">{{ pinLabel() }}</div>
    </template>
  </div>
</template>

<style scoped>
.rank-tooltip { font-size: 0.82rem; min-width: 180px; }
.rank-tooltip__score { font-weight: 600; }
.rank-tooltip__row { display: flex; justify-content: space-between; }
.rank-tooltip__label { opacity: 0.75; }
.rank-tooltip__pin { font-style: italic; font-size: 0.78rem; }
</style>
```

Run the tooltip tests — expect **PASS**.

### Step 1.D.3: Write failing `ShortlistTable.test.ts`

Create `tests/renderer/components/shortlist/ShortlistTable.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShortlistTable from '../../../../src/renderer/src/components/shortlist/ShortlistTable.vue'
import type { ShortlistRow } from '../../../../src/shared/types/shortlist'

function row(overrides: Partial<ShortlistRow> = {}): ShortlistRow {
  return {
    id: 1, case_id: 1, variant_type: 'snv',
    chr: '1', pos: 1000, ref: 'A', alt: 'T',
    gene_symbol: 'BRCA1', consequence: 'HIGH',
    cadd: 35, gnomad_af: 0.0001, clinvar: 'Pathogenic',
    is_starred: false,
    rank: 1, rank_score: 0.95,
    rank_components: { impact: 1, pathogenicity: 0.87, rarity: 0.99, clinvar: 1, phenotype: 0 },
    rank_clinvar_pinned: true,
    rank_starred_pinned: false,
    ...overrides
  } as ShortlistRow
}

describe('ShortlistTable', () => {
  it('renders one row per input item', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({ id: 1 }), row({ id: 2, rank: 2 })] }
    })
    // v-data-table renders each item as a <tr>
    expect(wrapper.findAll('tbody tr').length).toBe(2)
  })

  it('displays rank, gene_symbol, and score', () => {
    const wrapper = mount(ShortlistTable, { props: { rows: [row()] } })
    const text = wrapper.text()
    expect(text).toContain('1')        // rank
    expect(text).toContain('BRCA1')    // gene
    expect(text).toContain('0.95')     // score formatted
  })

  it('emits row-click when a row is clicked', async () => {
    const wrapper = mount(ShortlistTable, { props: { rows: [row()] } })
    await wrapper.find('tbody tr').trigger('click')
    const emitted = wrapper.emitted('row-click')
    expect(emitted).toBeTruthy()
    expect((emitted?.[0]?.[0] as ShortlistRow).id).toBe(1)
  })

  it('emits toggle-star when star icon is clicked', async () => {
    const wrapper = mount(ShortlistTable, { props: { rows: [row()] } })
    const star = wrapper.find('[data-testid="shortlist-star-1"]')
    await star.trigger('click')
    expect(wrapper.emitted('toggle-star')).toBeTruthy()
  })

  it('variant_notation for SNV is chr:pos ref>alt', () => {
    const wrapper = mount(ShortlistTable, { props: { rows: [row()] } })
    expect(wrapper.text()).toContain('1:1000 A>T')
  })

  it('variant_notation for SV is chr:pos sv_type sv_length bp', () => {
    const wrapper = mount(ShortlistTable, {
      props: { rows: [row({
        variant_type: 'sv', chr: '2', pos: 5000,
        sv_type: 'DEL', sv_length: 1000
      })] }
    })
    expect(wrapper.text()).toContain('2:5000 DEL 1000bp')
  })
})
```

Run: **FAIL**.

### Step 1.D.4: Implement `ShortlistTable.vue`

Create `src/renderer/src/components/shortlist/ShortlistTable.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import RankScoreTooltip from './RankScoreTooltip.vue'
import type { ShortlistRow } from '../../../../shared/types/shortlist'

const props = defineProps<{
  rows: ShortlistRow[]
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: 'snv' | 'sv' | 'cnv' | 'str'): void
  (e: 'toggle-star', row: ShortlistRow): void
}>()

const headers = [
  { title: '#',       key: 'rank',             width: 60,  sortable: false },
  { title: 'Score',   key: 'rank_score',       width: 90,  sortable: false },
  { title: 'Type',    key: 'variant_type',     width: 80,  sortable: false },
  { title: 'Gene',    key: 'gene_symbol',      width: 140 },
  { title: 'Variant', key: 'variant_notation', width: 220, sortable: false },
  { title: 'Impact',  key: 'consequence',      width: 110 },
  { title: 'AF',      key: 'gnomad_af',        width: 90 },
  { title: 'ClinVar', key: 'clinvar',          width: 130 },
  { title: '★',       key: 'is_starred',       width: 50,  sortable: false },
  { title: '',        key: 'actions',          width: 80,  sortable: false }
] as const

function variantNotation(row: ShortlistRow): string {
  if (row.variant_type === 'sv') {
    return `${row.chr}:${row.pos} ${row.sv_type ?? ''} ${row.sv_length ?? '?'}bp`.trim()
  }
  if (row.variant_type === 'cnv') {
    return `${row.chr}:${row.pos} CNV CN=${row.cnv_copy_number ?? '?'}`
  }
  if (row.variant_type === 'str') {
    return `${row.chr}:${row.pos} STR ${row.str_alt_copies ?? '?'} copies`
  }
  return `${row.chr}:${row.pos} ${row.ref}>${row.alt}`
}

function pinFor(row: ShortlistRow): 'starred' | 'clinvar' | null {
  if (row.rank_starred_pinned) return 'starred'
  if (row.rank_clinvar_pinned) return 'clinvar'
  return null
}

function typeChipColor(t: ShortlistRow['variant_type']): string {
  // NEVER surface-variant (CLAUDE.md rule). Use explicit palette entries.
  switch (t) {
    case 'snv':   return 'primary'
    case 'indel': return 'primary'
    case 'sv':    return 'deep-purple'
    case 'cnv':   return 'teal-darken-2'
    case 'str':   return 'orange-darken-2'
  }
}

function targetTabFor(t: ShortlistRow['variant_type']): 'snv' | 'sv' | 'cnv' | 'str' {
  return t === 'indel' ? 'snv' : t
}
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="props.rows"
    item-value="id"
    density="compact"
    hide-default-footer
    :items-per-page="-1"
    @click:row="(_: MouseEvent, { item }: { item: ShortlistRow }) => emit('row-click', item)"
  >
    <template #[`item.rank_score`]="{ item }">
      <v-tooltip location="right">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps">{{ item.rank_score.toFixed(2) }}</span>
        </template>
        <RankScoreTooltip
          :score="item.rank_score"
          :components="item.rank_components"
          :pinned="pinFor(item)"
        />
      </v-tooltip>
    </template>

    <template #[`item.variant_type`]="{ item }">
      <v-chip :color="typeChipColor(item.variant_type)" size="x-small" variant="flat">
        {{ item.variant_type.toUpperCase() }}
      </v-chip>
    </template>

    <template #[`item.variant_notation`]="{ item }">
      {{ variantNotation(item) }}
    </template>

    <template #[`item.gnomad_af`]="{ item }">
      {{ item.gnomad_af == null ? '—' : item.gnomad_af.toExponential(2) }}
    </template>

    <template #[`item.is_starred`]="{ item }">
      <v-btn
        icon
        variant="text"
        size="x-small"
        :data-testid="`shortlist-star-${item.id}`"
        @click.stop="emit('toggle-star', item)"
      >
        <v-icon :color="item.is_starred ? 'primary' : undefined">
          {{ item.is_starred ? 'mdi-star' : 'mdi-star-outline' }}
        </v-icon>
      </v-btn>
    </template>

    <template #[`item.actions`]="{ item }">
      <v-menu>
        <template #activator="{ props: actProps }">
          <v-btn icon variant="text" size="x-small" v-bind="actProps">
            <v-icon>mdi-dots-vertical</v-icon>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item @click="emit('row-click', item)">
            <v-list-item-title>View details</v-list-item-title>
          </v-list-item>
          <v-list-item @click="emit('open-in-tab', targetTabFor(item.variant_type))">
            <v-list-item-title>View in {{ targetTabFor(item.variant_type).toUpperCase() }} tab</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </template>
  </v-data-table>
</template>
```

### Step 1.D.5: Run tests — expect pass

```bash
npx vitest run tests/renderer/components/shortlist
```

Expected: **PASS**.

### Step 1.D.6: Run full CI

```bash
make ci
```

Expected: **PASS**.

### Step 1.D.7: Commit

```bash
git add \
  src/renderer/src/components/shortlist/ShortlistTable.vue \
  src/renderer/src/components/shortlist/RankScoreTooltip.vue \
  tests/renderer/components/shortlist

git commit -m "$(cat <<'EOF'
feat(ui): ShortlistTable + RankScoreTooltip components

Wave 1.D of the unified shortlist rollout. Adds the two pure-leaf UI
components composed by ShortlistPanel in Wave 5:

  ShortlistTable.vue   — v-data-table specialized for shortlist rows.
                         Columns: # / Score / Type / Gene / Variant /
                         Impact / AF / ClinVar / ★ / actions. Emits
                         row-click / open-in-tab / toggle-star.
                         rank_score column is non-sortable (ranking
                         is the feature). variant_notation is computed
                         in the renderer. Type chips use explicit palette
                         colors per the CLAUDE.md 'no surface-variant' rule.

  RankScoreTooltip.vue — v-tooltip content showing per-component breakdown
                         (impact / pathogenicity / rarity / clinvar /
                         phenotype) with a 'Pinned: ...' line when the
                         row was promoted by clinvarPinTop or pinStarredTop.

Both components are pure presentational — no composable, no IPC. State
and data routing live in ShortlistPanel (Wave 5).

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.E — Wave 1: Annotation-event broadcast infrastructure (parallel worktree)

**Wave:** 1  
**Depends on:** Task 0 (shared types — needs `AnnotationChangeEvent`)  
**Parallel with:** Tasks 1.A, 1.B, 1.C, 1.D

**Authorized files (exclusive):**
- `src/main/ipc/handlers/annotations.ts` (modify — handler wrapper only)
- `src/preload/index.ts` (modify — add `variants.onAnnotationChanged`)
- `tests/main/handlers/annotations-handlers.test.ts` (modify — extend)

**Prohibited files:**
- `src/main/ipc/handlers/annotations-logic.ts` — **JSDoc contract prohibits Electron API usage in this file**. All broadcast code lives in the handler wrapper layer.
- Every other Wave 1 worktree's authorized list
- `src/shared/types/api.ts` — `AnnotationChangeEvent` was added in Wave 0, consume it as an import only

**Spec sections:** §6 (Annotation-event broadcast — main process emitter, preload wrapper, type contract, Phase 1 limitation)

**Commit:** `feat(ipc): variants:annotationChanged broadcast`

**Rationale:** The broadcast is the infrastructure that makes shortlist auto-refresh work (`useShortlistQuery` subscribes in Wave 4). It is emitted from the `annotations:upsertPerCase` handler wrapper AFTER the logic-layer write returns successfully. The logic file (`annotations-logic.ts`) is explicitly prohibited from touching Electron APIs per its existing JSDoc — all broadcast work lives in the handler file.

`annotations:upsertGlobal` does NOT emit the broadcast in Phase 1. See spec §6 "Phase 1 limitation" — global edits cannot change what the Phase 1 shortlist ranks or shows, so skipping the broadcast is safe. This must be revisited when a shortlist column surfaces a global field (Phase 2+).

### Files

- **Modify:** `src/main/ipc/handlers/annotations.ts` — extend existing `annotations:upsertPerCase` handler
- **Modify:** `src/preload/index.ts` — add `variants.onAnnotationChanged`
- **Modify:** `tests/main/handlers/annotations-handlers.test.ts` — add broadcast test

### Step 1.E.1: Write failing broadcast test

Open `tests/main/handlers/annotations-handlers.test.ts` and append a new describe block. The exact mocking setup depends on the existing test file's fixtures — read the file first and reuse its patterns. Illustrative skeleton:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock BrowserWindow globally for this test file. The existing test file
// may already have an electron mock — reuse it if so. Otherwise add:
vi.mock('electron', () => {
  const sentMessages: Array<[string, unknown]> = []
  return {
    ipcMain: { handle: vi.fn() },
    BrowserWindow: {
      getAllWindows: () => [{
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => sentMessages.push([channel, payload]) }
      }]
    },
    __sentMessages: sentMessages  // test hook
  }
})

describe('annotations:upsertPerCase — variants:annotationChanged broadcast', () => {
  beforeEach(() => {
    // reset mocks
  })

  it('emits variants:annotationChanged after successful upsert', async () => {
    // 1. Register the handler via the module under test
    // 2. Invoke the handler with a valid star update
    // 3. Assert BrowserWindow.getAllWindows()[0].webContents.send was called
    //    with ('variants:annotationChanged', { caseId, variantId, kind: 'star' })
    // Use the existing test file's pattern for invoking handlers — typically
    // importing the registration function and calling it with a mock event.
  })

  it('does NOT broadcast when the upsert throws', async () => {
    // Force upsertPerCaseAnnotation to throw; verify no send() call.
  })

  it('kind="comment" when only comment is updated', async () => {
    // starred undefined, comment set → kind='comment'
  })

  it('kind="acmg" when acmg_classification is updated', async () => {
    // verify mapping
  })
})
```

> The implementer reads the existing `annotations-handlers.test.ts` to mimic its test-registration pattern before filling in the assertions. **Do NOT invent a new test harness** — reuse the existing one. If the existing file has no electron mock, either add one under a shared mocks file or use `vi.hoisted()`.

Run: `make rebuild-node && npx vitest run tests/main/handlers/annotations-handlers.test.ts`  
Expected: **FAIL** — broadcast not yet implemented.

### Step 1.E.2: Implement broadcast in `annotations.ts` handler wrapper

Open `src/main/ipc/handlers/annotations.ts`. Import `BrowserWindow` from `electron` (may already be imported) and `AnnotationChangeEvent` from `../../shared/types/api` (Wave 0). Inside the existing `ipcMain.handle('annotations:upsertPerCase', ...)` block, add the broadcast call AFTER the `upsertPerCaseAnnotation(...)` logic call returns:

```typescript
import { BrowserWindow, ipcMain } from 'electron'
import type { AnnotationChangeEvent } from '../../shared/types/api'
// ... existing imports ...

ipcMain.handle(
  'annotations:upsertPerCase',
  async (_event, caseId: unknown, variantId: unknown, updates: unknown) => {
    return wrapHandler(async () => {
      // ── existing Zod validation unchanged ──
      const validatedIds = /* ... */
      const validatedUpdates = /* ... */

      const result = upsertPerCaseAnnotation(
        validatedIds.data.caseId,
        validatedIds.data.variantId,
        validatedUpdates.data,
        getDb
      )

      // NEW: broadcast to all renderer windows after successful write.
      broadcastAnnotationChanged({
        caseId: validatedIds.data.caseId,
        variantId: validatedIds.data.variantId,
        kind: detectKind(validatedUpdates.data)
      })

      return result
    })
  }
)

/** Broadcast to every non-destroyed renderer window. Handler-layer only. */
function broadcastAnnotationChanged(ev: AnnotationChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('variants:annotationChanged', ev)
    }
  }
}

/** Maps the validated update shape to the event kind enum. */
function detectKind(updates: {
  starred?: unknown
  acmg_classification?: unknown
  acmg_evidence?: unknown
}): AnnotationChangeEvent['kind'] {
  if (updates.starred !== undefined) return 'star'
  if (updates.acmg_classification !== undefined) return 'acmg'
  if (updates.acmg_evidence !== undefined) return 'evidence'
  return 'comment'
}
```

> **Critical:** the broadcast call must be AFTER the logic call succeeds. If `upsertPerCaseAnnotation` throws, the `wrapHandler` boundary catches it and `broadcastAnnotationChanged` never runs — the test asserts this.

### Step 1.E.3: Add `onAnnotationChanged` to preload

Open `src/preload/index.ts`. Inside the existing `variants` object (or equivalent typed-api surface), add:

```typescript
import type { AnnotationChangeEvent } from '../shared/types/api'
import { ipcRenderer, type IpcRendererEvent } from 'electron'

// inside the existing `variants: { ... }` block:
onAnnotationChanged: (cb: (ev: AnnotationChangeEvent) => void) => {
  const listener = (_event: IpcRendererEvent, ev: AnnotationChangeEvent) => cb(ev)
  ipcRenderer.on('variants:annotationChanged', listener)
  return () => ipcRenderer.off('variants:annotationChanged', listener)
}
```

Update the corresponding TypeScript `ElectronAPI` / `Window.api` type declaration (look for `src/preload/index.d.ts` or `env.d.ts` — the implementer verifies the actual file) to include:

```typescript
variants: {
  // ... existing methods ...
  onAnnotationChanged: (cb: (ev: AnnotationChangeEvent) => void) => () => void
}
```

The `variants.shortlist(...)` wrapper is NOT added here — that is Task 3's scope.

### Step 1.E.4: Run broadcast tests — expect pass

```bash
make rebuild-node
npx vitest run tests/main/handlers/annotations-handlers.test.ts
```

Expected: **PASS**.

### Step 1.E.5: Run full CI

```bash
make ci
```

Expected: **PASS**.

### Step 1.E.6: Commit

```bash
git add \
  src/main/ipc/handlers/annotations.ts \
  src/preload/index.ts \
  src/preload/index.d.ts \
  tests/main/handlers/annotations-handlers.test.ts

git commit -m "$(cat <<'EOF'
feat(ipc): variants:annotationChanged broadcast

Wave 1.E of the unified shortlist rollout. Adds the broadcast
infrastructure that drives shortlist auto-refresh on same-case
annotation changes.

The annotations:upsertPerCase handler wrapper now emits
'variants:annotationChanged' on every BrowserWindow after the
upsertPerCaseAnnotation logic call succeeds. The event payload is
{ caseId, variantId, kind: 'star' | 'comment' | 'acmg' | 'evidence' },
derived from the validated update shape via detectKind().

The broadcast call lives exclusively in the handler wrapper
(annotations.ts) — annotations-logic.ts is explicitly forbidden
from touching Electron APIs per its existing JSDoc contract.

Preload exposes variants.onAnnotationChanged(cb) which registers the
listener and returns an unsubscribe function. useShortlistQuery
(Wave 4) consumes this surface.

Phase 1 limitation: annotations:upsertGlobal does NOT emit the
broadcast. The Phase 1 shortlist ranks/displays only fields from the
variants table, so global annotation edits cannot change what the
shortlist shows. When a shortlist column surfaces a global field in
Phase 2+, this broadcast must be extended to upsertGlobal with
case-scope derivation by chr/pos/ref/alt join.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Report success. The orchestrator runs the Wave 1 integration gate (`git merge --ff-only` each of 1.A-1.E, then `make ci`). Wave 2 begins only after the gate is green.

---

## Task 2 — Wave 2: ShortlistService orchestrator

**Wave:** 2  
**Depends on:** Tasks 1.A (scoring), 1.B (migration + presets), 1.C (query helper) — merged into integration branch  
**Parallel with:** none (serial wave)

**Authorized files:**
- `src/main/database/ShortlistService.ts` (new)
- `src/main/database/FilterPresetRepository.ts` (modify — add `kind` column read/write)
- `src/main/database/createRepositories.ts` (modify — wire ShortlistService into DatabaseService)
- `tests/main/database/ShortlistService.test.ts` (new)
- `tests/main/database/FilterPresetRepository.test.ts` (modify — extend for `kind`)

**Spec sections:** §3 (architecture — two-stage retrieval diagram), §5 (filter merge semantics), §7 (error handling boundaries 1-2, scorer malformed input — per-row try/catch, service-level logging)

**Commit:** `feat(db): ShortlistService orchestrator + FilterPresetRepository.kind`

### Files

- **Create:** `src/main/database/ShortlistService.ts`
- **Create:** `tests/main/database/ShortlistService.test.ts`
- **Modify:** `src/main/database/FilterPresetRepository.ts`
- **Modify:** `src/main/database/createRepositories.ts`
- **Modify:** `tests/main/database/FilterPresetRepository.test.ts`

### Step 2.1: Extend `FilterPresetRepository` with `kind`

Open `src/main/database/FilterPresetRepository.ts`. The three changes:

1. `rowToPreset(row)` reads `row.kind` and returns it on the `FilterPreset` object (default `'filter'` if the column somehow comes back `null`).
2. `createPreset(input)` accepts `kind?: 'filter' | 'shortlist'` defaulting to `'filter'` and passes it to the INSERT.
3. `updatePreset(id, patch)` accepts `kind?` in the patch object.

Update the INSERT and UPDATE SQL column lists to include `kind`. Extend the corresponding unit tests in `tests/main/database/FilterPresetRepository.test.ts` to verify:

- `createPreset({...without kind})` returns a preset with `kind: 'filter'`.
- `createPreset({...with kind: 'shortlist'})` returns `kind: 'shortlist'`.
- `rowToPreset` on a raw row returned by `db.prepare('SELECT *...').get()` returns the `kind` field.

Run: `make rebuild-node && npx vitest run tests/main/database/FilterPresetRepository.test.ts`  
Expected: **PASS**.

### Step 2.2: Write failing `ShortlistService.test.ts`

Create `tests/main/database/ShortlistService.test.ts`. Minimal skeleton — the implementer fills in the seed helpers from `tests/fixtures/shortlist/cross-type-variant-fixture.ts` (Task 1.A) and the `seedMinimalCase` pattern from Task 1.C:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { runMigrations } from '../../../src/main/database/migrations'
import { ShortlistService } from '../../../src/main/database/ShortlistService'
import { FilterPresetRepository } from '../../../src/main/database/FilterPresetRepository'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'

function seedMultiTypeCase(db: Database.Database): number {
  // Insert one case with a distribution across all five types.
  // Reuse the column lists from shortlist-query.test.ts (Task 1.C).
  return 1
}

function baseAdHocConfig(): ShortlistConfig {
  return {
    baseFilters: {},
    topN: 50,
    rankConfig: {
      weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
    }
  }
}

describe('ShortlistService', () => {
  let db: Database.Database
  let service: ShortlistService
  let presetRepo: FilterPresetRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    presetRepo = new FilterPresetRepository(/* pass db accessor per existing constructor */)
    service = new ShortlistService(db, presetRepo)
    seedMultiTypeCase(db)
  })

  describe('by presetId', () => {
    it('loads Tier 1 preset and returns ranked rows', async () => {
      const tier1 = db.prepare(`SELECT id FROM filter_presets WHERE name = 'Tier 1 candidates'`).get() as { id: number }
      const result = await service.getShortlist({ caseId: 1, presetId: tier1.id })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows[0].rank).toBe(1)
      expect(result.presetUsed?.name).toBe('Tier 1 candidates')
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('throws NotFoundError when preset id does not exist', async () => {
      await expect(service.getShortlist({ caseId: 1, presetId: 999999 })).rejects.toThrow(/not found|NotFoundError/i)
    })

    it('throws ValidationError when preset.kind != shortlist', async () => {
      // Seed a kind='filter' preset, verify rejection
    })
  })

  describe('by adHocConfig', () => {
    it('executes ad-hoc config without touching preset repo', async () => {
      const result = await service.getShortlist({ caseId: 1, adHocConfig: baseAdHocConfig() })
      expect(result.presetUsed).toBeNull()
    })

    it('enforces topN', async () => {
      const result = await service.getShortlist({
        caseId: 1,
        adHocConfig: { ...baseAdHocConfig(), topN: 2 }
      })
      expect(result.rows.length).toBeLessThanOrEqual(2)
    })
  })

  describe('Stage 1 candidate generation', () => {
    it('applies perTypeOverrides on top of baseFilters', async () => {
      // Seed types where base filter excludes all but per-type override reopens
    })

    it('limits per-type Stage-1 query to topN * 4', async () => {
      // Seed 100 SNVs; assert internal candidate pool <= topN * 4
    })

    it('variantTypeScope narrows the query set', async () => {
      const result = await service.getShortlist({
        caseId: 1,
        adHocConfig: { ...baseAdHocConfig(), variantTypeScope: ['sv', 'cnv'] }
      })
      for (const row of result.rows) {
        expect(['sv', 'cnv']).toContain(row.variant_type)
      }
    })

    it('aborts with ShortlistQueryError on per-type query failure (no silent scope reduction)', async () => {
      // Force one type's query to throw via monkey-patching shortlist-query
    })
  })

  describe('Stage 2 ranking', () => {
    it('sorts rows by rank_score descending', async () => {
      const result = await service.getShortlist({ caseId: 1, adHocConfig: baseAdHocConfig() })
      for (let i = 1; i < result.rows.length; i++) {
        if (result.rows[i - 1].rank_clinvar_pinned || result.rows[i - 1].rank_starred_pinned) continue
        expect(result.rows[i - 1].rank_score).toBeGreaterThanOrEqual(result.rows[i].rank_score)
      }
    })

    it('applies clinvarPinTop: true → P/LP rows first', async () => {
      // Tier 1 preset tests this end-to-end
    })

    it('applies pinStarredTop: true → starred rows first (overrides clinvar pin)', async () => {
      // Star a LOW variant; assert it appears above a Pathogenic row under Tier 1
    })

    it('assigns rank 1-based after sort', async () => {
      const result = await service.getShortlist({ caseId: 1, adHocConfig: baseAdHocConfig() })
      result.rows.forEach((row, i) => expect(row.rank).toBe(i + 1))
    })

    it('returns ZERO_COMPONENTS row (no poison) when scorer throws on one row', async () => {
      // Inject a malformed row (e.g. variant_type='bogus'); assert it still appears at bottom
    })
  })

  describe('totalCandidates telemetry', () => {
    it('reports pre-slice count of all Stage-1 candidates', async () => {
      const result = await service.getShortlist({
        caseId: 1,
        adHocConfig: { ...baseAdHocConfig(), topN: 1 }
      })
      expect(result.totalCandidates).toBeGreaterThanOrEqual(result.rows.length)
    })
  })

  describe('empty results', () => {
    it('returns empty rows + totalCandidates=0 when no variants match', async () => {
      const result = await service.getShortlist({
        caseId: 1,
        adHocConfig: { ...baseAdHocConfig(), baseFilters: { consequences: ['NONEXISTENT'] as unknown as string[] } }
      })
      expect(result.rows).toEqual([])
      expect(result.totalCandidates).toBe(0)
    })
  })
})
```

Run: **FAIL**.

### Step 2.3: Implement `ShortlistService.ts`

Create `src/main/database/ShortlistService.ts`:

```typescript
import type Database from 'better-sqlite3-multiple-ciphers'
import { mainLogger } from '../services/MainLogger'
import { toError } from '../util/errors'
import { NotFoundError, ValidationError } from './errors'
import { FilterPresetRepository } from './FilterPresetRepository'
import { queryVariantsByType } from './shortlist-query'
import { scoreRow, compareScoredRows, ZERO_COMPONENTS } from '../services/scoring'
import type {
  ShortlistConfig,
  ShortlistCandidate,
  ScoredCandidate,
  ShortlistRow,
  ShortlistResult,
  VariantTypeKey
} from '../../shared/types/shortlist'
import type { FilterPreset } from '../../shared/types/filter-presets'
import type { FilterState } from '../../shared/types/filters'

export type GetShortlistParams =
  | { caseId: number; presetId: number }
  | { caseId: number; adHocConfig: ShortlistConfig }

export class ShortlistQueryError extends Error {
  readonly queryErrors: Array<{ type: VariantTypeKey; error: Error }>
  constructor(message: string, queryErrors: Array<{ type: VariantTypeKey; error: Error }>) {
    super(message)
    this.name = 'ShortlistQueryError'
    this.queryErrors = queryErrors
  }
}

export class ShortlistService {
  constructor(
    private readonly db: Database.Database,
    private readonly presetRepo: FilterPresetRepository
  ) {}

  async getShortlist(params: GetShortlistParams): Promise<ShortlistResult> {
    const started = Date.now()
    const { config, presetUsed } = this.resolveConfig(params)
    const scope = config.variantTypeScope ?? this.detectPresentTypes(params.caseId)

    // ── Stage 1: candidate generation ───────────────────────────
    const candidates: ShortlistCandidate[] = []
    const queryErrors: Array<{ type: VariantTypeKey; error: Error }> = []
    const perTypeLimit = config.topN * 4

    for (const type of scope) {
      try {
        const mergedFilters: Partial<FilterState> = {
          ...config.baseFilters,
          ...(config.perTypeOverrides?.[type] ?? {})
        }
        const rows = queryVariantsByType(this.db, params.caseId, type, mergedFilters, perTypeLimit)
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
        queryErrors
      )
    }

    const totalCandidates = candidates.length

    // ── Stage 2: ranking (pure TypeScript, zero DB access) ──────
    const scored: ScoredCandidate[] = candidates.map((row) => ({
      ...row,
      ...scoreRow(row, config.rankConfig)
    }))

    scored.sort((a, b) => compareScoredRows(a, b, config.tieBreakers))
    const topN = scored.slice(0, config.topN)

    // ── Stage 3: rank assignment ────────────────────────────────
    const rows: ShortlistRow[] = topN.map((row, i) => ({ ...row, rank: i + 1 }))

    const elapsedMs = Date.now() - started
    mainLogger.info(
      `shortlist: case=${params.caseId} preset=${'presetId' in params ? params.presetId : 'adHoc'} ` +
      `rowsIn=${totalCandidates} rowsOut=${rows.length} elapsedMs=${elapsedMs}`,
      'shortlist.service'
    )

    return { rows, totalCandidates, presetUsed, elapsedMs }
  }

  private resolveConfig(params: GetShortlistParams): {
    config: ShortlistConfig
    presetUsed: FilterPreset | null
  } {
    if ('adHocConfig' in params) {
      return { config: params.adHocConfig, presetUsed: null }
    }

    const preset = this.presetRepo.getPreset(params.presetId)
    if (preset == null) {
      throw new NotFoundError('FilterPreset', params.presetId)
    }
    const config = preset.filterJson?.shortlist
    if (config == null) {
      throw new ValidationError(
        `Preset "${preset.name}" is not a shortlist preset (kind='${preset.kind}')`
      )
    }
    return { config, presetUsed: preset }
  }

  private detectPresentTypes(caseId: number): VariantTypeKey[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT variant_type FROM variants WHERE case_id = ?
    `).all(caseId) as Array<{ variant_type: VariantTypeKey }>
    return rows.map(r => r.variant_type)
  }
}
```

> **Implementer notes:**
> - The constructor signature must match whatever pattern `createRepositories.ts` uses for the other services. If `FilterPresetRepository` is instantiated with a `getDb` closure rather than a `Database` instance, follow that style.
> - `NotFoundError` and `ValidationError` exist in `src/main/database/errors.ts` — verify the exact constructor signatures and use them.
> - `mainLogger` import path is `../services/MainLogger` relative to `database/`. Verify.
> - `toError` — use the existing utility (verify path).

### Step 2.4: Wire `ShortlistService` into `createRepositories.ts`

Open `src/main/database/createRepositories.ts` and add `ShortlistService` to the returned composition. Illustrative:

```typescript
import { ShortlistService } from './ShortlistService'

// inside createRepositories(...)
const shortlistService = new ShortlistService(db, filterPresetRepo)

return {
  // ... existing repositories ...
  shortlistService
}
```

Update the corresponding TypeScript return type (likely `DatabaseServices` interface) to include `shortlistService: ShortlistService`. Any consumer that destructures the repository bag now has access to it.

### Step 2.5: Run all tests — expect pass

```bash
make rebuild-node
npx vitest run tests/main/database/ShortlistService.test.ts tests/main/database/FilterPresetRepository.test.ts
```

Expected: **PASS**.

### Step 2.6: Run full CI + commit

```bash
make ci
git add \
  src/main/database/ShortlistService.ts \
  src/main/database/FilterPresetRepository.ts \
  src/main/database/createRepositories.ts \
  tests/main/database/ShortlistService.test.ts \
  tests/main/database/FilterPresetRepository.test.ts

git commit -m "$(cat <<'EOF'
feat(db): ShortlistService orchestrator + FilterPresetRepository.kind

Wave 2 of the unified shortlist rollout. Adds the ShortlistService that
orchestrates the two-stage shortlist pipeline:

  Stage 1: per-type queryVariantsByType() calls under a topN*4 cap,
           errors collected and thrown atomically (no silent scope
           reduction)
  Stage 2: pure TypeScript scoring via scoreRow() + sort via
           compareScoredRows() with configurable tieBreakers
  Stage 3: topN slice + 1-based rank assignment

Service resolves GetShortlistParams into a ShortlistConfig + optional
FilterPreset via a discriminated union (presetId | adHocConfig). The
preset path loads via FilterPresetRepository.getPreset and hard-errors
on a wrong-kind preset (clinically misleading to silently return empty).

Per-row scorer failures are handled inside scoreRow (Wave 1.A) — a
single malformed row returns ZERO_COMPONENTS and sorts to bottom
without poisoning the whole result.

FilterPresetRepository now reads and writes the filter_presets.kind
column added in migration v27 (Wave 1.B). Default is 'filter' for
back-compat with all existing call sites.

createRepositories.ts wires the service into the DatabaseService
composition so IPC handlers in Wave 3 can consume it via the existing
repository-bag pattern.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§3, §5, §7)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Wave 3: IPC handler + preload wrapper

**Wave:** 3  
**Depends on:** Task 2 (ShortlistService)  
**Parallel with:** none

**Authorized files:**
- `src/main/ipc/handlers/shortlist.ts` (new)
- `src/preload/index.ts` (modify — add `variants.shortlist()` wrapper)
- `src/preload/index.d.ts` (modify — extend the api type)
- `src/main/ipc/registerHandlers.ts` or equivalent (modify — register the new handler)
- `tests/main/ipc/handlers/shortlist.test.ts` (new)

**Spec sections:** §5 (IPC contract, Zod schemas), §7 (Zod validation at IPC boundary, tieBreaker sort-key allowlist)

**Commit:** `feat(ipc): variants:shortlist handler + preload wrapper`

### Files

- **Create:** `src/main/ipc/handlers/shortlist.ts`
- **Create:** `tests/main/ipc/handlers/shortlist.test.ts`
- **Modify:** `src/preload/index.ts`
- **Modify:** `src/preload/index.d.ts`
- **Modify:** the file that registers ipc handlers (e.g. `src/main/ipc/index.ts`; the implementer locates the actual registration site)

### Step 3.1: Write failing `tests/main/ipc/handlers/shortlist.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
// Mock electron ipcMain like other handler test files in the repo
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))
import { ipcMain } from 'electron'
import { registerShortlistHandlers } from '../../../../src/main/ipc/handlers/shortlist'

function makeMockService(overrides: Record<string, unknown> = {}) {
  return {
    getShortlist: vi.fn().mockResolvedValue({
      rows: [], totalCandidates: 0, presetUsed: null, elapsedMs: 12
    }),
    ...overrides
  }
}

function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const call = (ipcMain.handle as unknown as { mock: { calls: Array<[string, (...a: unknown[]) => unknown]> } })
    .mock.calls.find(([c]) => c === channel)
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return Promise.resolve(call[1]({} /* event */, ...args))
}

describe('variants:shortlist handler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers the variants:shortlist channel', () => {
    const service = makeMockService()
    registerShortlistHandlers({ shortlistService: service } as never)
    expect(ipcMain.handle).toHaveBeenCalledWith('variants:shortlist', expect.any(Function))
  })

  it('passes presetId params through to service', async () => {
    const service = makeMockService()
    registerShortlistHandlers({ shortlistService: service } as never)
    await invokeHandler('variants:shortlist', { caseId: 1, presetId: 7 })
    expect(service.getShortlist).toHaveBeenCalledWith({ caseId: 1, presetId: 7 })
  })

  it('rejects topN > 500 with ValidationError', async () => {
    const service = makeMockService()
    registerShortlistHandlers({ shortlistService: service } as never)
    const bad = {
      caseId: 1,
      adHocConfig: {
        baseFilters: {},
        topN: 999,
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }
    await expect(invokeHandler('variants:shortlist', bad)).rejects.toThrow(/topN|Validation/i)
    expect(service.getShortlist).not.toHaveBeenCalled()
  })

  it('rejects caseId = 0', async () => {
    const service = makeMockService()
    registerShortlistHandlers({ shortlistService: service } as never)
    await expect(invokeHandler('variants:shortlist', { caseId: 0, presetId: 1 }))
      .rejects.toThrow(/Validation/i)
  })

  it('rejects unknown tieBreaker key (sort-key allowlist)', async () => {
    const service = makeMockService()
    registerShortlistHandlers({ shortlistService: service } as never)
    const bad = {
      caseId: 1,
      adHocConfig: {
        baseFilters: {},
        topN: 10,
        tieBreakers: [{ key: 'bogus_field', order: 'desc' }],
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }
    await expect(invokeHandler('variants:shortlist', bad)).rejects.toThrow()
  })

  it('propagates service errors', async () => {
    const service = makeMockService({
      getShortlist: vi.fn().mockRejectedValue(new Error('boom'))
    })
    registerShortlistHandlers({ shortlistService: service } as never)
    await expect(invokeHandler('variants:shortlist', { caseId: 1, presetId: 1 }))
      .rejects.toThrow(/boom/)
  })
})
```

Run: **FAIL**.

### Step 3.2: Implement `src/main/ipc/handlers/shortlist.ts`

```typescript
import { ipcMain } from 'electron'
import { GetShortlistParamsSchema } from '../../../shared/types/ipc-schemas'
import { ValidationError } from '../../database/errors'
import { resolveSortColumn } from '../../database/VariantFilterBuilder'
// verify exact export path for resolveSortColumn
import { wrapHandler } from './wrap-handler'  // verify existing pattern
import type { ShortlistService } from '../../database/ShortlistService'
import type { DatabaseServices } from '../../database/createRepositories'

export function registerShortlistHandlers(services: DatabaseServices): void {
  ipcMain.handle('variants:shortlist', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      const parsed = GetShortlistParamsSchema.safeParse(params)
      if (!parsed.success) {
        throw new ValidationError(
          `Invalid variants:shortlist params: ${parsed.error.issues.map(i => i.message).join('; ')}`
        )
      }

      // Service-layer tieBreaker key allowlist (prevents SQL injection via
      // sort keys — Zod only validates shape at the IPC boundary).
      if ('adHocConfig' in parsed.data && parsed.data.adHocConfig.tieBreakers != null) {
        for (const tb of parsed.data.adHocConfig.tieBreakers) {
          const resolved = resolveSortColumn(tb.key)
          if (resolved == null) {
            throw new ValidationError(`Unknown tieBreaker sort key: ${tb.key}`)
          }
        }
      }

      return services.shortlistService.getShortlist(parsed.data)
    })
  })
}
```

Register this in the main IPC registration file (e.g. `src/main/ipc/index.ts` — the implementer finds the existing pattern used by `registerAnnotationsHandlers`, `registerCasesHandlers`, etc. and follows the same style).

### Step 3.3: Add `variants.shortlist()` to preload

Open `src/preload/index.ts`. Inside the existing `variants` object, add:

```typescript
import type { GetShortlistParams, ShortlistResult } from '../shared/types/...'

// inside variants: { ... }
shortlist: (params: GetShortlistParams): Promise<ShortlistResult> =>
  ipcRenderer.invoke('variants:shortlist', params),
```

Update `src/preload/index.d.ts` (or equivalent api.d.ts) so `window.api.variants.shortlist` is typed:

```typescript
variants: {
  // ... existing methods ...
  shortlist: (params: GetShortlistParams) => Promise<ShortlistResult>
  onAnnotationChanged: (cb: (ev: AnnotationChangeEvent) => void) => () => void
}
```

### Step 3.4: Run all shortlist handler tests — expect pass

```bash
make rebuild-node
npx vitest run tests/main/ipc/handlers/shortlist.test.ts
```

Expected: **PASS**.

### Step 3.5: Full CI + commit

```bash
make ci
git add \
  src/main/ipc/handlers/shortlist.ts \
  src/main/ipc/index.ts \
  src/preload/index.ts \
  src/preload/index.d.ts \
  tests/main/ipc/handlers/shortlist.test.ts

git commit -m "$(cat <<'EOF'
feat(ipc): variants:shortlist handler + preload wrapper

Wave 3 of the unified shortlist rollout. Adds the variants:shortlist
IPC handler that forwards discriminated-union GetShortlistParams
(presetId | adHocConfig) to ShortlistService.

The handler validates the shape at the boundary via
GetShortlistParamsSchema (Wave 0). Service-layer allowlist check on
tieBreaker sort keys via resolveSortColumn rejects unknown keys with
ValidationError before they reach VariantFilterBuilder.applySort —
key-value validation lives in the service layer to avoid a
shared-types → main-process import cycle.

Preload exposes variants.shortlist(params) as a typed invoke wrapper.
useShortlistQuery (Wave 4) consumes this surface.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§5, §7)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Wave 4: useShortlistQuery composable

**Wave:** 4  
**Depends on:** Task 3 (preload wrapper), Task 1.E (onAnnotationChanged preload wrapper)  
**Parallel with:** none

**Authorized files:**
- `src/renderer/src/composables/useShortlistQuery.ts` (new)
- `tests/renderer/composables/useShortlistQuery.test.ts` (new)

**Spec sections:** §6 (useShortlistQuery.ts composable, lifecycle notes)

**Commit:** `feat(renderer): useShortlistQuery composable`

### Files

- **Create:** `src/renderer/src/composables/useShortlistQuery.ts`
- **Create:** `tests/renderer/composables/useShortlistQuery.test.ts`

### Step 4.1: Write failing composable tests

Create `tests/renderer/composables/useShortlistQuery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useShortlistQuery } from '../../../src/renderer/src/composables/useShortlistQuery'

type AnnotationCallback = (ev: { caseId: number; variantId: number; kind: string }) => void

function harness(caseId = 1) {
  const shortlistMock = vi.fn().mockResolvedValue({
    rows: [{ id: 1, rank: 1, rank_score: 0.9 }],
    totalCandidates: 10,
    presetUsed: null,
    elapsedMs: 15
  })
  let annotationCb: AnnotationCallback | null = null
  const unsubscribe = vi.fn()

  // Mock window.api surface
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      variants: {
        shortlist: shortlistMock,
        onAnnotationChanged: (cb: AnnotationCallback) => {
          annotationCb = cb
          return unsubscribe
        }
      }
    }
  }

  // Mock useFilterPresetStore to return a stable presets ref
  const visiblePresets = ref([
    { id: 1, name: 'Tier 1', kind: 'shortlist', filterJson: { shortlist: { /* ... */ } } }
  ])

  vi.doMock('../../../src/renderer/src/composables/useFilterPresetStore', () => ({
    useFilterPresetStore: () => ({ visiblePresets })
  }))

  const caseIdRef = ref(caseId)

  let composable!: ReturnType<typeof useShortlistQuery>
  const Wrapper = defineComponent({
    setup() { composable = useShortlistQuery(caseIdRef); return () => h('div') }
  })

  const wrapper = mount(Wrapper)
  return { wrapper, composable: () => composable, shortlistMock, unsubscribe, triggerAnnotation: () => annotationCb?.({ caseId: 1, variantId: 1, kind: 'star' }), caseIdRef }
}

describe('useShortlistQuery', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('auto-selects the first visible shortlist preset', async () => {
    const h = harness()
    await nextTick()
    expect(h.composable().selectedPresetId.value).toBe(1)
  })

  it('fetches when preset is auto-selected', async () => {
    const h = harness()
    await nextTick(); await nextTick()
    expect(h.shortlistMock).toHaveBeenCalledWith({ caseId: 1, presetId: 1 })
    expect(h.composable().result.value).not.toBeNull()
  })

  it('re-fetches on annotation-change event for the same case', async () => {
    const h = harness()
    await nextTick(); await nextTick()
    h.shortlistMock.mockClear()
    h.triggerAnnotation()
    await nextTick()
    expect(h.shortlistMock).toHaveBeenCalledOnce()
  })

  it('ignores annotation-change events for other cases', async () => {
    const h = harness()
    await nextTick(); await nextTick()
    h.shortlistMock.mockClear()
    // Trigger with caseId=999 (different from caseIdRef=1)
    // needs harness tweak — omitted for brevity
  })

  it('exposes loading state during fetch', async () => {
    const h = harness()
    let resolve!: (v: unknown) => void
    h.shortlistMock.mockImplementationOnce(() => new Promise(r => resolve = r))
    await nextTick()
    expect(h.composable().loading.value).toBe(true)
    resolve({ rows: [], totalCandidates: 0, presetUsed: null, elapsedMs: 1 })
    await nextTick(); await nextTick()
    expect(h.composable().loading.value).toBe(false)
  })

  it('captures errors', async () => {
    const h = harness()
    h.shortlistMock.mockRejectedValueOnce(new Error('boom'))
    await nextTick(); await nextTick()
    expect(h.composable().error.value?.message).toBe('boom')
    expect(h.composable().result.value).toBeNull()
  })

  it('unsubscribes onBeforeUnmount', async () => {
    const h = harness()
    await nextTick()
    h.wrapper.unmount()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('refresh() triggers a fetch', async () => {
    const h = harness()
    await nextTick(); await nextTick()
    h.shortlistMock.mockClear()
    await h.composable().refresh()
    expect(h.shortlistMock).toHaveBeenCalledOnce()
  })
})
```

Run: **FAIL**.

### Step 4.2: Implement `useShortlistQuery.ts`

```typescript
// src/renderer/src/composables/useShortlistQuery.ts
import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue'
import { useFilterPresetStore } from './useFilterPresetStore'
import { logService } from '../services/LogService'
import type {
  ShortlistResult
} from '../../../shared/types/shortlist'
import type { AnnotationChangeEvent } from '../../../shared/types/api'

export function useShortlistQuery(caseId: Ref<number>) {
  const presetStore = useFilterPresetStore()

  // useFilterPresetStore exposes `visiblePresets: ComputedRef<FilterPreset[]>`.
  // Filter for shortlist presets — those whose filterJson carries a shortlist
  // config. (`kind === 'shortlist'` is equivalent once Wave 2 is live, but
  // `filterJson.shortlist != null` also works and is resilient to missing
  // `kind` during partial rollouts.)
  const shortlistPresets = computed(() =>
    presetStore.visiblePresets.value.filter(
      (p) => p.filterJson?.shortlist != null
    )
  )

  const selectedPresetId = ref<number | null>(null)

  const result = ref<ShortlistResult | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function fetch(): Promise<void> {
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

  // Auto-select first shortlist preset when they load (async).
  watch(
    shortlistPresets,
    (presets) => {
      if (selectedPresetId.value == null && presets.length > 0) {
        selectedPresetId.value = presets[0].id
      }
    },
    { immediate: true }
  )

  // Annotation-change subscription — setup() top-level, teardown via
  // onBeforeUnmount. Do NOT nest under onMounted.
  const unsubscribeAnnotations = window.api.variants.onAnnotationChanged(
    (ev: AnnotationChangeEvent) => {
      if (ev.caseId === caseId.value) void fetch()
    }
  )
  onBeforeUnmount(unsubscribeAnnotations)

  return {
    shortlistPresets,
    selectedPresetId,
    result,
    loading,
    error,
    refresh: fetch
  }
}
```

### Step 4.3: Run tests + CI + commit

```bash
make rebuild-node
npx vitest run tests/renderer/composables/useShortlistQuery.test.ts
make ci

git add \
  src/renderer/src/composables/useShortlistQuery.ts \
  tests/renderer/composables/useShortlistQuery.test.ts

git commit -m "$(cat <<'EOF'
feat(renderer): useShortlistQuery composable

Wave 4 of the unified shortlist rollout. Adds useShortlistQuery —
the reactive bridge between ShortlistPanel and variants:shortlist
IPC.

Exposes:
  shortlistPresets  — ComputedRef over visiblePresets, filtered by
                      filterJson.shortlist != null
  selectedPresetId  — ref, auto-set to first shortlist preset on load
  result / loading / error — fetch state
  refresh           — manual re-fetch

Fetch triggers on [selectedPresetId, caseId] change. Auto-refresh on
variants:annotationChanged events where ev.caseId === caseId.value.
Subscription is created in setup() top-level (NOT inside onMounted)
and torn down via onBeforeUnmount so the lifecycle is reliable across
SSR / test rendering.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Wave 5: ShortlistPanel composition

**Wave:** 5  
**Depends on:** Task 4 (useShortlistQuery), Task 1.D (ShortlistTable + RankScoreTooltip)  
**Parallel with:** none

**Authorized files:**
- `src/renderer/src/components/shortlist/ShortlistPanel.vue` (new)
- `tests/renderer/components/shortlist/ShortlistPanel.test.ts` (new)

**Spec sections:** §6 (ShortlistPanel.vue structure, design commitments 1-7)

**Commit:** `feat(renderer): ShortlistPanel composition`

### Files

- **Create:** `src/renderer/src/components/shortlist/ShortlistPanel.vue`
- **Create:** `tests/renderer/components/shortlist/ShortlistPanel.test.ts`

### Step 5.1: Write failing panel tests

Create `tests/renderer/components/shortlist/ShortlistPanel.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ShortlistPanel from '../../../../src/renderer/src/components/shortlist/ShortlistPanel.vue'

// Mock the composable so we can drive the panel through each state
vi.mock('../../../../src/renderer/src/composables/useShortlistQuery', () => {
  const { ref } = require('vue')
  const state = {
    shortlistPresets: ref([{ id: 1, name: 'Tier 1 candidates' }]),
    selectedPresetId: ref(1),
    result: ref(null),
    loading: ref(false),
    error: ref(null),
    refresh: vi.fn()
  }
  return {
    useShortlistQuery: () => state,
    __state: state
  }
})

import * as mod from '../../../../src/renderer/src/composables/useShortlistQuery'
const state = (mod as unknown as { __state: ReturnType<typeof mod.useShortlistQuery> }).__state

describe('ShortlistPanel', () => {
  it('renders loading skeleton when loading=true', async () => {
    state.loading.value = true
    state.result.value = null
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    expect(wrapper.find('[data-testid="shortlist-loading"]').exists()).toBe(true)
  })

  it('renders error alert when error is set', async () => {
    state.loading.value = false
    state.error.value = new Error('boom')
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    expect(wrapper.text()).toContain('boom')
  })

  it('renders empty state when result.rows is empty', async () => {
    state.error.value = null
    state.result.value = { rows: [], totalCandidates: 0, presetUsed: null, elapsedMs: 10 }
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    expect(wrapper.text()).toContain('No variants matched')
  })

  it('renders ShortlistTable when rows are present', async () => {
    state.result.value = {
      rows: [{ id: 1, rank: 1, rank_score: 0.9 } as never],
      totalCandidates: 10, presetUsed: null, elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    expect(wrapper.findComponent({ name: 'ShortlistTable' }).exists()).toBe(true)
  })

  it('emits row-click when ShortlistTable emits row-click', async () => {
    state.result.value = {
      rows: [{ id: 1, rank: 1, rank_score: 0.9 } as never],
      totalCandidates: 1, presetUsed: null, elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('row-click', { id: 1 })
    expect(wrapper.emitted('row-click')).toBeTruthy()
  })

  it('emits open-in-tab when ShortlistTable emits open-in-tab', async () => {
    state.result.value = {
      rows: [{ id: 1, rank: 1 } as never], totalCandidates: 1, presetUsed: null, elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('open-in-tab', 'sv')
    expect(wrapper.emitted('open-in-tab')?.[0]?.[0]).toBe('sv')
  })

  it('toggle-star invokes annotations:upsertPerCase', async () => {
    // Mock window.api.annotations.upsertPerCase
    const upsert = vi.fn().mockResolvedValue({})
    ;(globalThis as unknown as { window: { api: unknown } }).window = {
      api: { annotations: { upsertPerCase: upsert } }
    }
    state.result.value = {
      rows: [{ id: 1, case_id: 1, is_starred: false } as never],
      totalCandidates: 1, presetUsed: null, elapsedMs: 10
    }
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    const table = wrapper.findComponent({ name: 'ShortlistTable' })
    await table.vm.$emit('toggle-star', { id: 1, case_id: 1, is_starred: false })
    await flushPromises()
    expect(upsert).toHaveBeenCalledWith(1, 1, { starred: true })
  })

  it('renders preset picker with shortlistPresets', async () => {
    const wrapper = mount(ShortlistPanel, { props: { caseId: 1 } })
    expect(wrapper.text()).toContain('Tier 1 candidates')
  })
})
```

Run: **FAIL**.

### Step 5.2: Implement `ShortlistPanel.vue`

Create `src/renderer/src/components/shortlist/ShortlistPanel.vue`:

```vue
<script setup lang="ts">
import { toRef } from 'vue'
import ShortlistTable from './ShortlistTable.vue'
import { useShortlistQuery } from '../../composables/useShortlistQuery'
import { logService } from '../../services/LogService'
import type { ShortlistRow, PerTypeTab } from '../../../../shared/types/shortlist'

const props = defineProps<{
  caseId: number
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: PerTypeTab): void
}>()

const caseIdRef = toRef(props, 'caseId')
const {
  shortlistPresets,
  selectedPresetId,
  result,
  loading,
  error,
  refresh
} = useShortlistQuery(caseIdRef)

async function onToggleStar(row: ShortlistRow): Promise<void> {
  try {
    await window.api.annotations.upsertPerCase(
      row.case_id,
      row.id,
      { starred: !row.is_starred }
    )
    // No manual refresh — the variants:annotationChanged broadcast
    // triggers a refetch via useShortlistQuery's subscription.
  } catch (e) {
    logService.error(
      `toggle star failed: ${e instanceof Error ? e.message : String(e)}`,
      'shortlist.panel'
    )
  }
}
</script>

<template>
  <div class="shortlist-panel">
    <div class="shortlist-panel__header d-flex align-center ga-3 pa-2">
      <v-select
        v-model="selectedPresetId"
        :items="shortlistPresets"
        item-title="name"
        item-value="id"
        label="Preset"
        density="compact"
        hide-details
        variant="outlined"
        style="max-width: 320px"
      />
      <div v-if="result" class="text-caption text-medium-emphasis">
        Scored: {{ result.totalCandidates }} → top {{ result.rows.length }}
        <span class="ml-2">({{ result.elapsedMs }}ms)</span>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="refresh"
      >
        Refresh
      </v-btn>
    </div>

    <div v-if="loading" data-testid="shortlist-loading" class="pa-3">
      <v-progress-linear indeterminate class="mb-3" />
      <v-skeleton-loader type="table-row@5" />
    </div>

    <v-alert
      v-else-if="error"
      type="error"
      variant="tonal"
      class="ma-3"
      closable
      @click:close="error = null"
    >
      {{ error.message }}
      <template #append>
        <v-btn variant="text" size="small" @click="refresh">Retry</v-btn>
      </template>
    </v-alert>

    <div v-else-if="result && result.rows.length === 0" class="pa-6 text-center text-medium-emphasis">
      No variants matched the shortlist filters.
    </div>

    <ShortlistTable
      v-else-if="result"
      :rows="result.rows"
      @row-click="(row) => emit('row-click', row)"
      @open-in-tab="(t) => emit('open-in-tab', t)"
      @toggle-star="onToggleStar"
    />
  </div>
</template>

<style scoped>
.shortlist-panel { display: flex; flex-direction: column; min-height: 0; }
.shortlist-panel__header { border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
</style>
```

### Step 5.3: Run tests + CI + commit

```bash
npx vitest run tests/renderer/components/shortlist/ShortlistPanel.test.ts
make ci

git add \
  src/renderer/src/components/shortlist/ShortlistPanel.vue \
  tests/renderer/components/shortlist/ShortlistPanel.test.ts

git commit -m "$(cat <<'EOF'
feat(renderer): ShortlistPanel composition

Wave 5 of the unified shortlist rollout. Composes ShortlistTable +
useShortlistQuery + preset picker into the panel host.

Four visual states routed from composable state:
  loading  → v-progress-linear + skeleton rows
  error    → v-alert + Retry button
  empty    → "No variants matched the shortlist filters."
  success  → <ShortlistTable> with row-click / open-in-tab / toggle-star
             forwarded to parent (CaseView, wired in Wave 6)

toggle-star writes through annotations:upsertPerCase and relies on
the variants:annotationChanged broadcast (Wave 1.E) to trigger a
refetch via the composable's subscription — no manual refresh call.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Wave 6: CaseView tab wiring + VariantTable interactive prop (atomic)

**Wave:** 6  
**Depends on:** Task 5 (ShortlistPanel)  
**Parallel with:** none

**Authorized files:**
- `src/renderer/src/views/CaseView.vue` (modify)
- `src/renderer/src/components/VariantTable.vue` (modify)
- `tests/renderer/views/CaseView.test.ts` (modify — extend existing test file)
- `tests/renderer/components/variant-table/interactive-prop.test.ts` (new — keyboard-gate test)

**Spec sections:** §6 (CaseView.vue tab integration, default selection logic, VariantTable interactive prop, ownership model, lifecycle rules in shortlist mode)

**Commit:** `feat(renderer): Shortlist tab wiring + VariantTable interactive prop`

**CRITICAL — single atomic commit:** both files ship in the same commit. Splitting would produce either (a) a type error (CaseView binds `:interactive` with no prop on VariantTable) or (b) a live bug (VariantTable has the prop but CaseView never sets it, so hidden-table keystrokes still fire). The spec §6 explicitly mandates this atomicity — see "VariantTable interactive prop (new)" and "Wave authorization is updated accordingly" notes.

### Files

- **Modify:** `src/renderer/src/views/CaseView.vue`
- **Modify:** `src/renderer/src/components/VariantTable.vue`
- **Modify:** `tests/renderer/views/CaseView.test.ts`
- **Create:** `tests/renderer/components/variant-table/interactive-prop.test.ts`

### Step 6.1: Write failing `VariantTable` interactive-prop test

Create `tests/renderer/components/variant-table/interactive-prop.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VariantTable from '../../../../src/renderer/src/components/VariantTable.vue'

describe('VariantTable interactive prop (keyboard gate)', () => {
  it('default is interactive=true (existing behavior)', () => {
    const wrapper = mount(VariantTable, { props: { caseId: 1, variantType: 'snv', filters: {} } as never })
    expect((wrapper.vm.$props as { interactive: boolean }).interactive).toBe(true)
  })

  it('interactive=false suppresses ArrowDown keystroke', async () => {
    // Mount two instances: one interactive, one not. Dispatch keydown on window.
    // Assert the interactive one moves selection, the non-interactive one does not.
    // Exact selector/state access depends on VariantTable's current test harness —
    // extend existing tests in tests/renderer/components/variant-table/ to reuse
    // their setup helpers.
  })

  it('interactive=false suppresses "s" star toggle keystroke', async () => {
    // Similar pattern — assert handleStarToggle is NOT called on the hidden table
  })

  // Add one test per suppressed key: ArrowUp, ArrowDown, Enter, Escape, s, c, a
})
```

> The implementer must read the existing `tests/renderer/components/variant-table/` test files and reuse their mounting helpers and mocks (the composables behind VariantTable have many dependencies). The goal is to assert that each `onKeyStroke` handler's `if (!props.interactive || ...)` guard short-circuits when `interactive=false`. Add one assertion per key: `ArrowUp`, `ArrowDown`, `Enter`, `Escape`, `s`, `c`, `a`.

### Step 6.2: Add `interactive` prop to `VariantTable.vue`

Open `src/renderer/src/components/VariantTable.vue`. Locate the existing `withDefaults(defineProps<...>(), { ... })` block and add `interactive?: boolean` with default `true`:

```typescript
const props = withDefaults(
  defineProps<{
    // ... existing props unchanged ...
    /**
     * Whether this VariantTable instance is currently interactive.
     * When false, global keyboard shortcuts registered by this component
     * are suppressed. Default true preserves existing behavior.
     */
    interactive?: boolean
  }>(),
  {
    // ... existing defaults unchanged ...
    interactive: true
  }
)
```

Then, for **every** `onKeyStroke(...)` handler in the file, prepend `!props.interactive ||` to the existing guard. There are seven handlers per spec §6:

```typescript
onKeyStroke('ArrowDown', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  e.preventDefault()
  moveDown()
}, { dedupe: true })

onKeyStroke('ArrowUp', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  // ...
}, { dedupe: true })

onKeyStroke('Enter', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  // ...
})

onKeyStroke('Escape', (e) => {
  if (!props.interactive || !viewActive.value) return
  // ...
})

onKeyStroke('s', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  // ...
})

onKeyStroke('c', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  // ...
})

onKeyStroke('a', (e) => {
  if (!props.interactive || !viewActive.value || isInputFocused()) return
  // ...
})
```

**Do not modify any other part of `VariantTable.vue`**. This is a strictly six-line (plus prop declaration) change per spec §6.

### Step 6.3: Write failing `CaseView` tab-integration test extensions

Open `tests/renderer/views/CaseView.test.ts` and append test cases:

```typescript
describe('CaseView — Shortlist tab', () => {
  it('does NOT show Shortlist tab when only SNV variants are present', async () => {
    // Seed typeCounts = { snv: 10, sv: 0, cnv: 0, str: 0 }
    // Mount CaseView, assert no v-tab labeled "Shortlist"
  })

  it('shows Shortlist tab when >1 type is present', async () => {
    // typeCounts = { snv: 10, sv: 3 }
  })

  it('defaults to Shortlist when presentTypes.length > 1', async () => {
    // After loadTypeCounts resolves, selectedVariantType should be 'shortlist'
  })

  it('seeds lastNonShortlistType to first present type (cnv+str case)', async () => {
    // typeCounts = { cnv: 2, str: 1 }, snv=0
    // After loadTypeCounts: lastNonShortlistType.value === 'cnv'
  })

  it('does NOT override selectedVariantType when user explicitly picked a tab', async () => {
    // Mount, user picks 'sv', loadTypeCounts resolves multi-type → stays on 'sv'
  })

  it('variantTableType computed never yields "shortlist"', async () => {
    // When selectedVariantType='shortlist', variantTableType falls back to lastNonShortlistType
  })

  it('toggle Shortlist → SNV → Shortlist preserves hidden VariantTable state', async () => {
    // Mount with 2 types, verify VariantTable rows ref is the same object across toggles
  })

  it('binds :interactive prop from selectedVariantType !== "shortlist"', async () => {
    // Mount, verify VariantTable's interactive prop is true on SNV tab, false on Shortlist tab
  })

  it('emits from ShortlistPanel open-in-tab switches selectedVariantType', async () => {
    // Simulate ShortlistPanel open-in-tab='sv', assert tab switches
  })
})
```

### Step 6.4: Modify `CaseView.vue` — type aliases, refs, computed, template

Open `src/renderer/src/views/CaseView.vue`. Apply the changes from spec §6 verbatim (the spec's code samples are already review-hardened):

1. **Add type aliases** at the top of `<script setup>`:

```typescript
import type { VisibleTab, PerTypeTab } from '../../../shared/types/shortlist'
import ShortlistPanel from '../components/shortlist/ShortlistPanel.vue'
```

2. **Add the `getPresentTabTypes` helper** (shared between `tabItems` and `loadTypeCounts` — domain rule, not display trivia):

```typescript
/**
 * Returns the per-type tabs that should be shown for this case, in
 * canonical display order. Folds 'indel' into 'snv'. Returns an empty
 * array for an empty case.
 */
function getPresentTabTypes(counts: Record<string, number>): PerTypeTab[] {
  const present: PerTypeTab[] = []
  if ((counts.snv ?? 0) + (counts.indel ?? 0) > 0) present.push('snv')
  if ((counts.sv ?? 0) > 0) present.push('sv')
  if ((counts.cnv ?? 0) > 0) present.push('cnv')
  if ((counts.str ?? 0) > 0) present.push('str')
  return present
}
```

3. **Replace the existing `tabItems` computed** to use the helper and prepend Shortlist when multi-type:

```typescript
const tabItems = computed(() => {
  const counts = typeCounts.value
  const presentTypes = getPresentTabTypes(counts)
  const snvCount = (counts.snv ?? 0) + (counts.indel ?? 0)
  const items: TabItem[] = []

  if (presentTypes.length > 1) {
    items.push({ type: 'shortlist', label: 'Shortlist', count: null, icon: 'mdi-star-circle' })
  }

  if (presentTypes.includes('snv')) {
    items.push({ type: 'snv', label: 'SNV/Indel', count: snvCount })
  }
  if ((counts.sv ?? 0) > 0)  items.push({ type: 'sv',  label: 'SV',  count: counts.sv! })
  if ((counts.cnv ?? 0) > 0) items.push({ type: 'cnv', label: 'CNV', count: counts.cnv! })
  if ((counts.str ?? 0) > 0) items.push({ type: 'str', label: 'STR', count: counts.str! })

  return items
})
```

> Note: the `TabItem` type may need widening to include `type: VisibleTab` and optional `icon`. Update the existing declaration.

4. **Change `selectedVariantType` ref type** to `VisibleTab` and add `lastNonShortlistType` + watcher:

```typescript
const selectedVariantType = ref<VisibleTab>('snv')

const lastNonShortlistType = ref<PerTypeTab>('snv')

watch(selectedVariantType, (next) => {
  if (next !== 'shortlist') {
    lastNonShortlistType.value = next
  }
})

const variantTableType = computed<PerTypeTab>(() =>
  selectedVariantType.value === 'shortlist'
    ? lastNonShortlistType.value
    : selectedVariantType.value
)
```

5. **Change `effectiveFilters` to compose from `variantTableType`** (NOT `selectedVariantType`):

```typescript
const effectiveFilters = computed<Omit<VariantFilter, 'case_id'>>(() => ({
  ...currentFilters.value,
  variant_type: variantTableType.value
}))
```

6. **Extend `loadTypeCounts()` default-selection rule**:

```typescript
async function loadTypeCounts(caseId: number | null): Promise<void> {
  // ... existing code that populates typeCounts ...

  const presentTypes = getPresentTabTypes(typeCounts.value)

  if (selectedVariantType.value === 'snv') {
    if (presentTypes.length > 1) {
      lastNonShortlistType.value = presentTypes[0]
      selectedVariantType.value = 'shortlist'
    } else if (presentTypes.length === 1 && presentTypes[0] !== 'snv') {
      selectedVariantType.value = presentTypes[0]
    }
  }
}
```

7. **Update the template** — `v-show` per-type region, `v-if` shortlist region, `:interactive` binding:

```vue
<template>
  <!-- ... existing <v-tabs v-model="selectedVariantType"> ... -->

  <div v-show="selectedVariantType !== 'shortlist'">
    <div class="filter-bar-container">
      <FilterToolbar
        ref="filterToolbarRef"
        :case-id="selectedCaseId"
        <!-- ...existing props... -->
      />
    </div>
    <VariantTable
      ref="variantTableRef"
      :case-id="selectedCaseId"
      :variant-type="variantTableType"
      :filters="effectiveFilters"
      :interactive="selectedVariantType !== 'shortlist'"
      <!-- ...existing props... -->
    />
  </div>

  <ShortlistPanel
    v-if="selectedVariantType === 'shortlist'"
    :case-id="selectedCaseId"
    @open-in-tab="(t) => { selectedVariantType = t }"
    @row-click="handleRowClick"
  />
</template>
```

> **Critical:** `handleRowClick` already accepts `Variant`. `ShortlistRow` extends `ShortlistCandidate` extends `Variant`, so the assignment `selectedPanelVariant.value = row` is structurally valid with zero coercion (spec §4 row-click contract).

### Step 6.5: Run all tests + CI

```bash
npx vitest run tests/renderer/views/CaseView.test.ts tests/renderer/components/variant-table
make ci
```

Expected: **PASS** — every existing `VariantTable` test continues to pass because `interactive` defaults to `true`, and every new test case green.

### Step 6.6: Commit (atomic)

```bash
git add \
  src/renderer/src/views/CaseView.vue \
  src/renderer/src/components/VariantTable.vue \
  tests/renderer/views/CaseView.test.ts \
  tests/renderer/components/variant-table/interactive-prop.test.ts

git commit -m "$(cat <<'EOF'
feat(renderer): Shortlist tab wiring + VariantTable interactive prop

Wave 6 of the unified shortlist rollout. Wires ShortlistPanel into
CaseView as a new 'Shortlist' tab that appears when more than one
variant type is present, and adds the VariantTable `interactive` prop
gate that suppresses global keyboard shortcuts on the hidden-via-v-show
per-type region.

CaseView changes:
  - VisibleTab / PerTypeTab type aliases (never-'shortlist' invariant
    enforced by TypeScript, not watcher convention)
  - getPresentTabTypes() helper shared between tabItems and
    loadTypeCounts default-selection (SNV/indel folding is domain logic)
  - selectedVariantType: ref<VisibleTab>, lastNonShortlistType:
    ref<PerTypeTab>, variantTableType: computed<PerTypeTab>
  - effectiveFilters composes from variantTableType (not
    selectedVariantType) so VariantTable's filter prop never sees
    'shortlist' and useVariantData's serialized-filter watcher stays
    stable across Shortlist toggles — load-bearing for the 'hidden
    state persists' guarantee
  - loadTypeCounts default-selection: multi-type case → lands on
    Shortlist AND seeds lastNonShortlistType to first present real
    type (fixes stale-'snv' hidden preload on cnv+str cases)
  - Template: v-show per-type region (persistent), v-if shortlist
    region (mount-on-demand), :interactive bound to
    `selectedVariantType !== 'shortlist'`

VariantTable changes:
  - New optional `interactive?: boolean` prop, default true
  - Every onKeyStroke handler (ArrowUp, ArrowDown, Enter, Escape,
    s, c, a) prepends `!props.interactive ||` to its existing guard
  - Six-line + one-prop change — zero modifications to any
    composable, watcher, or lifecycle hook

This commit is ATOMIC — the two files must ship together. Wiring
:interactive without the prop is a type error; shipping the prop
without wiring leaves the keyboard-gate bug live. Spec §6 mandates
the atomicity; Wave 6 authorization covers both files.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Wave 7: Coverage thresholds + release notes

**Wave:** 7  
**Depends on:** Task 6 (feature complete)  
**Parallel with:** none

**Authorized files:**
- `vitest.config.ts` (modify — add coverage thresholds)
- `CHANGELOG.md` (modify — add unreleased entry)
- `.planning/docs/UI-PATTERNS.md` (optional update — shortlist component patterns section, only if genuinely useful)

**Spec sections:** §8 (coverage targets), §10 (release)

**Commit:** `chore(shortlist): coverage thresholds + release notes`

### Files

- **Modify:** `vitest.config.ts`
- **Modify:** `CHANGELOG.md`

### Step 7.1: Raise coverage thresholds

Open `vitest.config.ts`. Locate the existing `coverage: { thresholds: { ... } }` block. Add per-file thresholds matching spec §8:

```typescript
coverage: {
  // ... existing root thresholds unchanged ...
  thresholds: {
    // ... existing ...
    'src/main/services/scoring/**': {
      lines: 95, branches: 90, functions: 95, statements: 95
    },
    'src/main/database/ShortlistService.ts': {
      lines: 85, branches: 80, functions: 85, statements: 85
    },
    'src/main/database/shortlist-query.ts': {
      lines: 90, branches: 85, functions: 90, statements: 90
    },
    'src/main/ipc/handlers/shortlist.ts': {
      lines: 85, branches: 80, functions: 85, statements: 85
    },
    'src/renderer/src/composables/useShortlistQuery.ts': {
      lines: 80, branches: 70, functions: 80, statements: 80
    },
    'src/renderer/src/components/shortlist/**': {
      lines: 75, branches: 65, functions: 75, statements: 75
    }
  }
}
```

> Verify that the current `vitest.config.ts` supports per-file thresholds under `thresholds.'glob'`. If it uses a different syntax (`include`, `exclude`, `perFile: true`), adjust accordingly — the spec's coverage targets are the source of truth.

### Step 7.2: Add CHANGELOG entry

Open `CHANGELOG.md` and add under the unreleased section:

```markdown
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
```

### Step 7.3: Run full CI

```bash
make ci
```

Expected: **PASS** — all coverage thresholds met because each prior wave's tests cover their module.

### Step 7.4: Commit

```bash
git add vitest.config.ts CHANGELOG.md

git commit -m "$(cat <<'EOF'
chore(shortlist): coverage thresholds + release notes

Wave 7 of the unified shortlist rollout. Final commit — raises
per-file coverage thresholds for the scoring / service / query /
IPC / composable / component modules introduced across Waves 0-6
to the levels defined in spec §8. Adds an Unreleased CHANGELOG
entry describing the feature and migration v27.

Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§8)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 7.5: Push + open PR

```bash
git push origin feature/unified-shortlist
gh pr create --base main --head feature/unified-shortlist \
  --title "feat: unified case shortlist with cross-type ranking" \
  --body "$(cat .planning/plans/2026-04-11-unified-shortlist-plan.md | head -50)

See the 12 commits in this PR — one per task, Wave 0 → Wave 7. Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md

## Test plan
- [ ] Open a multi-type case → Shortlist tab default-active
- [ ] Select each preset → ranked list renders with score tooltips
- [ ] Star a variant in any tab → Shortlist refreshes within one IPC RTT
- [ ] Click a row → VariantDetailsPanel opens unchanged
- [ ] 'View in [type] tab' action → switches tab, per-type state preserved
- [ ] Single-type case → no Shortlist tab shown
- [ ] make ci green"
```

---

## Self-review checklist

Run these checks after the plan is written — each one catches a common failure mode.

### 1. Spec coverage

Walk each spec section and confirm a task implements it:

| Spec § | Section | Task(s) |
|---|---|---|
| §1 | Overview / foundational work | Context only — no task |
| §2 | Goals + non-goals | Tasks 0-7 collectively; non-goals enforced by exclusion |
| §3 | Two-stage architecture + new modules + modified modules | Tasks 1.A (scoring), 1.C (Stage 1 query), 2 (orchestrator) |
| §4 | Score engine — types, combine, helpers, per-type scorers, dispatch, sort, ShortlistCandidate contract, design commitments | Tasks 0 (types), 1.A (scorers + compareScoredRows) |
| §5 | Data model — ShortlistConfig, FilterState extension, filter merge semantics, migration v27, built-in presets, IPC contract, Zod schemas | Tasks 0 (types + Zod), 1.B (migration + presets), 2 (merge in service) |
| §6 | UI layer — CaseView tab integration, default selection, VariantTable interactive prop, ownership model, lifecycle rules, ShortlistPanel, ShortlistTable, RankScoreTooltip, useShortlistQuery, annotation broadcast | Tasks 1.D (leaves), 1.E (broadcast), 4 (composable), 5 (panel), 6 (CaseView + VariantTable) |
| §7 | Error handling boundaries 1-4, observability, security | Tasks 2 (service error boundaries 1-3), 3 (IPC error boundary 4 + sort-key allowlist), 1.A (scorer malformed input) |
| §8 | Unit, integration, renderer tests; fixture infrastructure; coverage targets; testing non-goals | Every task has its own test step; fixture in 1.A; coverage thresholds in 7 |
| §9 | Wave-based parallel rollout | Entire plan structure + "Branch & worktree workflow" section |
| §10 | Risk register | Risks addressed across tasks (e.g. #4 broadcast infra → Task 1.E; #10 row-shape drift → Tasks 0 + 1.C structural test) |

### 2. Placeholder scan — red flags the executor must NOT encounter

- [ ] No "TBD", "TODO", "fill in later", "implement the rest" inside any step
- [ ] No "add error handling" without showing what it is
- [ ] No "write tests for the above" without actual test code
- [ ] No "similar to Task N" shortcuts — each task is self-contained

### 3. Type / name consistency

- [ ] Every task references `ShortlistCandidate`, `ScoredCandidate`, `ShortlistRow`, `ShortlistConfig`, `ShortlistResult` with the exact same casing
- [ ] `rank_score` / `rank_components` / `rank_clinvar_pinned` / `rank_starred_pinned` used consistently (not e.g. `rankScore` in one place)
- [ ] `is_starred` (snake_case, matches SQL) used consistently — NOT `isStarred`
- [ ] `variants:shortlist` IPC channel name matches across handler, preload, composable
- [ ] `variants:annotationChanged` broadcast channel name matches across main-process emitter, preload subscription, composable consumption
- [ ] `mapConsequenceImpact` / `mapClinvarBoost` imported from `./index` in per-type scorer files (not `./scoring/index`)
- [ ] `PerTypeTab` / `VisibleTab` used in CaseView, not `string`
- [ ] `ShortlistCandidate extends Variant` — the drill-down row-click contract — is referenced by Task 6 handleRowClick explanation
- [ ] Migration version is `v27` everywhere (not `v26` or `v28`)
- [ ] Built-in preset names are "Tier 1 candidates", "All rare damaging", "Recessive candidates" (exact casing) everywhere

### 4. Commit count verification

12 commits total:
- Wave 0: 1 (Task 0)
- Wave 1: 5 (Tasks 1.A, 1.B, 1.C, 1.D, 1.E)
- Wave 2: 1 (Task 2)
- Wave 3: 1 (Task 3)
- Wave 4: 1 (Task 4)
- Wave 5: 1 (Task 5)
- Wave 6: 1 (Task 6)
- Wave 7: 1 (Task 7)

Total: **12 commits**. Matches spec §9.

---

