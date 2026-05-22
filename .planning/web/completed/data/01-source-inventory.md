# Source Inventory

This inventory is written for developers. It names the data shape we need, the VarLens path it exercises, and candidate public sources.

Status: the minimum default parity coverage is implemented in `scripts/data-fixtures/sources.json`
and enforced by `tests/web-gate/data-fixtures.test.ts`. Public-source expansion candidates are
tracked separately in `../../backlog/data-public-source-expansion.md`.

## Already In Repo

| Fixture Class | Current Files | Coverage |
| --- | --- | --- |
| GIAB Chinese Trio region | `tests/test-data/vcf/trio-region*.vcf.gz`, `single-sample*.vcf.gz`, `edge-cases*.vcf.gz` | multisample, trio, VEP `CSQ`, SnpEff `ANN`, unannotated small variants |
| Synthetic VCFs | `tests/test-data/vcf/synthetic-*.vcf` | SV, CNV, STR, large allele, no-call cases |
| BED region file | `tests/test-data/vcf/test-regions.bed` | import-time region filter |
| VarLens JSON fixtures | `tests/fixtures/import/*.json*` | simple, object, columnar wrapped/unwrapped |

These files are now tied together by `scripts/data-fixtures/sources.json` and generated into
gitignored parity artifacts by `make web-data-prepare`.

## Dataset Selection Rules

Prefer sources that are:

- public and redistributable or safe to transform into tiny derived fixtures
- deterministic by pinned release or checksum
- small after subsetting
- close to real pipeline output
- able to exercise a specific VarLens mapping path

Avoid sources that are:

- only available behind controlled access
- too large to subset reproducibly
- missing clear terms
- biologically interesting but type-redundant

## Minimum Data Coverage Matrix

The default manifest-backed parity set covers:

| Coverage Tag | Required Artifact |
| --- | --- |
| `snv`, `indel`, `vcf-unannotated` | one unannotated small VCF |
| `vcf-csq` | one VEP-annotated VCF |
| `vcf-ann` | one SnpEff-annotated VCF |
| `multisample` | one VCF with at least two sample columns |
| `trio` | one trio fixture plus PED where relevant |
| `sv` | one SV VCF |
| `cnv` | one CNV VCF |
| `str` | one STR VCF |
| `bed-region-filter` | one BED/BED.GZ file used during import |
| `json-simple` | one generated VarLens simple JSON |
| `json-object` | one generated VarLens object JSON |
| `json-columnar` | one generated VarLens columnar JSON |
| `zip-extraction` | one zip fixture containing JSON/GZ import files |
