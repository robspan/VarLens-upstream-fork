# Gene Burden Association Analysis — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add gene burden analysis with Fisher's exact test, logistic burden test (with Firth fallback), cohort group comparison, Plotly visualizations, and worker thread parallelism to the Cohort view.

**Architecture:** Statistical tests run in Node.js worker threads spawned from the main process. The main process queries SQLite for per-gene contingency data, dispatches gene batches to workers, collects results, applies FDR correction, and returns via IPC. The renderer displays results in a new Gene Burden tab with configuration panel, results table, and Plotly charts.

**Tech Stack:** TypeScript, better-sqlite3, jstat (distribution functions), worker_threads, Plotly.js, Vuetify 3, Vitest

**Design doc:** `docs/plans/2026-03-09-gene-burden-association-design.md`
**Issue:** [#38](https://github.com/berntpopp/VarLens/issues/38)
**Reference:** variantcentrifuge Python project (`/mnt/c/development/scholl-lab/variantcentrifuge/`)

---

## Phase 1: Database Migration & Dependencies

### Task 1.1: Add age and date_of_birth to case_metadata

**Files:**
- Modify: `src/main/database/migrations.ts` (after line 302)
- Test: `tests/main/database/migrations.test.ts` (create if needed)

**Step 1: Write the migration**

Add migration v7 to `runMigrations()` in `src/main/database/migrations.ts`, after the v6 block:

```typescript
  // v7: Add age and date_of_birth to case_metadata (gene burden analysis)
  if (currentVersion < 7) {
    db.exec(`
      ALTER TABLE case_metadata ADD COLUMN age REAL;
      ALTER TABLE case_metadata ADD COLUMN date_of_birth TEXT;
    `)

    db.exec('PRAGMA user_version = 7')
  }
```

**Step 2: Write failing test**

Create `tests/main/database/migration-v7.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema, runMigrations } from '../../../src/main/database/schema'

describe('Migration v7: age and date_of_birth', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
  })

  it('adds age column to case_metadata', () => {
    const columns = db.pragma('table_info(case_metadata)') as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'age')).toBe(true)
  })

  it('adds date_of_birth column to case_metadata', () => {
    const columns = db.pragma('table_info(case_metadata)') as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'date_of_birth')).toBe(true)
  })

  it('stores and retrieves age', () => {
    const caseId = db
      .prepare("INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES ('test', '/test', 100, 0, ?)")
      .run(Date.now()).lastInsertRowid
    db.prepare(
      'INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(caseId, 'affected', '', Date.now(), Date.now())
    db.prepare('UPDATE case_metadata SET age = ? WHERE case_id = ?').run(45.5, caseId)
    const row = db.prepare('SELECT age FROM case_metadata WHERE case_id = ?').get(caseId) as { age: number }
    expect(row.age).toBe(45.5)
  })
})
```

**Step 3: Run test to verify**

```bash
npx vitest run tests/main/database/migration-v7.test.ts
```

**Step 4: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/migration-v7.test.ts
git commit -m "feat: add age and date_of_birth to case_metadata (migration v7)"
```

### Task 1.2: Update MetadataRepository for age/DOB

**Files:**
- Modify: `src/main/database/MetadataRepository.ts` — update `upsertCaseMetadata` and `getCaseMetadata`
- Modify: `src/shared/types/api.ts` — add age/dob to CaseMetadata type

**Step 1: Add age and date_of_birth to the CaseMetadata type**

In `src/shared/types/api.ts`, find the `CaseMetadata` interface and add:

```typescript
  age?: number | null
  date_of_birth?: string | null
```

**Step 2: Update upsertCaseMetadata to handle age/DOB**

In `src/main/database/MetadataRepository.ts`, update the upsert SQL to include the new columns. Follow the existing pattern where `updates` is a partial object.

**Step 3: Update getCaseMetadata to return age/DOB**

Ensure the SELECT in `getCaseMetadata` includes `age, date_of_birth`.

**Step 4: Update the CaseMetadataCard.vue to show age/DOB input fields**

Add two fields to the case metadata editing UI:
- Age: `v-text-field` with type="number"
- Date of Birth: `v-text-field` with type="date"
- If DOB is set and age is not, compute age dynamically for display

**Step 5: Test and commit**

```bash
npx vitest run tests/main/database/
git add -A && git commit -m "feat: support age and DOB in case metadata"
```

### Task 1.3: Install dependencies

**Step 1: Install jstat and plotly**

```bash
npm install jstat
npm install plotly.js-dist-min
npm install -D @types/plotly.js
```

Note: `plotly.js-dist-min` is the minimal bundle (~1MB vs ~8MB). Sufficient for scatter plots.

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jstat and plotly.js dependencies"
```

---

## Phase 2: Statistical Core (TDD with Golden References)

### Task 2.0: Generate golden reference files from variantcentrifuge

**Files:**
- Create: `tests/fixtures/golden/` directory
- Create: `tests/fixtures/golden/fisher-reference.json`
- Create: `tests/fixtures/golden/logistic-reference.json`
- Create: `tests/fixtures/golden/firth-reference.json`
- Create: `tests/fixtures/golden/fdr-reference.json`
- Create: `tests/fixtures/golden/weights-reference.json`

**Step 1: Write a Python script to generate golden files**

Create `scripts/generate-golden-references.py` that uses variantcentrifuge's statistical functions to generate test cases:

```python
"""
Generate golden reference files for TypeScript statistical test validation.
Run from the VarLens project root with variantcentrifuge importable.
"""
import json
import numpy as np
from scipy import stats
from scipy.special import betaln
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.contingency_tables import Table2x2

def generate_fisher_references():
    """Generate Fisher's exact test reference cases."""
    cases = []

    # Standard 2x2 tables
    tables = [
        [[10, 5], [3, 12]],     # typical case
        [[0, 10], [10, 0]],     # perfect separation
        [[5, 5], [5, 5]],       # no effect
        [[1, 0], [0, 1]],       # minimal table with zeros
        [[100, 50], [30, 120]], # larger counts
        [[0, 0], [5, 5]],       # zero row
        [[3, 0], [0, 4]],       # zero cells, small
    ]

    for table in tables:
        t = np.array(table)
        oddsratio, pvalue = stats.fisher_exact(t)

        # CI computation with Haldane-Anscombe correction
        ci_lower, ci_upper = None, None
        try:
            if t.min() == 0:
                t_corr = t + 0.5
            else:
                t_corr = t.astype(float)
            tab = Table2x2(t_corr)
            ci = tab.oddsratio_confint(method="score")
            ci_lower, ci_upper = float(ci[0]), float(ci[1])
        except Exception:
            pass

        cases.append({
            "table": table,
            "p_value": float(pvalue),
            "odds_ratio": float(oddsratio) if np.isfinite(oddsratio) else None,
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
        })

    return cases

def generate_fdr_references():
    """Generate BH FDR reference cases."""
    cases = []
    pvalue_sets = [
        [0.001, 0.01, 0.05, 0.1, 0.5],
        [0.0001, 0.001, 0.01, 0.1, 0.2, 0.3, 0.5, 0.8],
        [0.5, 0.5, 0.5],  # all same
        [0.01],            # single value
    ]

    for pvals in pvalue_sets:
        reject, corrected, _, _ = multipletests(pvals, method='fdr_bh')
        cases.append({
            "p_values": pvals,
            "q_values": [float(q) for q in corrected],
        })

    return cases

def generate_weight_references():
    """Generate Beta(MAF) weight reference cases."""
    from scipy.stats import beta as beta_dist
    cases = []
    mafs = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5]
    for maf in mafs:
        w = float(beta_dist.pdf(maf, 1, 25))
        cases.append({"maf": maf, "beta_1_25_weight": w})
    return cases

def generate_logistic_references():
    """Generate logistic regression reference cases."""
    np.random.seed(42)
    cases = []

    # Case 1: clear signal, no covariates
    n = 50
    burden = np.random.exponential(1.0, n)
    logits = -1.0 + 1.5 * burden
    y = (np.random.uniform(size=n) < 1.0 / (1.0 + np.exp(-logits))).astype(float)

    import statsmodels.api as sm
    X = sm.add_constant(burden)
    model = sm.Logit(y, X)
    result = model.fit(disp=False)

    cases.append({
        "name": "clear_signal_no_covariates",
        "burden": burden.tolist(),
        "y": y.tolist(),
        "covariates": None,
        "beta": float(result.params[1]),
        "se": float(result.bse[1]),
        "p_value": float(result.pvalues[1]),
        "ci_lower": float(result.conf_int()[1][0]),
        "ci_upper": float(result.conf_int()[1][1]),
        "converged": True,
    })

    # Case 2: with covariate
    covar = np.random.normal(0, 1, n)
    logits2 = -1.0 + 1.5 * burden + 0.5 * covar
    y2 = (np.random.uniform(size=n) < 1.0 / (1.0 + np.exp(-logits2))).astype(float)
    X2 = sm.add_constant(np.column_stack([burden, covar]))
    model2 = sm.Logit(y2, X2)
    result2 = model2.fit(disp=False)

    cases.append({
        "name": "with_covariate",
        "burden": burden.tolist(),
        "y": y2.tolist(),
        "covariates": covar.tolist(),
        "beta": float(result2.params[1]),
        "se": float(result2.bse[1]),
        "p_value": float(result2.pvalues[1]),
        "ci_lower": float(result2.conf_int()[1][0]),
        "ci_upper": float(result2.conf_int()[1][1]),
        "converged": True,
    })

    return cases

def generate_firth_references():
    """Generate Firth logistic regression reference cases."""
    cases = []

    # Perfect separation: all carriers are cases
    # Burden: cases have burden > 0, controls have burden = 0
    burden = np.array([1.0, 2.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    y = np.array([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])

    # Use variantcentrifuge's Firth if available, otherwise use firthlogist
    # For now, record the expected behavior
    cases.append({
        "name": "perfect_separation",
        "burden": burden.tolist(),
        "y": y.tolist(),
        "covariates": None,
        "standard_logit_converged": False,
        "firth_required": True,
        # Firth values to be filled from variantcentrifuge run
    })

    # Quasi-separation: 90% of carriers are cases
    burden2 = np.array([1.0, 2.0, 1.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    y2 = np.array([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])

    cases.append({
        "name": "quasi_separation",
        "burden": burden2.tolist(),
        "y": y2.tolist(),
        "covariates": None,
        "firth_required": True,
    })

    return cases

if __name__ == "__main__":
    import os
    out_dir = "tests/fixtures/golden"
    os.makedirs(out_dir, exist_ok=True)

    refs = {
        "fisher-reference.json": generate_fisher_references(),
        "fdr-reference.json": generate_fdr_references(),
        "weights-reference.json": generate_weight_references(),
        "logistic-reference.json": generate_logistic_references(),
        "firth-reference.json": generate_firth_references(),
    }

    for filename, data in refs.items():
        path = os.path.join(out_dir, filename)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Wrote {path}")
```

**Step 2: Run the Python script**

```bash
cd /home/bernt/development/varlens
python scripts/generate-golden-references.py
```

If variantcentrifuge is not importable, run it with scipy/statsmodels directly (the script above uses those). For Firth references specifically, also run variantcentrifuge's Firth implementation on the same inputs and record the outputs in the golden files.

**Step 3: Commit golden files**

```bash
git add tests/fixtures/golden/ scripts/generate-golden-references.py
git commit -m "test: add golden reference files for statistical validation"
```

### Task 2.1: Shared types for association analysis

**Files:**
- Create: `src/main/statistics/types.ts`

**Step 1: Create the types file**

```typescript
/**
 * Types for gene burden association analysis.
 */

/** Weighting scheme for burden collapse */
export type WeightScheme = 'uniform' | 'beta_maf' | 'beta_maf_cadd'

/** Which test is primary (gets FDR correction) */
export type PrimaryTest = 'fisher' | 'logistic_burden'

/** Configuration for running association analysis */
export interface AssociationConfig {
  /** Case IDs in group A */
  groupA_ids: number[]
  /** Case IDs in group B */
  groupB_ids: number[]
  /** Primary test for FDR correction */
  primary_test: PrimaryTest
  /** Weighting scheme for logistic burden */
  weight_scheme: WeightScheme
  /** Covariate column names to include (e.g., 'sex', 'age') */
  covariates: string[]
  /** Variant filters */
  filters: VariantFilters
  /** Max worker threads */
  max_threads: number
}

/** Variant-level filters applied before association */
export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
}

/** Per-gene data passed to worker threads */
export interface GeneContingencyData {
  gene_symbol: string
  /** Number of cases in group A carrying variant in this gene */
  groupA_carrier_count: number
  /** Number of cases in group A NOT carrying variant */
  groupA_non_carrier_count: number
  /** Number of cases in group B carrying variant */
  groupB_carrier_count: number
  /** Number of cases in group B NOT carrying variant */
  groupB_non_carrier_count: number
  /** Per-sample burden data for logistic regression */
  samples: SampleBurdenData[]
}

/** Per-sample data for logistic regression */
export interface SampleBurdenData {
  /** 1 = group A, 0 = group B */
  group: 0 | 1
  /** Genotype dosages per variant in this gene [0, 1, 2] */
  dosages: number[]
  /** MAF for each variant (for weighting) */
  variant_mafs: number[]
  /** CADD scores per variant (for CADD weighting, null if unavailable) */
  variant_cadds: (number | null)[]
  /** Covariate values (numeric, in order matching config.covariates) */
  covariate_values: number[]
}

/** Fisher's exact test result */
export interface FisherResult {
  p_value: number | null
  odds_ratio: number | null
  ci_lower: number | null
  ci_upper: number | null
}

/** Logistic burden test result */
export interface LogisticBurdenResult {
  p_value: number | null
  beta: number | null
  se: number | null
  ci_lower: number | null
  ci_upper: number | null
  used_firth: boolean
  warning?: string
}

/** Combined result for one gene */
export interface GeneAssociationResult {
  gene_symbol: string
  n_variants: number
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: FisherResult
  logistic_burden: LogisticBurdenResult
}

/** Final results with FDR correction applied */
export interface AssociationResults {
  results: GeneAssociationResultWithFDR[]
  primary_test: PrimaryTest
  config: AssociationConfig
  warnings: string[]
  elapsed_ms: number
}

/** Gene result with FDR q-value on primary test */
export interface GeneAssociationResultWithFDR extends GeneAssociationResult {
  /** FDR-corrected q-value for the primary test */
  q_value: number | null
}

/** Worker thread message types */
export interface WorkerRequest {
  type: 'run'
  genes: GeneContingencyData[]
  weight_scheme: WeightScheme
}

export interface WorkerResponse {
  type: 'result' | 'progress' | 'error'
  gene_symbol?: string
  result?: GeneAssociationResult
  progress?: { completed: number; total: number }
  error?: string
}
```

**Step 2: Commit**

```bash
git add src/main/statistics/types.ts
git commit -m "feat: add shared types for association analysis"
```

### Task 2.2: Fisher's exact test

**Files:**
- Create: `src/main/statistics/fisher.ts`
- Create: `tests/main/statistics/fisher.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { fisherExactTest } from '../../../src/main/statistics/fisher'
import goldenRef from '../../fixtures/golden/fisher-reference.json'

describe('fisherExactTest', () => {
  for (const [i, ref] of goldenRef.entries()) {
    it(`matches golden reference case ${i}: table=${JSON.stringify(ref.table)}`, () => {
      const [[a, b], [c, d]] = ref.table
      const result = fisherExactTest(a, b, c, d)

      if (ref.p_value !== null) {
        expect(result.p_value).toBeCloseTo(ref.p_value, 8)
      }
      if (ref.odds_ratio !== null) {
        expect(result.odds_ratio).toBeCloseTo(ref.odds_ratio, 8)
      }
      if (ref.ci_lower !== null && result.ci_lower !== null) {
        expect(result.ci_lower).toBeCloseTo(ref.ci_lower, 4)
      }
      if (ref.ci_upper !== null && result.ci_upper !== null) {
        expect(result.ci_upper).toBeCloseTo(ref.ci_upper, 4)
      }
    })
  }

  it('returns null for empty table (all zeros)', () => {
    const result = fisherExactTest(0, 0, 0, 0)
    expect(result.p_value).toBeNull()
    expect(result.odds_ratio).toBeNull()
  })

  it('handles Haldane-Anscombe correction for zero cells', () => {
    const result = fisherExactTest(5, 0, 0, 5)
    expect(result.p_value).toBeDefined()
    expect(result.ci_lower).toBeDefined()
    expect(result.ci_upper).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/main/statistics/fisher.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement Fisher's exact test**

Create `src/main/statistics/fisher.ts`:

```typescript
import type { FisherResult } from './types'

/**
 * Fisher's exact test for a 2x2 contingency table.
 *
 * Table layout:
 *   [[a, b],    a = groupA carriers, b = groupB carriers
 *    [c, d]]    c = groupA non-carriers, d = groupB non-carriers
 *
 * Uses hypergeometric distribution enumeration for exact p-value.
 * Odds ratio CI via normal approximation on log(OR) with
 * Haldane-Anscombe correction for zero cells.
 */
export function fisherExactTest(a: number, b: number, c: number, d: number): FisherResult {
  const n = a + b + c + d
  if (n === 0) {
    return { p_value: null, odds_ratio: null, ci_lower: null, ci_upper: null }
  }

  // Marginal totals
  const r1 = a + b // row 1 total
  const r2 = c + d // row 2 total
  const c1 = a + c // col 1 total
  const c2 = b + d // col 2 total

  // Two-sided p-value via hypergeometric enumeration
  const pObserved = hypergeometricPmf(a, n, c1, r1)
  let pValue = 0
  const minA = Math.max(0, r1 - c2)
  const maxA = Math.min(r1, c1)

  for (let x = minA; x <= maxA; x++) {
    const px = hypergeometricPmf(x, n, c1, r1)
    if (px <= pObserved + 1e-14) {
      pValue += px
    }
  }
  pValue = Math.min(pValue, 1.0)

  // Odds ratio
  let oddsRatio: number | null = null
  if (b * c === 0) {
    oddsRatio = b === 0 && c === 0 ? null : Infinity
    if (a === 0 || d === 0) oddsRatio = a * d === 0 && b * c === 0 ? null : 0
    // More precise: OR = (a*d)/(b*c)
    if (b * c === 0 && a * d === 0) oddsRatio = null
    else if (b * c === 0) oddsRatio = Infinity
  } else {
    oddsRatio = (a * d) / (b * c)
  }

  // Confidence interval with Haldane-Anscombe correction
  const { ci_lower, ci_upper } = computeOddsRatioCI(a, b, c, d)

  return { p_value: pValue, odds_ratio: oddsRatio, ci_lower, ci_upper }
}

/**
 * Hypergeometric PMF using log-factorials for numerical stability.
 * P(X = k) = C(K, k) * C(N-K, n-k) / C(N, n)
 */
function hypergeometricPmf(k: number, N: number, K: number, n: number): number {
  return Math.exp(
    logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n)
  )
}

