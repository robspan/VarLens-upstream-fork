# Shortlist scoring heuristic — reference

**Single source of truth** for how VarLens ranks variants in the case
Shortlist tab. Every numeric threshold, every sub-score curve, every
partition rule, and every null-value fallback is documented here. This
page is the authoritative reference — the code in
`src/main/services/scoring/` is the implementation, and the two MUST stay
in sync.

**Where things live**

| File | Role |
|---|---|
| `src/main/services/scoring/scoring-config.ts` | **All tunable constants.** Every threshold, multiplier, cutoff, and fallback. No magic numbers live anywhere else in the scoring module. |
| `src/main/services/scoring/index.ts` | Public API: `scoreRow`, `combine`, `compareScoredRows`, `mapConsequenceImpact`, `mapClinvarBoost`, `ZERO_COMPONENTS`. |
| `src/main/services/scoring/score-snv.ts` | SNV / indel per-type scorer. |
| `src/main/services/scoring/score-sv.ts` | SV per-type scorer. |
| `src/main/services/scoring/score-cnv.ts` | CNV per-type scorer. |
| `src/main/services/scoring/score-str.ts` | STR per-type scorer. |
| `src/main/database/built-in-shortlist-presets.ts` | The three built-in presets with their weights and filters. |
| `tests/main/services/scoring/**` | 56 unit tests locking the formulas in as inline-snapshot regressions. |

**Spec:** `.planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md`
(§4 score engine, §8 tests)

---

## 1. Overview

The Shortlist scorer runs a **three-phase pipeline** over every
`ShortlistCandidate` that Stage 1 returned from SQLite:

```
Phase 1  component extraction  (per-type scorer)
         → RankComponents { impact, pathogenicity, rarity, clinvar, phenotype }
Phase 2  combine()             (weighted sum, normalized by weight total)
         → rank_score ∈ [0, 1]
Phase 3  compareScoredRows()   (partition sort with pin rules)
         → total ordering
```

All phase-1 components are bounded to `[0, 1]`. Phase 2 normalizes by the
sum of weights, so `rank_score` is also in `[0, 1]` regardless of whether
the caller passes fractional (`0..1`) or percentage (`0..100`) weights.
Phase 3 is a pure comparator — no scoring happens there, only ordering.

The scorer is **pure TypeScript**. No DB access, no I/O, no
async/await — a single bad row is caught inside `scoreRow` and falls
back to `ZERO_COMPONENTS` so it sorts to the bottom without poisoning
the rest of the pass (spec §7 boundary 2).

---

## 2. Five rank components

Every per-type scorer returns a `RankComponents` object with the same
five fields. Each represents one axis of clinical relevance:

| Component | What it measures | Typical data source |
|---|---|---|
| **impact** | How disruptive is this variant to gene function? | VEP IMPACT (SNV), length/event-type (SV), copy number (CNV), pathologic status (STR) |
| **pathogenicity** | How much do we believe it's damaging? | CADD (SNV), VAF × precision (SV), caller quality (CNV), known-locus flag (STR) |
| **rarity** | How rare is this allele in the population? | gnomAD AF (SNV); placeholder 1.0 for SV/CNV/STR (no pop-freq source wired) |
| **clinvar** | Clinical-significance boost from ClinVar | Shared lookup table; STR short-circuit for known loci |
| **phenotype** | HPO phenotype similarity | `hpo_sim_score` field; 0 when null |

All five are bounded `[0, 1]`. A component never exceeds 1 and is never
negative.

---

## 3. Shared lookup tables

### 3.1 VEP IMPACT → `impact` sub-score

Source: `SCORING_CONFIG.consequenceImpact` in `scoring-config.ts`.

| IMPACT | Score | Rationale |
|---|---|---|
| `HIGH` | **1.0** | Stop-gained, frameshift, splice-acceptor/donor, start-lost, stop-lost, transcript-ablation |
| `MODERATE` | **0.66** | Missense, inframe indel, protein-altering variants. The two-thirds step matches Exomiser / LIRICAL convention. |
| `LOW` | **0.33** | Synonymous, splice-region, 5'/3' UTR — meaningful enough to contribute but cannot compete with HIGH rows |
| `MODIFIER` | **0.0** | Intronic, intergenic, non-coding transcript — contributes nothing unless another term boosts the row |
| null / unknown | **0.0** | Absence of annotation — no impact credit |

