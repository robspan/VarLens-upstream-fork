# Data Public Source Expansion

Status: backlog.

The default manifest-backed parity set already covers the minimum type matrix from
`../active/data/01-source-inventory.md`. These public sources remain useful for a later expansion
pass when the team wants less synthetic evidence or larger realism checks.

| Need | Candidate Source | Why It Helps | Notes |
| --- | --- | --- | --- |
| Small variant VCF and BED truth regions | NIST GIAB | Stable public benchmark data, already used by current fixtures | Use subsets only; record exact release URL and checksum. |
| Trio/multisample VCF | GIAB Chinese Trio | Exercises selected sample, trio metadata, and multisample parsing | Existing fixtures already use HG005/HG006/HG007 region data. |
| ClinVar VCF | NCBI ClinVar GRCh38 VCF | Exercises `CLNSIG` and public clinical annotation fields | ClinVar VCF is weekly and large. Pin archived/monthly release or record retrieval date. |
| Long-read bundle | Oxford Nanopore `wf-human-variation` demo/output shape | Matches `.wf_snp.vcf.gz`, `.wf_sv.vcf.gz`, `.wf_cnv.vcf.gz`, `.wf_str.vcf.gz` bundle names that VarLens already expects | Verify downloadable demo terms before deriving fixtures. |
| SV VCF | Sniffles2 output from ONT or caller examples | Exercises SV extension mapping: `SVTYPE`, `END`, `SUPPORT`, `VAF`, breakends | Prefer small demo output over full WGS. |
| CNV VCF | Spectre output from ONT workflow or Spectre examples | Exercises CNV extension mapping: `CN`, `GQ`, `HO`, `SM`, `BC` | CNV examples are variable; keep a synthetic fallback. |
| STR VCF | Straglr or ExpansionHunter examples | Exercises STR extension mapping: `REPID`, `RU`, `REPCN`, `REPCI`, disease fields | Public examples exist, but exact field coverage may not match VarLens fields. |
| Region BED | GIAB benchmark regions or ONT demo BED | Exercises import-time BED filtering | Keep tiny subsets committed or generated. |

Source links verified during planning:

- GIAB Chinese Trio source: `https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio`
- ClinVar VCF downloads: `https://www.ncbi.nlm.nih.gov/clinvar/docs/downloads/`
- ClinVar GRCh38 FTP path: `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/`
- Oxford Nanopore `wf-human-variation` docs:
  `https://nanoporetech.com/document/epi2me-workflows/wf-human-variation`