/** Log of binomial coefficient C(n, k) */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  if (k === 0 || k === n) return 0
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/** Log factorial using Stirling's approximation for large n, exact for small n */
const logFactorialCache: number[] = [0, 0]

function logFactorial(n: number): number {
  if (n < 0) return -Infinity
  if (n < logFactorialCache.length) return logFactorialCache[n]

  // Build cache up to n
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = logFactorialCache[i - 1] + Math.log(i)
  }
  return logFactorialCache[n]
}

/**
 * Odds ratio 95% CI using Woolf's method (log(OR) ± 1.96 * SE).
 * Applies Haldane-Anscombe correction (add 0.5) when any cell is zero.
 */
function computeOddsRatioCI(
  a: number, b: number, c: number, d: number
): { ci_lower: number | null; ci_upper: number | null } {
  // Apply Haldane-Anscombe correction if any cell is zero
  let aa = a, bb = b, cc = c, dd = d
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    aa = a + 0.5
    bb = b + 0.5
    cc = c + 0.5
    dd = d + 0.5
  }

  // Check for structural zeros (zero marginal totals)
  if (aa + bb === 0 || cc + dd === 0 || aa + cc === 0 || bb + dd === 0) {
    return { ci_lower: null, ci_upper: null }
  }

  const logOr = Math.log((aa * dd) / (bb * cc))
  const se = Math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd)

  return {
    ci_lower: Math.exp(logOr - 1.96 * se),
    ci_upper: Math.exp(logOr + 1.96 * se)
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/main/statistics/fisher.test.ts
```

Iterate until all golden reference cases pass within tolerance.

**Step 5: Commit**

```bash
git add src/main/statistics/fisher.ts tests/main/statistics/fisher.test.ts
git commit -m "feat: implement Fisher's exact test with golden reference validation"
```

### Task 2.3: Variant weighting schemes

**Files:**
- Create: `src/main/statistics/weights.ts`
- Create: `tests/main/statistics/weights.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { computeWeight } from '../../../src/main/statistics/weights'
import goldenRef from '../../fixtures/golden/weights-reference.json'

describe('computeWeight', () => {
  describe('beta_maf', () => {
    for (const ref of goldenRef) {
      it(`Beta(${ref.maf}; 1, 25) matches golden reference`, () => {
        const w = computeWeight('beta_maf', ref.maf, null)
        expect(w).toBeCloseTo(ref.beta_1_25_weight, 8)
      })
    }
  })

  describe('uniform', () => {
    it('returns 1.0 for any MAF', () => {
      expect(computeWeight('uniform', 0.01, null)).toBe(1.0)
      expect(computeWeight('uniform', 0.5, null)).toBe(1.0)
    })
  })

  describe('beta_maf_cadd', () => {
    it('multiplies Beta(MAF) by min(CADD/40, 1)', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withCadd = computeWeight('beta_maf_cadd', 0.01, 20)
      expect(withCadd).toBeCloseTo(betaOnly * (20 / 40), 8)
    })

    it('caps CADD contribution at 1.0', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withCadd = computeWeight('beta_maf_cadd', 0.01, 50)
      expect(withCadd).toBeCloseTo(betaOnly, 8)
    })

    it('uses Beta(MAF) only when CADD is null', () => {
      const betaOnly = computeWeight('beta_maf', 0.01, null)
      const withNull = computeWeight('beta_maf_cadd', 0.01, null)
      expect(withNull).toBeCloseTo(betaOnly, 8)
    })
  })
})
```

**Step 2: Implement weights**

Create `src/main/statistics/weights.ts`:

```typescript
import { jStat } from 'jstat'
import type { WeightScheme } from './types'

