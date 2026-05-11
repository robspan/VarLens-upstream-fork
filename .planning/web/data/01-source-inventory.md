# Source Inventory

This inventory is written for developers. It names the data shape we need, the VarLens path it exercises, and candidate public sources.

## Already In Repo

| Fixture Class | Current Files | Coverage |
| --- | --- | --- |
| GIAB Chinese Trio region | `tests/test-data/vcf/trio-region*.vcf.gz`, `single-sample*.vcf.gz`, `edge-cases*.vcf.gz` | multisample, trio, VEP `CSQ`, SnpEff `ANN`, unannotated small variants |
| Synthetic VCFs | `tests/test-data/vcf/synthetic-*.vcf` | SV, CNV, STR, large allele, no-call cases |
| BED region file | `tests/test-data/vcf/test-regions.bed` | import-time region filter |
| VarLens JSON fixtures | `tests/fixtures/import/*.json*` | simple, object, columnar wrapped/unwrapped |

These are useful, but not enough for true parity E2E because most are either synthetic or not tied to a full source and transform manifest.

## Public Source Candidates

| Need | Candidate Source | Why It Helps | Notes |
| --- | --- | --- | --- |
| Small variant VCF and BED truth regions | NIST GIAB | Stable public benchmark data, already used by current fixtures | Use subsets only; record exact release URL and checksum. |
| Trio/multisample VCF | GIAB Chinese Trio | Exercises selected sample, trio metadata, and multisample parsing | Existing fixtures already use HG005/HG006/HG007 region data. |
| ClinVar VCF | NCBI ClinVar GRCh38 VCF | Exercises `CLNSIG` and public clinical annotation fields | ClinVar VCF is weekly and large. Pin archived/monthly release or record retrieval date. |
| Long-read bundle | Oxford Nanopore `wf-human-variation` demo/output shape | Matches `.wf_snp.vcf.gz`, `.wf_sv.vcf.gz`, `.wf_cnv.vcf.gz`, `.wf_str.vcf.gz` bundle names that VarLens already expects | Need verify downloadable demo terms before deriving fixtures. |
| SV VCF | Sniffles2 output from ONT or caller examples | Exercises SV extension mapping: `SVTYPE`, `END`, `SUPPORT`, `VAF`, breakends | Prefer small demo output over full WGS. |
| CNV VCF | Spectre output from ONT workflow or Spectre examples | Exercises CNV extension mapping: `CN`, `GQ`, `HO`, `SM`, `BC` | CNV examples are more variable; keep a synthetic fallback. |
| STR VCF | Straglr or ExpansionHunter examples | Exercises STR extension mapping: `REPID`, `RU`, `REPCN`, `REPCI`, disease fields | Public examples exist, but exact field coverage may not match VarLens fields. |
| Region BED | GIAB benchmark regions or ONT demo BED | Exercises import-time BED filtering | Keep tiny subsets committed. |

## Source Links Verified During Planning

- Current repo fixture README points to GIAB Chinese Trio source: `https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio`.
- ClinVar download docs describe VCF downloads for GRCh37 and GRCh38 and note weekly updates: `https://www.ncbi.nlm.nih.gov/clinvar/docs/downloads/`.
- ClinVar maintenance docs list GRCh38 VCF FTP path: `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/`.
- Oxford Nanopore `wf-human-variation` docs describe SNP, SV, CNV, STR outputs and a downloadable demo archive: `https://nanoporetech.com/document/epi2me-workflows/wf-human-variation`.

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

To call web parity E2E meaningful, we need fixtures for:

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