Accessed via `mapConsequenceImpact(consequence: string | null)`.

### 3.2 ClinVar significance → `clinvar` sub-score

Source: `SCORING_CONFIG.clinvarBoost`.

| ClinVar string | Score | Rationale |
|---|---|---|
| `Pathogenic` | **1.0** | Full boost |
| `Pathogenic/Likely_pathogenic` | **0.95** | Combined form seen in ClinVar exports |
| `Likely_pathogenic` | **0.9** | ≥ 0.9 threshold means this row still participates in `clinvarPinTop` |
| `Uncertain_significance` | **0.3** | VUS gets a small positive boost — ranks above no-ClinVar rows when other components tie |
| `Likely_benign` | **0.0** | No credit |
| `Benign` | **0.0** | No credit |
| null / unknown | **0.0** | No credit |

Accessed via `mapClinvarBoost(clinvar: string | null)`.

---

## 4. Per-type scorers

All numeric thresholds below live in `scoring-config.ts`. The config
field name is shown in `code` after each value.

### 4.1 SNV / indel (`score-snv.ts`)

Applies to `variant_type === 'snv'` and `variant_type === 'indel'`.

```
impact        = mapConsequenceImpact(row.consequence)
pathogenicity = row.cadd == null
                  ? 0
                  : min(row.cadd / 40, 1)                    ← snv.caddSaturationCeiling
rarity        = row.gnomad_af == null
                  ? 1.0                                      ← snv.nullRarityDefault
                  : max(0, 1 - min(row.gnomad_af / 0.01, 1)) ← snv.rarityUpperCutoffAf
clinvar       = mapClinvarBoost(row.clinvar)
phenotype     = row.hpo_sim_score ?? 0                       ← defaults.nullPhenotypeScore
```

**Rationale:**
- **CADD saturation at 40** — Rentzsch et al. (2019) describe CADD ≥ 20 as "top 1% deleterious" and CADD ≥ 30 as "top 0.1%". 40 is the commonly cited high-confidence damaging ceiling beyond which additional points stop separating candidates. Linear from 0 to 40 and clamped.
- **Rarity cutoff at AF = 0.01** — the standard clinical rarity threshold for Mendelian variant triage. ACMG BA1 (5%) and BS1 (1%) bracket this; we use the stricter BS1 value. Between 0 and 0.01, rarity scales linearly.
- **Null gnomAD AF → rarity 1.0** — "absence of evidence ≠ evidence of absence." A novel variant that gnomAD hasn't seen should surface at the top of the shortlist, not be penalized.

### 4.2 SV (`score-sv.ts`)

```
precisionFactor = row.sv_is_precise === 1
                    ? 1.0               ← sv.precisePathogenicityFactor
                    : 0.7               ← sv.imprecisePathogenicityFactor

vaf             = row.sv_vaf ?? 0.5     ← sv.nullVafDefault

impact          = row.sv_length != null && row.sv_length >= 1000
                    ? 1.0               ← sv.largeEventImpact
                    : 0.66              ← sv.smallEventImpact
                                          ← sv.largeEventLengthThresholdBp = 1000
pathogenicity   = min(vaf × precisionFactor, 1)
rarity          = 1.0                   ← sv.rarityPlaceholder
clinvar         = mapClinvarBoost(row.clinvar)
phenotype       = row.hpo_sim_score ?? 0
```

**Rationale:**
- **Imprecise penalty of 30%** — imprecise breakpoints mean we have lower confidence in both the event extent AND the reported VAF. Penalizing by a fixed factor is crude but keeps imprecise calls out of the top unless everything else about them screams.
- **1 kb large-event threshold** — conventional cutoff at which an SV stops looking like an indel and starts looking like a gene-disrupting event (exon-scale).
- **Unknown length → small bucket** — unknown length is NOT a confident large-event signal. Falls into the 0.66 bucket on purpose.
- **Null VAF → 0.5** — middling, on purpose. We have neither low nor high confidence.
- **Rarity placeholder 1.0** — no gnomAD-SV source wired yet (Phase-1 limitation, documented in spec).