/**
 * Compute variant weight given MAF and optional CADD score.
 *
 * Schemes:
 * - uniform: weight = 1.0
 * - beta_maf: Beta(MAF; 1, 25) PDF — SKAT convention
 * - beta_maf_cadd: Beta(MAF; 1, 25) × min(CADD/40, 1.0)
 */
export function computeWeight(
  scheme: WeightScheme,
  maf: number,
  cadd: number | null
): number {
  if (scheme === 'uniform') return 1.0

  // Clip MAF to avoid numerical edge cases
  const clippedMaf = Math.max(1e-8, Math.min(maf, 1 - 1e-8))
  const betaWeight = jStat.beta.pdf(clippedMaf, 1, 25)

  if (scheme === 'beta_maf') return betaWeight

  // beta_maf_cadd
  const caddFactor = cadd !== null ? Math.min(cadd / 40, 1.0) : 1.0
  return betaWeight * caddFactor
}

/**
 * Compute burden score for a sample: sum of weighted dosages.
 */
export function computeBurdenScore(
  dosages: number[],
  mafs: number[],
  cadds: (number | null)[],
  scheme: WeightScheme
): number {
  let burden = 0
  for (let i = 0; i < dosages.length; i++) {
    const w = computeWeight(scheme, mafs[i], cadds[i])
    burden += w * dosages[i]
  }
  return burden
}
```

**Step 3: Run tests, commit**

```bash
npx vitest run tests/main/statistics/weights.test.ts
git add src/main/statistics/weights.ts tests/main/statistics/weights.test.ts
git commit -m "feat: implement variant weighting schemes (uniform, Beta(MAF), Beta(MAF)×CADD)"
```

### Task 2.4: Benjamini-Hochberg FDR correction

**Files:**
- Create: `src/main/statistics/fdr.ts`
- Create: `tests/main/statistics/fdr.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { benjaminiHochberg } from '../../../src/main/statistics/fdr'
import goldenRef from '../../fixtures/golden/fdr-reference.json'

