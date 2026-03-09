# Gene Burden Association Analysis Design

Issue: [#38](https://github.com/berntpopp/VarLens/issues/38)
Date: 2026-03-09
Reference implementation: variantcentrifuge (Python)

## Scope & Statistical Methods

Two association tests for gene-level burden analysis between two user-defined groups:

### Fisher's Exact Test
- 2x2 contingency table (carrier/non-carrier x group A/B)
- Odds ratio with 95% CI (score method, normal/logit fallback)
- Haldane-Anscombe continuity correction for zero cells (add 0.5 to all cells)

### Logistic Burden Test
- Weighted burden collapse per sample: `burden_i = sum(weights x genotypes_i)`
- Logistic regression: `logit(P(case)) = intercept + B*burden + covariates`
- Firth penalized logistic regression fallback for perfect/quasi-complete separation
- Three weighting schemes:
  - Uniform (all variants weight 1.0)
  - Beta(MAF; 1, 25) — SKAT standard, upweights rare variants
  - Beta(MAF; 1, 25) x min(CADD/40, 1.0) — adds functional impact weighting

### Multiple Testing Correction
- User designates one test as primary (Fisher's or Logistic Burden)
- Benjamini-Hochberg FDR correction applied to primary test p-values only
- Other test shown uncorrected as supplementary context

### Libraries
- jstat for distribution primitives (beta PDF, normal CDF/quantile)
- All core tests (Fisher's, logistic regression, Firth, BH FDR) in pure TypeScript

### Validation
- Firth implementation and all statistical functions validated against golden reference files generated from variantcentrifuge
- Golden files stored as JSON in `tests/fixtures/`
- Match within floating-point tolerance (1e-10)

## Case Metadata & Covariate System

### New Metadata Fields (migration v7)
- `age` (REAL) — numeric field in `case_metadata`
- `date_of_birth` (TEXT) — optional date field in `case_metadata`
- Age computed from DOB dynamically if DOB present and age not set

### Covariate Selection for Logistic Burden
- Sex (from `case_metadata.sex`) — checkbox to include
- Case metrics (from `case_metrics` table) — picker to select metrics as covariates (age, GFR, BMI, etc.)
- Categorical covariates (sex) automatically one-hot encoded
- Numeric covariates used directly
- Cases missing covariate values excluded from logistic burden with warning showing excluded count

## Group Definition & Cohort Management

### Inline Group Builders
Two side-by-side panels ("Group A" / "Group B") in the Gene Burden config section:

- Cohort group dropdown — select from saved cohort groups (existing `cohort_groups` table)
- Affected status filter — affected / unaffected / any
- Sex filter — male / female / any
- HPO term filter — autocomplete (reusing existing HPO search), Any/All match mode
- Preview — matching case count and list with checkboxes for fine-tuning
- "Save as group" button — saves current filter combination as named cohort group for reuse

### Validation
- Groups must be non-overlapping (error if a case is in both A and B)
- Both groups must have >= 1 case
- Filters are AND-combined
- Loading a saved group populates the filters
- Manual checkbox overrides allow adding/removing individual cases

## UI Layout & Integration

### Gene Burden Tab
Added to the Cohort view alongside existing Variants tab.

### Layout (top to bottom)

**1. Configuration Panel** — collapsible card:
- Group A / Group B builders side by side
- Variant filters row: gnomAD AF max, consequence types, CADD min (reusing existing filter components)
- Analysis settings row: primary test (Fisher's / Logistic Burden), weighting scheme, covariate picker
- Run Analysis button with estimated gene count

**2. Progress Indicator** — during computation:
- Progress bar with "X / Y genes completed"
- Cancel button

**3. Results Tabs** — three tabs for output:
- **Table** — sortable, filterable `v-data-table-server` with columns: Gene, n_variants, Cases_A, Cases_B, Fisher OR, Fisher CI, Fisher p-value, Burden B, Burden SE, Burden p-value, primary q-value. Exportable (Excel/TSV).
- **Volcano Plot** — x: log2(effect size), y: -log10(p-value), significance threshold line, gene labels on hover
- **Manhattan Plot** — genes ordered by chromosome position, y: -log10(p-value), significance threshold line

### Plotting
- Plotly.js for all charts
- Hover tooltips (gene name, p-value, effect size)
- Built-in PNG/SVG export
- Future-proof: Plotly will be reused for quality metrics, reports in other views (bar, box, line plots)

## Backend Architecture

### Computation Pipeline
1. Main process queries database -> builds per-gene contingency data (carrier counts, genotype dosages, covariates)
2. Passes gene batches to worker threads via `worker_threads`
3. Workers run Fisher's / logistic burden / Firth independently per gene
4. Results collected in main process -> FDR correction applied -> returned via IPC

### Parallelism
- Auto-detect cores via `os.cpus().length`, default to `cores - 1`
- User-configurable "Max analysis threads" in app settings
- Threshold: <20 genes -> single worker, >= 20 -> parallel
- Progress reporting: workers post message per completed gene

### New IPC Channels
- `cohort:geneBurdenCompare` — run full analysis (groups, filters, test config -> results)
- `cohort:geneBurdenProgress` — progress events (streamed via IPC)
- `cohort:geneBurdenCancel` — abort running analysis
- `settings:analysisThreads` — get/set thread count preference

### New Service Files
- `src/main/statistics/fisher.ts` — Fisher's exact test
- `src/main/statistics/logistic.ts` — logistic regression + Firth
- `src/main/statistics/fdr.ts` — Benjamini-Hochberg
- `src/main/statistics/weights.ts` — weighting schemes (uniform, Beta(MAF), Beta(MAF)xCADD)
- `src/main/statistics/worker.ts` — worker thread entry point
- `src/main/statistics/types.ts` — shared types for test config/results

### Database Changes
- Migration v7: add `age` (REAL) and `date_of_birth` (TEXT) columns to `case_metadata`

## Testing & Validation Strategy

### Golden Reference Approach
- Generate reference test cases from variantcentrifuge (Python) with known inputs/outputs
- Cover: standard cases, zero cells, separation, edge cases (single variant, all carriers in one group)
- Store as JSON golden files in `tests/fixtures/`
- TypeScript implementations must match Python outputs within floating-point tolerance (1e-10)

### Unit Tests (Vitest)
- Fisher's exact test: 2x2 tables with known p-values, OR, CIs, zero-cell correction
- Logistic regression: convergence, coefficient accuracy vs golden reference
- Firth fallback: perfect separation, quasi-separation, convergence
- Beta(MAF) weights, CADD weights: known inputs -> expected weights
- BH FDR: known p-value vectors -> expected q-values
- Worker thread: message passing, progress reporting, cancellation

### Integration Tests
- Full pipeline: database with test cases -> group definition -> analysis -> results match expected
- Covariate handling: missing values excluded correctly, one-hot encoding
- Group validation: overlap detection, empty group errors

### E2E Tests (Playwright)
- Navigate to Gene Burden tab
- Configure groups, filters, run analysis
- Verify results table populates
- Switch between table/volcano/manhattan tabs
- Export results