### 4.3 CNV (`score-cnv.ts`)

```
impact =
    cn == null                      → 0     ← cnv.neutralOrUnknownImpact
    cn <= 0                         → 1.0   ← cnv.homozygousDeletionImpact
                                            ← cnv.homozygousDeletionCnCutoff = 0
    cn === 1                        → 0.66  ← cnv.partialLossOrGainImpact
                                            ← cnv.heterozygousDeletionCn = 1
    cn >= 3                         → 0.66  ← cnv.partialLossOrGainImpact
                                            ← cnv.duplicationCnCutoff = 3
    otherwise (cn === 2, diploid)   → 0     ← cnv.neutralOrUnknownImpact

pathogenicity = row.cnv_copy_number_quality == null
                  ? 0
                  : min(quality / 100, 1)   ← cnv.qualitySaturationCeiling
rarity        = 1.0                         ← cnv.rarityPlaceholder
clinvar       = mapClinvarBoost(row.clinvar)
phenotype     = row.hpo_sim_score ?? 0
```

**Rationale:**
- **Homozygous deletion → top tier** — full loss of both alleles is the clearest loss-of-function signal CNV data can provide.
- **Het del OR dup → 0.66** — partial loss and gain events both matter clinically but don't carry the same weight as full bi-allelic loss.
- **Neutral or unknown → 0** — diploid CN=2 contributes nothing; unknown is treated as neutral on purpose (caller didn't produce a usable number).
- **Quality saturation at 100** — most CNV callers report a ~0-100 phred-like scale; higher values clamp down to 1.0.
- **Rarity placeholder 1.0** — no CNV frequency source wired.

### 4.4 STR (`score-str.ts`)

```
statusImpact =
    row.str_status === 'pathologic'   → 1.0   ← str.pathologicImpact
    row.str_status === 'intermediate' → 0.66  ← str.intermediateImpact
    otherwise                          → 0    ← str.normalOrUnknownImpact

knownLocus = row.str_disease != null && row.str_disease.trim() !== ''

impact        = statusImpact
pathogenicity = knownLocus
                  ? 1.0   ← str.knownLocusPathogenicity
                  : 0.5   ← str.unknownLocusPathogenicity
rarity        = 1.0       ← str.rarityPlaceholder
clinvar       = knownLocus
                  ? 0.9   ← str.knownLocusClinvarShortcut
                  : mapClinvarBoost(row.clinvar)
phenotype     = row.hpo_sim_score ?? 0
```

**Rationale:**
- **Pathologic status → 1.0** — the caller has already determined the expansion exceeds the pathologic threshold for that locus. This is the strongest signal STR data provides.
- **Intermediate → 0.66** — premutation-range or borderline expansions. Meaningful but not definitively pathologic.
- **Known-locus pathogenicity 1.0** — pathologic / intermediate expansions at Mendelian loci (HTT, FMR1, C9orf72, etc.) are effectively always clinically relevant.
- **Unknown-locus 0.5** — partial credit because we detected the expansion but without a known gene/disease link the clinical significance is unclear.
- **Known-locus ClinVar short-circuit 0.9** — the DESIGN CALL. Mendelian STR loci are effectively always P/LP when their status is pathologic/intermediate, even if the source VCF lacks a direct ClinVar string match for the sample's exact expansion. Setting this to 0.9 matches the Likely_pathogenic boost level so these STRs participate in `clinvarPinTop`.
- **Rarity placeholder 1.0** — no STR frequency source.

---

## 5. Phase 2 — `combine()`: weighted sum

```typescript
rank_score = (
    weights.impact        × components.impact
  + weights.pathogenicity × components.pathogenicity
  + weights.rarity        × components.rarity
  + weights.clinvar       × components.clinvar
  + weights.phenotype     × components.phenotype
) / (
    weights.impact
  + weights.pathogenicity
  + weights.rarity
  + weights.clinvar
  + weights.phenotype
)
```

Key properties:

- **Always normalized** by the weight sum, so `rank_score ∈ [0, 1]` regardless of whether weights are fractional (`0..1`) or percentages (`0..100`). Scale-free.
- **Weight sum = 0 short-circuits to 0** (defensive, prevents divide-by-zero).
- **No weight re-sorting** — the order of components in the formula has no effect; addition is commutative.

---

## 6. Phase 3 — `compareScoredRows()`: total ordering

Rows are sorted with a **5-level partition**:

1. **Starred-pinned first** — when `config.pinStarredTop === true` AND `row.is_starred === true`, the row is placed at the top of the list.
2. **ClinVar-pinned next** — when `config.clinvarPinTop === true` AND `components.clinvar >= 0.9`, the row is placed after any starred-pinned rows.
3. **`rank_score` DESC** — primary numeric sort. Higher scores first.
4. **Caller-supplied `tieBreakers`** — up to 10 sort directives (e.g. `[{ key: 'cadd', order: 'desc' }, { key: 'gene_symbol', order: 'asc' }]`). An IPC-level allowlist (see `src/main/ipc/handlers/shortlist.ts`) rejects unknown sort keys before they reach the comparator. Dotted extension keys like `sv.vaf` are normalized to flat aliases `sv_vaf` so tie-breakers on extension columns actually work.
5. **`id` ASC** — stable fallback so ordering is deterministic when everything else ties.

**Starred overrides ClinVar** by design — a user-curated star signal is a stronger indicator of interest than any automatic classification (spec §6 design commitments).

---

## 7. Built-in presets

Seeded into `filter_presets` by migration v27. Source:
`src/main/database/built-in-shortlist-presets.ts`.

### 7.1 Tier 1 candidates

The strict cross-type triage preset.

| Field | Value |
|---|---|
| `topN` | 50 |
| `variantTypeScope` | `['snv', 'indel', 'sv', 'cnv', 'str']` |
| `baseFilters` | `consequences: ['HIGH','MODERATE']`, `maxGnomadAf: 0.001` |
| `perTypeOverrides.sv` | `maxGnomadAf: 0.01` (loosened — no SV gnomAD source) |
| `perTypeOverrides.cnv` | `maxGnomadAf: 0.01` |
| `perTypeOverrides.str` | `{}` (no AF filter) |
| `rankConfig.weights` | `{ impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0 }` |
| `rankConfig.clinvarPinTop` | `true` |
| `rankConfig.pinStarredTop` | `true` |
| `tieBreakers` | `[{ key: 'cadd', order: 'desc' }, { key: 'chr', order: 'asc' }, { key: 'pos', order: 'asc' }]` |

Equal-weight across the four non-phenotype axes, with both pins active.

### 7.2 All rare damaging

The broader cross-type preset with no pins.

| Field | Value |
|---|---|
| `topN` | 200 |
| `baseFilters` | `consequences: ['HIGH','MODERATE']`, `maxGnomadAf: 0.01`, `minCadd: 15` |
| `rankConfig.weights` | `{ impact: 0.4, pathogenicity: 0.3, rarity: 0.3, clinvar: 0, phenotype: 0 }` |
| `rankConfig.clinvarPinTop` | `false` |
| `rankConfig.pinStarredTop` | `false` |
| `tieBreakers` | `[{ key: 'cadd', order: 'desc' }]` |

ClinVar weight zeroed — this preset is deliberately "what the predictor
thinks" without ClinVar bias. Score-driven ordering, no pins.

### 7.3 Recessive candidates

SNV / indel only. **Phase-1 limitation:** the spec's original design
included `inheritanceModes: ['homozygous','candidate_compound_het','autosomal_recessive']`,
but `buildBaseWhere` (the shared filter translator) does not yet support
inheritance-mode filtering. Rather than silently ignore the filter (which
would produce a misleading preset), the field has been removed from the
built-in and the rationale documented here.

| Field | Value |
|---|---|
| `topN` | 100 |
| `variantTypeScope` | `['snv', 'indel']` |
| `baseFilters` | `consequences: ['HIGH','MODERATE']`, `maxGnomadAf: 0.02` |
| `rankConfig.weights` | `{ impact: 0.3, pathogenicity: 0.2, rarity: 0.3, clinvar: 0.2, phenotype: 0 }` |
| `tieBreakers` | `[{ key: 'gene_symbol', order: 'asc' }, { key: 'cadd', order: 'desc' }]` |

---

## 8. Tuning the heuristic

To change a threshold or curve parameter:

1. Edit the corresponding field in `src/main/services/scoring/scoring-config.ts`.
2. Run `npx vitest run tests/main/services/scoring` to see which inline-snapshot tests break.
3. Update the snapshots (intentional formula change) or revert (unintended drift).
4. Update the corresponding **§4 per-type scorer** section in THIS document so the formula stays documented.
5. Update `CHANGELOG.md` under the `[Unreleased]` section.

**Never inline a new magic number in a scorer.** If you need a new
threshold, add it to the config first. The scorers import the whole
config and destructure what they need — the indirection is cheap and the
discoverability benefit is large.

---

## 9. Error resilience (spec §7 boundary 2)

`scoreRow()` wraps the per-type dispatch in a try/catch. A malformed
row (bad `variant_type`, thrown scorer, missing field) logs through
`mainLogger` and falls back to `ZERO_COMPONENTS`. The scored row still
goes through the sort — it just sinks to the bottom because its
weighted sum is 0. A single bad row does not poison the pass.

Locked in as a regression by `tests/main/database/ShortlistService.test.ts`:
> "Stage-2 error resilience (spec §7 boundary 2) — scoreRow internal try/catch keeps the pipeline alive when a per-type scorer throws"

---

## 10. Known gaps (Phase-1 limitations)

Documented here so a future engineer knows these are **deliberate**, not
bugs:

1. **SV / CNV / STR rarity is hardcoded to 1.0.** No population frequency source is wired for structural or repeat variants. All SVs / CNVs / STRs get full rarity credit by default. Adding gnomAD-SV (or equivalent) is a future wave — when it lands, `sv.rarityPlaceholder`, `cnv.rarityPlaceholder`, `str.rarityPlaceholder` become dead constants and the `rarity` line in the relevant scorer becomes a real computation.
2. **`inheritanceModes` filter is not forwarded to Stage 1.** `buildBaseWhere` doesn't model inheritance; porting the ~135 lines of Kysely trio/compound-het logic from `VariantFilterBuilder` into the raw-SQL builder is a separate wave. The "Recessive candidates" preset has the field removed and the limitation documented in its description.
3. **No phenotype source.** `hpo_sim_score` is read from the row if present, but VarLens doesn't ship with an HPO similarity pipeline yet. All three built-in presets currently weight `phenotype` at 0. The field and the formula slot exist so when phenotype scoring lands, no code changes to the scorer are needed — just a preset weight bump.

---

## 11. Testing

56 unit tests across 6 files in `tests/main/services/scoring/`:

| File | Coverage |
|---|---|
| `combine.test.ts` | 5 tests — weight normalization, zero-sum guard, arithmetic |
| `compare.test.ts` | 12 tests — partition ordering, pin interactions, tie-breakers, null handling |
| `score-snv.test.ts` | 11 tests — every branch (HIGH/MOD/LOW/MODIFIER/null, CADD null/saturation, AF null/common/rare, ClinVar P/LP/null) |
| `score-sv.test.ts` | 9 tests — precise/imprecise, length buckets, null VAF, ClinVar |
| `score-cnv.test.ts` | 10 tests — every CN bucket (0/1/2/3/6/null), quality null/normal/clamp |
| `score-str.test.ts` | 9 tests — pathologic/intermediate/normal/null, known/unknown/empty disease |

Plus the ShortlistService integration test
(`tests/main/database/ShortlistService.test.ts`) locks in the Stage-2
error-resilience contract.

Every test imports formulas via the scorer's public API, so a formula
change that drifts from the config surfaces as an inline-snapshot diff.

---

## 12. Complete constant reference

Every tunable constant in one table. Source:
`src/main/services/scoring/scoring-config.ts`.

### 12.1 Shared

| Config path | Value | Purpose |
|---|---|---|
| `consequenceImpact.HIGH` | `1.0` | VEP HIGH impact score |
| `consequenceImpact.MODERATE` | `0.66` | VEP MODERATE impact score |
| `consequenceImpact.LOW` | `0.33` | VEP LOW impact score |
| `consequenceImpact.MODIFIER` | `0.0` | VEP MODIFIER impact score |
| `clinvarBoost.Pathogenic` | `1.0` | Pathogenic boost |
| `clinvarBoost.Pathogenic/Likely_pathogenic` | `0.95` | Combined P/LP boost |
| `clinvarBoost.Likely_pathogenic` | `0.9` | LP boost (≥ pin threshold) |
| `clinvarBoost.Uncertain_significance` | `0.3` | VUS boost |
| `clinvarBoost.Likely_benign` | `0.0` | LB no credit |
| `clinvarBoost.Benign` | `0.0` | B no credit |

### 12.2 SNV

| Config path | Value | Purpose |
|---|---|---|
| `snv.caddSaturationCeiling` | `40` | CADD saturation point |
| `snv.rarityUpperCutoffAf` | `0.01` | gnomAD AF cutoff for rarity=0 |
| `snv.nullRarityDefault` | `1.0` | Rarity when AF null |

### 12.3 SV

| Config path | Value | Purpose |
|---|---|---|
| `sv.precisePathogenicityFactor` | `1.0` | VAF multiplier for precise calls |
| `sv.imprecisePathogenicityFactor` | `0.7` | VAF multiplier for imprecise calls |
| `sv.largeEventLengthThresholdBp` | `1000` | Length cutoff for large-event impact |
| `sv.largeEventImpact` | `1.0` | Impact score at/above threshold |
| `sv.smallEventImpact` | `0.66` | Impact score below threshold or unknown length |
| `sv.nullVafDefault` | `0.5` | VAF when null |
| `sv.rarityPlaceholder` | `1.0` | Rarity (no gnomAD-SV source) |

### 12.4 CNV

| Config path | Value | Purpose |
|---|---|---|
| `cnv.homozygousDeletionCnCutoff` | `0` | CN ≤ this → homozygous deletion |
| `cnv.heterozygousDeletionCn` | `1` | CN === this → het deletion |
| `cnv.duplicationCnCutoff` | `3` | CN ≥ this → duplication/gain |
| `cnv.homozygousDeletionImpact` | `1.0` | Impact for CN ≤ 0 |
| `cnv.partialLossOrGainImpact` | `0.66` | Impact for CN === 1 or ≥ 3 |
| `cnv.neutralOrUnknownImpact` | `0` | Impact for CN === 2 or null |
| `cnv.qualitySaturationCeiling` | `100` | Quality saturation point |
| `cnv.rarityPlaceholder` | `1.0` | Rarity (no CNV freq source) |

### 12.5 STR

| Config path | Value | Purpose |
|---|---|---|
| `str.pathologicImpact` | `1.0` | Impact for `str_status === 'pathologic'` |
| `str.intermediateImpact` | `0.66` | Impact for `str_status === 'intermediate'` |
| `str.normalOrUnknownImpact` | `0` | Impact for everything else |
| `str.knownLocusPathogenicity` | `1.0` | Pathogenicity when `str_disease` is non-empty |
| `str.unknownLocusPathogenicity` | `0.5` | Pathogenicity when `str_disease` is empty/null |
| `str.knownLocusClinvarShortcut` | `0.9` | ClinVar bypass for known loci |
| `str.rarityPlaceholder` | `1.0` | Rarity (no STR freq source) |

### 12.6 Cross-type defaults

| Config path | Value | Purpose |
|---|---|---|
| `defaults.nullPhenotypeScore` | `0` | Phenotype when `hpo_sim_score` null |