describe('benjaminiHochberg', () => {
  for (const [i, ref] of goldenRef.entries()) {
    it(`matches golden reference case ${i}`, () => {
      const qValues = benjaminiHochberg(ref.p_values)
      for (let j = 0; j < ref.q_values.length; j++) {
        expect(qValues[j]).toBeCloseTo(ref.q_values[j], 10)
      }
    })
  }

  it('handles null p-values by passing through null', () => {
    const result = benjaminiHochberg([0.01, null, 0.05])
    expect(result[1]).toBeNull()
    expect(result[0]).toBeDefined()
    expect(result[2]).toBeDefined()
  })

  it('returns empty array for empty input', () => {
    expect(benjaminiHochberg([])).toEqual([])
  })
})
```

**Step 2: Implement BH FDR**

Create `src/main/statistics/fdr.ts`:

```typescript
/**
 * Benjamini-Hochberg FDR correction.
 *
 * Adjusts p-values to control false discovery rate.
 * Null p-values are passed through as null.
 */
export function benjaminiHochberg(pValues: (number | null)[]): (number | null)[] {
  if (pValues.length === 0) return []

  // Collect non-null indices and values
  const indexed: { index: number; pValue: number }[] = []
  for (let i = 0; i < pValues.length; i++) {
    if (pValues[i] !== null) {
      indexed.push({ index: i, pValue: pValues[i] as number })
    }
  }

  if (indexed.length === 0) return pValues.slice()

  const m = indexed.length

  // Sort by p-value descending
  indexed.sort((a, b) => b.pValue - a.pValue)

  // Adjust: q_i = min(p_i * m / rank, q_{i+1})
  const adjusted = new Array<number>(m)
  adjusted[0] = Math.min(indexed[0].pValue * m / m, 1.0) // rank = m for largest

  for (let i = 1; i < m; i++) {
    const rank = m - i // descending: rank goes m, m-1, ..., 1
    const raw = indexed[i].pValue * m / rank
    adjusted[i] = Math.min(raw, adjusted[i - 1])
    adjusted[i] = Math.min(adjusted[i], 1.0)
  }

  // Map back to original positions
  const result: (number | null)[] = pValues.slice()
  for (let i = 0; i < m; i++) {
    result[indexed[i].index] = adjusted[i]
  }

  return result
}
```

**Step 3: Run tests, commit**

```bash
npx vitest run tests/main/statistics/fdr.test.ts
git add src/main/statistics/fdr.ts tests/main/statistics/fdr.test.ts
git commit -m "feat: implement Benjamini-Hochberg FDR correction"
```

### Task 2.5: Logistic regression (standard)

**Files:**
- Create: `src/main/statistics/logistic.ts`
- Create: `tests/main/statistics/logistic.test.ts`

**Step 1: Write failing tests against golden reference**

```typescript
import { describe, it, expect } from 'vitest'
import { logisticRegression } from '../../../src/main/statistics/logistic'
import goldenRef from '../../fixtures/golden/logistic-reference.json'

describe('logisticRegression (standard)', () => {
  for (const ref of goldenRef) {
    it(`matches golden reference: ${ref.name}`, () => {
      const covariates = ref.covariates
        ? ref.burden.map((_: number, i: number) => [ref.covariates[i]])
        : undefined
      const result = logisticRegression(ref.burden, ref.y, covariates)

      expect(result.converged).toBe(ref.converged)
      expect(result.beta).toBeCloseTo(ref.beta, 4)
      expect(result.se).toBeCloseTo(ref.se, 3)
      expect(result.p_value).toBeCloseTo(ref.p_value, 4)
      expect(result.ci_lower).toBeCloseTo(ref.ci_lower, 2)
      expect(result.ci_upper).toBeCloseTo(ref.ci_upper, 2)
    })
  }
})
```

**Step 2: Implement standard logistic regression (IRLS)**

Create `src/main/statistics/logistic.ts`:

Implement iteratively reweighted least squares (IRLS) for logistic regression:

1. Design matrix `X = [1, burden, covariates...]`
2. Initialize `beta = zeros`
3. Iterate:
   - `mu = sigmoid(X * beta)`
   - `W = diag(mu * (1 - mu))`
   - `z = X * beta + W^(-1) * (y - mu)` (working response)
   - `beta_new = (X^T W X)^(-1) X^T W z`
   - Check convergence: `max(|beta_new - beta|) < 1e-8`
4. Standard errors from `sqrt(diag((X^T W X)^(-1)))`
5. P-value from Wald test: `z = beta / se`, `p = 2 * (1 - Phi(|z|))`
6. CI: `beta ± 1.96 * se`

Use jstat for `jStat.normal.cdf` for p-value computation.

Return: `{ beta, se, p_value, ci_lower, ci_upper, converged, bse_max }` where `bse_max` is max of standard errors (used for separation detection).

**Step 3: Run tests, iterate until passing, commit**

```bash
npx vitest run tests/main/statistics/logistic.test.ts
git add src/main/statistics/logistic.ts tests/main/statistics/logistic.test.ts
git commit -m "feat: implement standard logistic regression via IRLS"
```

### Task 2.6: Firth penalized logistic regression

**Files:**
- Modify: `src/main/statistics/logistic.ts` — add `firthLogisticRegression` function
- Create: `tests/main/statistics/firth.test.ts`

**Step 1: Write failing tests against golden reference**

```typescript
import { describe, it, expect } from 'vitest'
import { firthLogisticRegression } from '../../../src/main/statistics/logistic'
import goldenRef from '../../fixtures/golden/firth-reference.json'

describe('firthLogisticRegression', () => {
  for (const ref of goldenRef) {
    it(`handles ${ref.name}`, () => {
      const result = firthLogisticRegression(ref.burden, ref.y, undefined)

      // Firth should converge even with separation
      expect(result.converged).toBe(true)
      expect(result.beta).toBeDefined()
      expect(result.se).toBeDefined()
      expect(result.p_value).toBeDefined()

      // If golden values are filled in, match them
      if (ref.beta !== undefined) {
        expect(result.beta).toBeCloseTo(ref.beta, 2)
      }
    })
  }
})
```

**Step 2: Implement Firth penalized logistic regression**

Add to `src/main/statistics/logistic.ts`:

Firth's method adds Jeffreys' prior (penalized likelihood) via modified score function:

1. Design matrix `X = [1, burden, covariates...]`
2. Initialize `beta = zeros`
3. Iterate (Newton-Raphson with step-halving):
   - `mu = sigmoid(X * beta)`
   - `W = diag(mu * (1 - mu))`
   - Fisher info: `I = X^T W X`
   - Hat matrix diagonal: `h_i = X_i^T I^(-1) X_i w_i`
   - Modified score: `U* = X^T (y - mu + h * (0.5 - mu))`
   - Step: `delta = I^(-1) U*`
   - Step-halving: if penalized log-likelihood doesn't increase, halve step (max 25 halvings)
   - `beta = beta + delta`
   - Check convergence: `max(|delta|) < 1e-8`
4. Standard errors from `sqrt(diag(I^(-1)))` at final beta
5. P-value and CI same as standard logistic

Key: the hat matrix diagonal `h` provides the Firth penalty. This keeps parameter estimates finite under separation.

**Step 3: Run tests, iterate, commit**

```bash
npx vitest run tests/main/statistics/firth.test.ts
git add src/main/statistics/logistic.ts tests/main/statistics/firth.test.ts
git commit -m "feat: implement Firth penalized logistic regression fallback"
```

### Task 2.7: Logistic burden test orchestrator

**Files:**
- Create: `src/main/statistics/burden.ts`
- Create: `tests/main/statistics/burden.test.ts`

**Step 1: Implement the logistic burden test function**

This function:
1. Computes per-sample burden scores using `computeBurdenScore`
2. Attempts standard logistic regression
3. Detects separation (non-convergence or BSE > 100)
4. Falls back to Firth if needed
5. Returns `LogisticBurdenResult`

```typescript
import type { LogisticBurdenResult, SampleBurdenData, WeightScheme } from './types'
import { computeBurdenScore } from './weights'
import { logisticRegression, firthLogisticRegression } from './logistic'

