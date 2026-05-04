# PostgreSQL WGS Query Budgets

PostgreSQL WGS query readiness is evidence-gated. These budgets are provisional until two local runs and one CI-like Linux run agree within 25%.

## Initial Budgets

| Query | p95 budget |
| --- | ---: |
| exact coordinate lookup | <= 250 ms |
| gene query | <= 1500 ms |
| impact/pathogenicity filter | <= 2500 ms |
| text search | <= 3000 ms |
| cohort carrier query | <= 5000 ms |

## Artifact Contract

`tests/perf/postgres-wgs-query.perf.test.ts` emits JSON artifacts under `.planning/artifacts/perf/postgres-query/`.
Each artifact records PostgreSQL version, fixture identity, case count, variant count, and per-query `p50Ms`, `p95Ms`, `maxMs`, `rows`, `budgetP95Ms`, and `budgetStatus`.

Budgets are recorded as metadata only during baseline collection. The perf test must write artifacts and pass before any budget failure becomes a release gate.

## Evidence Summary

Run recorded locally on 2026-04-30:

- Artifact: `.planning/artifacts/perf/postgres-query/2026-04-30T17-02-27-048Z-postgres-query.json`
- PostgreSQL version: PostgreSQL 18.3 (Debian 18.3-1.pgdg13+1), 64-bit
- Fixture: `tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz`
- Cases: 4
- Variants: 4,096,128

| Query | p50 ms | p95 ms | max ms | rows | Budget | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| exact coordinate lookup | 0.39 | 3.46 | 3.46 | 1 | <= 250 ms | pass |
| gene query | 152.85 | 159.95 | 159.95 | 0 | <= 1500 ms | unavailable |
| impact/pathogenicity filter | 0.28 | 0.60 | 0.60 | 0 | <= 2500 ms | unavailable |
| text search | 675.31 | 694.97 | 694.97 | 0 | <= 3000 ms | unavailable |
| cohort carrier query | 3064.10 | 3071.72 | 3071.72 | 100 | <= 5000 ms | pass |

The GIAB benchmark VCF imported for this run does not populate annotation fields used by gene, impact/pathogenicity, or text-search filters, so those rows are recorded as unavailable and must not be used to claim representative WGS annotation-query readiness.

Recommendation: do not add query indexes from this run. Coordinate lookup and cohort carrier query are within provisional budgets, but WGS query readiness remains partial until an annotated WGS fixture exercises gene, impact/pathogenicity, and text-search paths. Defer any public WGS query readiness claim to a follow-up evidence run with representative annotation coverage.

No index follow-up plan is needed from this evidence because there is no representative budget failure greater than 25%.