export function logisticBurdenTest(
  samples: SampleBurdenData[],
  weightScheme: WeightScheme
): LogisticBurdenResult {
  if (samples.length === 0) {
    return { p_value: null, beta: null, se: null, ci_lower: null, ci_upper: null, used_firth: false, warning: 'NO_SAMPLES' }
  }

  // Compute burden scores
  const burdens = samples.map((s) =>
    computeBurdenScore(s.dosages, s.variant_mafs, s.variant_cadds, weightScheme)
  )
  const phenotypes = samples.map((s) => s.group)
  const covariates = samples[0].covariate_values.length > 0
    ? samples.map((s) => s.covariate_values)
    : undefined

  // Check if all burden scores are zero (no qualifying variants)
  if (burdens.every((b) => b === 0)) {
    return { p_value: null, beta: null, se: null, ci_lower: null, ci_upper: null, used_firth: false, warning: 'ZERO_BURDEN' }
  }

  // Try standard logistic regression
  const stdResult = logisticRegression(burdens, phenotypes, covariates)

  // Detect separation
  if (stdResult.converged && stdResult.bse_max <= 100) {
    return {
      p_value: stdResult.p_value,
      beta: stdResult.beta,
      se: stdResult.se,
      ci_lower: stdResult.ci_lower,
      ci_upper: stdResult.ci_upper,
      used_firth: false
    }
  }

  // Firth fallback
  const firthResult = firthLogisticRegression(burdens, phenotypes, covariates)
  const warning = !stdResult.converged ? 'PERFECT_SEPARATION' : 'QUASI_SEPARATION'

  if (!firthResult.converged) {
    return { p_value: null, beta: null, se: null, ci_lower: null, ci_upper: null, used_firth: true, warning: 'FIRTH_CONVERGE_FAIL' }
  }

  return {
    p_value: firthResult.p_value,
    beta: firthResult.beta,
    se: firthResult.se,
    ci_lower: firthResult.ci_lower,
    ci_upper: firthResult.ci_upper,
    used_firth: true,
    warning
  }
}
```

**Step 2: Write tests covering standard path, Firth fallback, edge cases**

**Step 3: Run tests, commit**

```bash
npx vitest run tests/main/statistics/burden.test.ts
git add src/main/statistics/burden.ts tests/main/statistics/burden.test.ts
git commit -m "feat: implement logistic burden test with automatic Firth fallback"
```

---

## Phase 3: Worker Thread Infrastructure

### Task 3.1: Worker thread entry point

**Files:**
- Create: `src/main/statistics/worker.ts`
- Modify: `electron.vite.config.ts` — may need to handle worker bundling

**Step 1: Create the worker**

```typescript
import { parentPort } from 'worker_threads'
import type { WorkerRequest, WorkerResponse, GeneAssociationResult } from './types'
import { fisherExactTest } from './fisher'
import { logisticBurdenTest } from './burden'

if (!parentPort) throw new Error('Must be run as worker thread')

parentPort.on('message', (request: WorkerRequest) => {
  if (request.type === 'run') {
    const total = request.genes.length

    for (let i = 0; i < request.genes.length; i++) {
      const gene = request.genes[i]

      try {
        // Fisher's exact test
        const fisher = fisherExactTest(
          gene.groupA_carrier_count,
          gene.groupB_carrier_count,
          gene.groupA_non_carrier_count,
          gene.groupB_non_carrier_count
        )

        // Logistic burden test
        const logistic = logisticBurdenTest(gene.samples, request.weight_scheme)

        const result: GeneAssociationResult = {
          gene_symbol: gene.gene_symbol,
          n_variants: gene.samples.length > 0 ? gene.samples[0].dosages.length : 0,
          groupA_carriers: gene.groupA_carrier_count,
          groupB_carriers: gene.groupB_carrier_count,
          groupA_total: gene.groupA_carrier_count + gene.groupA_non_carrier_count,
          groupB_total: gene.groupB_carrier_count + gene.groupB_non_carrier_count,
          fisher,
          logistic_burden: logistic
        }

        parentPort!.postMessage({
          type: 'result',
          gene_symbol: gene.gene_symbol,
          result
        } satisfies WorkerResponse)
      } catch (error) {
        parentPort!.postMessage({
          type: 'error',
          gene_symbol: gene.gene_symbol,
          error: error instanceof Error ? error.message : String(error)
        } satisfies WorkerResponse)
      }

      // Report progress
      parentPort!.postMessage({
        type: 'progress',
        progress: { completed: i + 1, total }
      } satisfies WorkerResponse)
    }
  }
})
```

**Step 2: Handle electron-vite bundling**

The worker runs in the main process context (Node.js), not the renderer. electron-vite's `externalizeDepsPlugin()` handles this, but the worker file needs to be either:
- Built as a separate entry point, OR
- Referenced by path at runtime

Add worker as additional entry in `electron.vite.config.ts` main config:

```typescript
main: {
  plugins: [externalizeDepsPlugin()],
  build: {
    rollupOptions: {
      external: ['better-sqlite3-multiple-ciphers'],
      input: {
        index: resolve(__dirname, 'src/main/index.ts'),
        'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts')
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/main/statistics/worker.ts electron.vite.config.ts
git commit -m "feat: add association analysis worker thread"
```

### Task 3.2: Worker pool manager

**Files:**
- Create: `src/main/statistics/WorkerPool.ts`
- Create: `tests/main/statistics/worker-pool.test.ts`

**Step 1: Implement worker pool**

```typescript
import { Worker } from 'worker_threads'
import { resolve } from 'path'
import os from 'os'
import type {
  GeneContingencyData, GeneAssociationResult,
  WeightScheme, WorkerRequest, WorkerResponse
} from './types'

export class WorkerPool {
  private maxThreads: number
  private workerPath: string
  private aborted = false

  constructor(maxThreads?: number) {
    const cpus = os.cpus().length
    this.maxThreads = maxThreads ?? Math.max(1, cpus - 1)
    // In production, worker is built to out/main/statistics-worker.js
    // Resolve relative to this file's compiled location
    this.workerPath = resolve(__dirname, 'statistics-worker.js')
  }

  /**
   * Run association analysis across genes using worker threads.
   * @param genes Per-gene contingency data
   * @param weightScheme Weighting scheme for logistic burden
   * @param onProgress Callback for progress updates
   * @returns Results for all genes
   */
  async run(
    genes: GeneContingencyData[],
    weightScheme: WeightScheme,
    onProgress?: (completed: number, total: number) => void
  ): Promise<GeneAssociationResult[]> {
    this.aborted = false

    if (genes.length === 0) return []

    // Use single worker for small gene counts
    const numWorkers = genes.length < 20 ? 1 : Math.min(this.maxThreads, genes.length)

    // Split genes into batches
    const batches = splitIntoBatches(genes, numWorkers)
    const results: GeneAssociationResult[] = []
    let totalCompleted = 0

    const workerPromises = batches.map((batch) => {
      return new Promise<GeneAssociationResult[]>((resolveWorker, rejectWorker) => {
        if (this.aborted) {
          resolveWorker([])
          return
        }

        const worker = new Worker(this.workerPath)
        const batchResults: GeneAssociationResult[] = []

        worker.on('message', (msg: WorkerResponse) => {
          if (this.aborted) {
            worker.terminate()
            resolveWorker(batchResults)
            return
          }

          if (msg.type === 'result' && msg.result) {
            batchResults.push(msg.result)
          } else if (msg.type === 'progress' && msg.progress) {
            totalCompleted++
            onProgress?.(totalCompleted, genes.length)
          } else if (msg.type === 'error') {
            // Log but don't fail the whole batch
            console.error(`Worker error for gene ${msg.gene_symbol}: ${msg.error}`)
          }
        })

        worker.on('error', (err) => rejectWorker(err))
        worker.on('exit', () => resolveWorker(batchResults))

        worker.postMessage({
          type: 'run',
          genes: batch,
          weight_scheme: weightScheme
        } satisfies WorkerRequest)
      })
    })

    const batchResults = await Promise.all(workerPromises)
    for (const batch of batchResults) {
      results.push(...batch)
    }

    return results
  }

  /** Cancel a running analysis */
  abort(): void {
    this.aborted = true
  }
}

function splitIntoBatches<T>(items: T[], numBatches: number): T[][] {
  const batches: T[][] = Array.from({ length: numBatches }, () => [])
  for (let i = 0; i < items.length; i++) {
    batches[i % numBatches].push(items[i])
  }
  return batches
}
```

**Step 2: Write tests (mocking Worker for unit tests, integration test with real worker)**

**Step 3: Commit**

```bash
git add src/main/statistics/WorkerPool.ts tests/main/statistics/worker-pool.test.ts
git commit -m "feat: add worker pool for parallel association analysis"
```

---

## Phase 4: Backend — Data Assembly & IPC

### Task 4.1: Gene contingency data builder

**Files:**
- Create: `src/main/database/AssociationDataBuilder.ts`
- Create: `tests/main/database/association-data-builder.test.ts`

**Step 1: Implement the data builder**

This class queries SQLite to build `GeneContingencyData[]` from two groups of case IDs:

1. Get all genes with variants in either group (applying variant filters)
2. For each gene:
   - Count carriers/non-carriers in each group
   - Build per-sample dosage arrays (for logistic burden)
   - Compute MAFs from all samples combined
   - Attach CADD scores per variant
   - Attach covariate values per sample (sex, age, selected metrics)

Key SQL pattern:
```sql
-- Per gene, per case: has variant or not
SELECT gene_symbol, case_id,
       MAX(CASE WHEN gt_num >= 1 THEN 1 ELSE 0 END) as is_carrier,
       SUM(gt_num) as total_dosage
FROM variants
WHERE case_id IN (?, ?, ...) -- both groups
  AND gene_symbol IS NOT NULL AND gene_symbol != ''
  AND (gnomad_af IS NULL OR gnomad_af <= ?)
  AND (cadd IS NULL OR cadd >= ?)
  AND (consequence IN (?, ?, ...))
GROUP BY gene_symbol, case_id
```

Then pivot into contingency data per gene.

For logistic regression, need per-variant dosages:
```sql
SELECT gene_symbol, case_id,
       chr || ':' || pos || ':' || ref || ':' || alt as variant_key,
       gt_num, gnomad_af, cadd
FROM variants
WHERE case_id IN (...)
  AND gene_symbol IS NOT NULL ...
ORDER BY gene_symbol, variant_key, case_id
```

**Step 2: Write tests with in-memory SQLite**

Test with known data: insert specific variants, verify contingency counts match expectations.

**Step 3: Run tests, commit**

```bash
npx vitest run tests/main/database/association-data-builder.test.ts
git add src/main/database/AssociationDataBuilder.ts tests/main/database/association-data-builder.test.ts
git commit -m "feat: add AssociationDataBuilder for gene contingency data assembly"
```

### Task 4.2: Association analysis orchestrator

**Files:**
- Create: `src/main/statistics/AssociationEngine.ts`

**Step 1: Implement the engine**

```typescript
import type { AssociationConfig, AssociationResults, GeneAssociationResultWithFDR } from './types'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import { WorkerPool } from './WorkerPool'
import { benjaminiHochberg } from './fdr'
import type Database from 'better-sqlite3-multiple-ciphers'

export class AssociationEngine {
  private db: Database.Database
  private workerPool: WorkerPool
  private onProgress?: (completed: number, total: number) => void

  constructor(db: Database.Database, onProgress?: (completed: number, total: number) => void) {
    this.db = db
    this.workerPool = new WorkerPool()
    this.onProgress = onProgress
  }

  async run(config: AssociationConfig): Promise<AssociationResults> {
    const start = Date.now()
    const warnings: string[] = []

    // 1. Build per-gene contingency data
    const builder = new AssociationDataBuilder(this.db)
    const genes = builder.build(
      config.groupA_ids,
      config.groupB_ids,
      config.filters,
      config.covariates
    )

    if (genes.length === 0) {
      return { results: [], primary_test: config.primary_test, config, warnings: ['No genes with qualifying variants'], elapsed_ms: Date.now() - start }
    }

    // 2. Run tests in worker threads
    this.workerPool = new WorkerPool(config.max_threads)
    const rawResults = await this.workerPool.run(genes, config.weight_scheme, this.onProgress)

    // 3. Apply FDR correction to primary test
    const pValues = rawResults.map((r) => {
      if (config.primary_test === 'fisher') return r.fisher.p_value
      return r.logistic_burden.p_value
    })

    const qValues = benjaminiHochberg(pValues)

    const results: GeneAssociationResultWithFDR[] = rawResults.map((r, i) => ({
      ...r,
      q_value: qValues[i]
    }))

    // Sort by primary test p-value
    results.sort((a, b) => {
      const pa = config.primary_test === 'fisher' ? a.fisher.p_value : a.logistic_burden.p_value
      const pb = config.primary_test === 'fisher' ? b.fisher.p_value : b.logistic_burden.p_value
      if (pa === null) return 1
      if (pb === null) return -1
      return pa - pb
    })

    return {
      results,
      primary_test: config.primary_test,
      config,
      warnings,
      elapsed_ms: Date.now() - start
    }
  }

  abort(): void {
    this.workerPool.abort()
  }
}
```

**Step 2: Commit**

```bash
git add src/main/statistics/AssociationEngine.ts
git commit -m "feat: add AssociationEngine orchestrator with FDR correction"
```

### Task 4.3: IPC handlers for association analysis

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts` — add new handlers
- Modify: `src/shared/types/ipc-schemas.ts` — add Zod schemas
- Modify: `src/preload/index.ts` — expose new API methods

**Step 1: Add Zod schema for association config**

In `src/shared/types/ipc-schemas.ts`:

```typescript
export const AssociationConfigSchema = z.object({
  groupA_ids: z.array(z.number().int().positive()),
  groupB_ids: z.array(z.number().int().positive()),
  primary_test: z.enum(['fisher', 'logistic_burden']),
  weight_scheme: z.enum(['uniform', 'beta_maf', 'beta_maf_cadd']),
  covariates: z.array(z.string()),
  filters: z.object({
    gnomad_af_max: z.number().min(0).max(1).optional(),
    cadd_min: z.number().min(0).max(60).optional(),
    consequences: z.array(z.string()).optional()
  }),
  max_threads: z.number().int().min(1).max(64).default(4)
})
```

**Step 2: Add IPC handlers**

In `src/main/ipc/handlers/cohort.ts`, add:

- `cohort:geneBurdenCompare` — validates config, creates AssociationEngine, runs analysis, sends progress via webContents
- `cohort:geneBurdenCancel` — calls engine.abort()

Use `BrowserWindow.getFocusedWindow()?.webContents.send('cohort:geneBurdenProgress', ...)` for streaming progress.

**Step 3: Expose in preload**

In `src/preload/index.ts`, add to the `cohort` section:

```typescript
runAssociation: (config: AssociationConfig) =>
  ipcRenderer.invoke('cohort:geneBurdenCompare', config),
cancelAssociation: () => ipcRenderer.invoke('cohort:geneBurdenCancel'),
onAssociationProgress: (callback: (progress: { completed: number; total: number }) => void) => {
  const handler = (_event: IpcRendererEvent, progress: { completed: number; total: number }) => callback(progress)
  ipcRenderer.on('cohort:geneBurdenProgress', handler)
  return () => ipcRenderer.removeListener('cohort:geneBurdenProgress', handler)
}
```

**Step 4: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts src/shared/types/ipc-schemas.ts src/preload/index.ts
git commit -m "feat: add IPC handlers for association analysis with progress streaming"
```

### Task 4.4: Settings for analysis thread count

**Files:**
- Modify: `src/main/ipc/handlers/settings.ts` (or create if needed)
- Modify: `src/preload/index.ts`
- Modify: settings store in renderer

**Step 1: Add IPC channel for getting/setting max threads**

`settings:analysisThreads` — get returns `{ max_threads: number, available_cores: number }`, set stores preference.

Use Electron's `electron-store` or localStorage on the renderer side (matching existing settings patterns).

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add analysis thread count setting"
```

---

## Phase 5: Frontend — Group Builders & Configuration

### Task 5.1: Group builder component

**Files:**
- Create: `src/renderer/src/components/association/GroupBuilder.vue`

**Step 1: Implement the component**

Props: `modelValue` (selected case IDs), `label` ("Group A" / "Group B"), `allCases` (list of all cases with metadata)

Features:
- Cohort group dropdown (loads from `window.api.cohort.listCohortGroups()` or existing patterns)
- Affected status select (affected/unaffected/any)
- Sex select (male/female/any)
- HPO term autocomplete (reuse existing HPO search pattern — check how it's done in existing components)
- Preview: v-chip showing "X cases matched", expandable to checkbox list
- "Save as group" button — opens small dialog with name input, saves via existing MetadataRepository cohort methods
- Emits `update:modelValue` with array of selected case IDs

**Template structure:**

```vue
<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ label }}</v-card-title>
    <v-card-text>
      <v-select label="Saved cohort group" ... />
      <v-row>
        <v-col cols="6">
          <v-select label="Affected status" :items="['Any', 'Affected', 'Unaffected']" />
        </v-col>
        <v-col cols="6">
          <v-select label="Sex" :items="['Any', 'Male', 'Female']" />
        </v-col>
      </v-row>
      <!-- HPO autocomplete -->
      <!-- Preview chips + checkbox list -->
    </v-card-text>
    <v-card-actions>
      <v-chip color="primary">{{ selectedCount }} cases</v-chip>
      <v-spacer />
      <v-btn size="small" @click="saveAsGroup">Save as group</v-btn>
    </v-card-actions>
  </v-card>
</template>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/GroupBuilder.vue
git commit -m "feat: add GroupBuilder component for cohort group definition"
```

### Task 5.2: Association configuration panel

**Files:**
- Create: `src/renderer/src/components/association/AssociationConfigPanel.vue`

**Step 1: Implement**

Layout:
- Two `GroupBuilder` components side by side (v-row with v-col cols="6")
- Overlap validation: if same case in both groups, show v-alert error
- Variant filters section (gnomAD AF max slider, consequence checkboxes, CADD min slider — reuse patterns from CohortFilterBar)
- Analysis settings: primary test radio (Fisher's / Logistic Burden), weight scheme select, covariate picker (checkboxes for sex, multi-select for case metrics)
- "Run Analysis" button, disabled if groups invalid
- Shows estimated gene count (quick query)

Emits: `run(config: AssociationConfig)`

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/AssociationConfigPanel.vue
git commit -m "feat: add AssociationConfigPanel with group builders and analysis settings"
```

---

## Phase 6: Frontend — Results Display

### Task 6.1: Results data table

**Files:**
- Create: `src/renderer/src/components/association/AssociationResultsTable.vue`

**Step 1: Implement**

Uses `v-data-table` (client-side, since results are already computed and typically <5000 genes):

Headers:
- Gene, n_variants, Cases_A, Cases_B
- Fisher OR, Fisher 95% CI, Fisher p-value
- Burden β, Burden SE, Burden p-value
- q-value (primary test, with column header indicating which test)

Features:
- Sort by any column (default: q-value ascending)
- Color-code significant rows (q < 0.05 highlighted)
- Per-column filtering (text input in header)
- Export button (Excel/TSV) — reuse existing export patterns from CohortTable

Props: `results: GeneAssociationResultWithFDR[]`, `primaryTest: PrimaryTest`

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/AssociationResultsTable.vue
git commit -m "feat: add AssociationResultsTable with sortable columns and export"
```

### Task 6.2: Volcano plot

**Files:**
- Create: `src/renderer/src/components/association/VolcanoPlot.vue`

**Step 1: Implement**

```vue
<template>
  <div ref="plotContainer" style="width: 100%; height: 500px" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Plotly from 'plotly.js-dist-min'
import type { GeneAssociationResultWithFDR, PrimaryTest } from '../../../../shared/types/...'

const props = defineProps<{
  results: GeneAssociationResultWithFDR[]
  primaryTest: PrimaryTest
  fdrThreshold?: number
}>()

const plotContainer = ref<HTMLDivElement>()

function buildPlotData() {
  const threshold = props.fdrThreshold ?? 0.05
  const significant: typeof props.results = []
  const notSignificant: typeof props.results = []

  for (const r of props.results) {
    const p = props.primaryTest === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
    const effect = props.primaryTest === 'fisher' ? r.fisher.odds_ratio : r.logistic_burden.beta
    if (p === null || effect === null) continue

    if (r.q_value !== null && r.q_value < threshold) {
      significant.push(r)
    } else {
      notSignificant.push(r)
    }
  }

  const getX = (r: GeneAssociationResultWithFDR) => {
    const effect = props.primaryTest === 'fisher' ? r.fisher.odds_ratio : r.logistic_burden.beta
    return props.primaryTest === 'fisher' ? Math.log2(effect!) : effect!
  }
  const getY = (r: GeneAssociationResultWithFDR) => {
    const p = props.primaryTest === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
    return -Math.log10(p!)
  }

  return [
    {
      x: notSignificant.map(getX),
      y: notSignificant.map(getY),
      text: notSignificant.map((r) => r.gene_symbol),
      mode: 'markers',
      type: 'scatter' as const,
      name: 'Not significant',
      marker: { color: '#999', size: 6 }
    },
    {
      x: significant.map(getX),
      y: significant.map(getY),
      text: significant.map((r) => r.gene_symbol),
      mode: 'markers+text',
      type: 'scatter' as const,
      name: `FDR < ${threshold}`,
      marker: { color: '#e53935', size: 8 },
      textposition: 'top center',
      textfont: { size: 10 }
    }
  ]
}

function render() {
  if (!plotContainer.value) return
  const data = buildPlotData()
  const layout = {
    xaxis: { title: props.primaryTest === 'fisher' ? 'log2(Odds Ratio)' : 'β (effect size)' },
    yaxis: { title: '-log10(p-value)' },
    hovermode: 'closest',
    showlegend: true,
    margin: { t: 30 }
  }
  Plotly.newPlot(plotContainer.value, data, layout, { responsive: true })
}

watch(() => props.results, render, { deep: true })
onMounted(render)
onBeforeUnmount(() => { if (plotContainer.value) Plotly.purge(plotContainer.value) })
</script>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/VolcanoPlot.vue
git commit -m "feat: add volcano plot component with Plotly"
```

### Task 6.3: Manhattan plot

**Files:**
- Create: `src/renderer/src/components/association/ManhattanPlot.vue`

**Step 1: Implement**

Similar to VolcanoPlot but:
- X-axis: genes ordered by chromosome (chr1, chr2, ... chr22, chrX, chrY), then by position within chromosome
- Y-axis: -log10(p-value)
- Alternating colors per chromosome
- Significance threshold line at -log10(0.05 / n_genes) for Bonferroni reference
- FDR threshold line

Need to query gene positions from variants table to order genes chromosomally. Pass gene→chromosome mapping as a prop or compute from results.

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/ManhattanPlot.vue
git commit -m "feat: add Manhattan plot component for gene burden results"
```

---

## Phase 7: Frontend — Gene Burden Tab Integration

### Task 7.1: Gene burden tab view

**Files:**
- Create: `src/renderer/src/components/association/GeneBurdenView.vue`

**Step 1: Implement the main view**

This is the container that assembles all pieces:

```vue
<template>
  <div class="gene-burden-view">
    <!-- Configuration panel (collapsible) -->
    <AssociationConfigPanel
      v-model:collapsed="configCollapsed"
      :all-cases="cases"
      @run="runAnalysis"
    />

    <!-- Progress bar (during computation) -->
    <v-progress-linear
      v-if="isRunning"
      :model-value="progressPercent"
      color="primary"
      class="my-3"
    >
      <template #default>
        {{ progressCompleted }} / {{ progressTotal }} genes
      </template>
    </v-progress-linear>
    <v-btn v-if="isRunning" variant="text" color="error" @click="cancelAnalysis">
      Cancel
    </v-btn>

    <!-- Results tabs -->
    <v-tabs v-if="results" v-model="activeTab" class="mt-3">
      <v-tab value="table">Table</v-tab>
      <v-tab value="volcano">Volcano Plot</v-tab>
      <v-tab value="manhattan">Manhattan Plot</v-tab>
    </v-tabs>

    <v-tabs-window v-if="results" v-model="activeTab">
      <v-tabs-window-item value="table">
        <AssociationResultsTable
          :results="results.results"
          :primary-test="results.primary_test"
        />
      </v-tabs-window-item>
      <v-tabs-window-item value="volcano">
        <VolcanoPlot
          :results="results.results"
          :primary-test="results.primary_test"
        />
      </v-tabs-window-item>
      <v-tabs-window-item value="manhattan">
        <ManhattanPlot
          :results="results.results"
          :primary-test="results.primary_test"
        />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>
```

**Script:** composable or inline logic for:
- Loading cases list
- Calling `window.api.cohort.runAssociation(config)`
- Listening to progress events
- Cancel handling
- Storing results

**Step 2: Commit**

```bash
git add src/renderer/src/components/association/GeneBurdenView.vue
git commit -m "feat: add GeneBurdenView with config, progress, and results tabs"
```

### Task 7.2: Wire into CohortView with tabs

**Files:**
- Modify: `src/renderer/src/components/CohortView.vue`
- Modify: `src/renderer/src/components/CohortTable.vue` (may need to wrap in tab)

**Step 1: Add tab toggle to CohortView**

Change `CohortView.vue` from a simple wrapper to a tabbed view:

```vue
<template>
  <div>
    <v-tabs v-model="activeTab" color="secondary">
      <v-tab value="variants">Variants</v-tab>
      <v-tab value="burden">Gene Burden</v-tab>
    </v-tabs>

    <v-tabs-window v-model="activeTab">
      <v-tabs-window-item value="variants">
        <CohortTable ref="cohortTableRef" @navigate-to-case="..." @row-click="..." />
      </v-tabs-window-item>
      <v-tabs-window-item value="burden">
        <GeneBurdenView />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>
```

**Step 2: Update any parent references**

Make sure the `refresh()` method exposed by CohortView still works (delegate to active tab).

**Step 3: Commit**

```bash
git add src/renderer/src/components/CohortView.vue
git commit -m "feat: add Variants | Gene Burden tab toggle to Cohort view"
```

---

## Phase 8: Export & Polish

### Task 8.1: Export association results to Excel/TSV

**Files:**
- Modify: `src/main/ipc/handlers/export.ts` — add `export:associationResults` handler
- Modify: `src/preload/index.ts` — expose export method
- Modify: `AssociationResultsTable.vue` — add export button

**Step 1: Add export handler**

Follow existing `export:cohort` pattern using xlsx library. Build worksheet from `AssociationResults`:
- Columns: Gene, n_variants, Cases_A, Cases_B, Fisher_OR, Fisher_CI_Lower, Fisher_CI_Upper, Fisher_p, Burden_beta, Burden_SE, Burden_p, q_value
- Show dialog for save path using `dialog.showSaveDialog`

**Step 2: Commit**

```bash
git add src/main/ipc/handlers/export.ts src/preload/index.ts src/renderer/src/components/association/AssociationResultsTable.vue
git commit -m "feat: add Excel/TSV export for association results"
```

### Task 8.2: Remove orphaned GeneBurdenTable.vue

**Files:**
- Delete: `src/renderer/src/components/GeneBurdenTable.vue`

The old orphaned component is replaced by the new `GeneBurdenView` and `AssociationResultsTable`. Remove it.

```bash
git rm src/renderer/src/components/GeneBurdenTable.vue
git commit -m "chore: remove orphaned GeneBurdenTable.vue (replaced by association analysis)"
```

---

## Phase 9: Integration & E2E Testing

### Task 9.1: Integration test — full pipeline

**Files:**
- Create: `tests/main/statistics/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { fisherExactTest } from '../../../src/main/statistics/fisher'
import { logisticBurdenTest } from '../../../src/main/statistics/burden'
import { benjaminiHochberg } from '../../../src/main/statistics/fdr'

describe('Association analysis integration', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    // Insert test data: cases with known variants
    // Group A: 5 cases, 3 with BRCA1 variants
    // Group B: 5 cases, 0 with BRCA1 variants
    // Expected: significant Fisher's p-value for BRCA1
  })

  it('detects enrichment in known test data', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, [])

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()

    const fisher = fisherExactTest(
      brca1!.groupA_carrier_count,
      brca1!.groupB_carrier_count,
      brca1!.groupA_non_carrier_count,
      brca1!.groupB_non_carrier_count
    )
    expect(fisher.p_value).toBeLessThan(0.05)
  })

  it('handles covariate exclusion for missing values', () => {
    // Insert cases where some have age, some don't
    // Verify cases without age are excluded with warning
  })

  it('rejects overlapping groups', () => {
    // Verify error when same case ID in both groups
  })
})
```

**Step 2: Run tests, commit**

```bash
npx vitest run tests/main/statistics/integration.test.ts
git add tests/main/statistics/integration.test.ts
git commit -m "test: add integration tests for association analysis pipeline"
```

### Task 9.2: E2E test with Playwright

**Files:**
- Create: `tests/e2e/gene-burden.spec.ts`

**Step 1: Write E2E test**

```typescript
import { test, expect, _electron as electron } from '@playwright/test'

test.describe('Gene Burden Analysis', () => {
  test('runs association analysis and displays results', async () => {
    const app = await electron.launch({ args: ['./out/main/index.js'] })
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application')

    // Navigate to cohort view (requires a database with cases)
    // Click Gene Burden tab
    // Configure groups
    // Run analysis
    // Verify results table appears
    // Switch to volcano plot tab
    // Switch to manhattan plot tab
    // Verify plots render

    await app.close()
  })
})
```

**Step 2: Commit**

```bash
git add tests/e2e/gene-burden.spec.ts
git commit -m "test: add E2E tests for gene burden analysis workflow"
```

---

## Phase 10: Final Checks

### Task 10.1: Lint, typecheck, test

```bash
make lint
make typecheck
make test
```

Fix any issues found.

### Task 10.2: Version bump

Update `package.json` version to `0.19.0` (new feature).

```bash
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 0.19.0"
```

### Task 10.3: Update issue #38

Close or update the GitHub issue with implementation summary.

---

## Dependency Graph

```
Phase 1 (DB migration, deps)
  ↓
Phase 2 (Statistical core) ← TDD with golden refs
  ↓
Phase 3 (Worker threads)
  ↓
Phase 4 (Backend IPC + data assembly)
  ↓
Phase 5 (Frontend: config panel) ─── can start after Phase 4 IPC types are defined
  ↓
Phase 6 (Frontend: results display) ─── can start after Phase 5
  ↓
Phase 7 (Tab integration)
  ↓
Phase 8 (Export & cleanup)
  ↓
Phase 9 (Integration + E2E tests)
  ↓
Phase 10 (Final checks)
```

Note: Phases 5-6 frontend work can proceed in parallel with Phase 4 backend work if types are agreed upon first.
