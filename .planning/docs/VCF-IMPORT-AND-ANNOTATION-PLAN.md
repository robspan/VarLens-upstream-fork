# VCF Import & Annotation: Research Report and Implementation Plan

**Date:** 2026-03-29
**Scope:** Issues [#42](https://github.com/berntpopp/VarLens/issues/42) (VCF Import) and [#50](https://github.com/berntpopp/VarLens/issues/50) (Trio/Somatic Analysis)
**Goal:** Parse pre-annotated VCF files (VEP CSQ or SnpEff ANN), import into VarLens, and build a GIAB Chinese trio test dataset for validation

---

## 1. Executive Summary

VarLens currently imports only JSON formats (columnar, object, simple). This plan adds VCF import that:

1. **Parses standard VCF 4.x** files (`.vcf`, `.vcf.gz`) with coordinate, genotype, and quality data
2. **Extracts pre-existing annotations** from VEP (`CSQ`) and SnpEff (`ANN`) INFO fields
3. **Supports multi-sample VCFs** for trio/family analysis (ties into issue #50)
4. **Provides a GIAB Chinese trio test dataset** (chr22 subset, ~35K-45K variants) annotated with both VEP and SnpEff

The approach is **parse, don't annotate**: VarLens imports VCF files that users have already annotated with VEP or SnpEff/SnpSift. Optional VEP REST API annotation is a secondary feature for unannotated VCFs.

---

## 2. Test Dataset: GIAB Chinese Trio (chr22)

### 2.1 Sample Information

| Sample ID | Coriell ID | Role | Sex | Phenotype (for testing) |
|-----------|-----------|------|-----|------------------------|
| HG005 | NA24631 | Son (Proband) | Male | Affected |
| HG006 | NA24694 | Father | Male | Unaffected |
| HG007 | NA24695 | Mother | Female | Unaffected |

### 2.2 Data Source

GIAB benchmark VCFs from NCBI FTP. Using **GRCh38** (recommended, latest benchmark v4.2.1).

**Download URLs:**
```
https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio/HG005_NA24631_son/latest/GRCh38/
https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio/HG006_NA24694_father/latest/GRCh38/
https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio/HG007_NA24695_mother/latest/GRCh38/
```

### 2.3 Dataset Preparation Pipeline

```bash
#!/usr/bin/env bash
set -euo pipefail

# === Prerequisites ===
# conda install -c bioconda bcftools ensembl-vep snpeff snpsift
# OR use Docker containers

BUILD="GRCh38"
REGION="chr22"
OUTDIR="giab_chinese_trio_testdata"
BASE_URL="https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio"

mkdir -p "$OUTDIR" && cd "$OUTDIR"

# === Step 1: Download benchmark VCFs ===
for SAMPLE in HG005_NA24631_son HG006_NA24694_father HG007_NA24695_mother; do
  SHORT=$(echo $SAMPLE | cut -d_ -f1)
  wget -c "${BASE_URL}/${SAMPLE}/latest/${BUILD}/${SHORT}_${BUILD}_1_22_v4.2.1_benchmark.vcf.gz"
  wget -c "${BASE_URL}/${SAMPLE}/latest/${BUILD}/${SHORT}_${BUILD}_1_22_v4.2.1_benchmark.vcf.gz.tbi"
done

# === Step 2: Extract chr22 ===
for SAMPLE in HG005 HG006 HG007; do
  bcftools view -r "${REGION}" \
    "${SAMPLE}_${BUILD}_1_22_v4.2.1_benchmark.vcf.gz" \
    -Oz -o "${SAMPLE}_${BUILD}_${REGION}.vcf.gz"
  bcftools index -t "${SAMPLE}_${BUILD}_${REGION}.vcf.gz"
done

# === Step 3: Fix sample names if needed ===
for SAMPLE in HG005 HG006 HG007; do
  CURRENT=$(bcftools query -l "${SAMPLE}_${BUILD}_${REGION}.vcf.gz")
  if [ "$CURRENT" != "$SAMPLE" ]; then
    echo "$CURRENT $SAMPLE" > "rename_${SAMPLE}.txt"
    bcftools reheader -s "rename_${SAMPLE}.txt" \
      "${SAMPLE}_${BUILD}_${REGION}.vcf.gz" \
      -o "${SAMPLE}_${BUILD}_${REGION}_tmp.vcf.gz"
    mv "${SAMPLE}_${BUILD}_${REGION}_tmp.vcf.gz" "${SAMPLE}_${BUILD}_${REGION}.vcf.gz"
    bcftools index -t "${SAMPLE}_${BUILD}_${REGION}.vcf.gz"
  fi
done

# === Step 4: Merge into multi-sample trio VCF ===
bcftools merge \
  "HG005_${BUILD}_${REGION}.vcf.gz" \
  "HG006_${BUILD}_${REGION}.vcf.gz" \
  "HG007_${BUILD}_${REGION}.vcf.gz" \
  -Oz -o "chinese_trio_${BUILD}_${REGION}.vcf.gz"
bcftools index -t "chinese_trio_${BUILD}_${REGION}.vcf.gz"

# === Step 5: Create PED file ===
cat > chinese_trio.ped << 'PEDEOF'
CHINESE_TRIO	HG005	HG006	HG007	1	2
CHINESE_TRIO	HG006	0	0	1	1
CHINESE_TRIO	HG007	0	0	2	1
PEDEOF

# === Step 6: Verify ===
echo "=== Samples ===" && bcftools query -l "chinese_trio_${BUILD}_${REGION}.vcf.gz"
echo "=== Stats ===" && bcftools stats "chinese_trio_${BUILD}_${REGION}.vcf.gz" | grep "^SN"
```

**Expected chr22 output:** ~35,000-45,000 variants per sample; merged trio VCF ~5-10 MB compressed.

### 2.4 Annotating the Test Dataset

#### Option A: VEP Annotation

```bash
# Using Docker (recommended)
docker run --rm -v $(pwd):/data -v $HOME/.vep:/opt/vep/.vep \
  ensemblorg/ensembl-vep:release_115.2 \
  vep \
    --input_file /data/chinese_trio_GRCh38_chr22.vcf.gz \
    --output_file /data/chinese_trio_GRCh38_chr22.vep.vcf \
    --vcf \
    --cache --offline \
    --assembly GRCh38 \
    --everything \
    --fork 4 \
    --force_overwrite

# OR using conda
vep \
  --input_file chinese_trio_GRCh38_chr22.vcf.gz \
  --output_file chinese_trio_GRCh38_chr22.vep.vcf \
  --vcf --cache --offline \
  --assembly GRCh38 \
  --everything \
  --fork 4 \
  --force_overwrite

bgzip chinese_trio_GRCh38_chr22.vep.vcf
tabix -p vcf chinese_trio_GRCh38_chr22.vep.vcf.gz
```

**VEP Cache Setup (first-time only):**
```bash
# ~20 GB download + ~30 GB uncompressed
mkdir -p $HOME/.vep
cd $HOME/.vep
curl -O https://ftp.ensembl.org/pub/release-115/variation/indexed_vep_cache/homo_sapiens_vep_115_GRCh38.tar.gz
tar xzf homo_sapiens_vep_115_GRCh38.tar.gz
```

#### Option B: SnpEff + SnpSift Annotation

```bash
# Using conda
# Step 1: SnpEff functional annotation
snpEff ann -v -noStats GRCh38.mane.1.2.ensembl \
  chinese_trio_GRCh38_chr22.vcf.gz \
  > chinese_trio_GRCh38_chr22.snpeff.vcf

# Step 2: Add ClinVar (download ClinVar VCF first)
wget -q https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/clinvar.vcf.gz
wget -q https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/clinvar.vcf.gz.tbi

SnpSift annotate -name CLINVAR_ \
  -info CLNSIG,CLNDN,CLNREVSTAT \
  clinvar.vcf.gz \
  chinese_trio_GRCh38_chr22.snpeff.vcf \
  > chinese_trio_GRCh38_chr22.snpeff.clinvar.vcf

# Step 3: Add dbNSFP scores (CADD, REVEL, etc.)
# Download dbNSFP first (~30 GB)
SnpSift dbnsfp -v \
  -db dbNSFP4.5c.txt.gz \
  -f SIFT_pred,CADD_phred,REVEL_score,Polyphen2_HDIV_pred \
  chinese_trio_GRCh38_chr22.snpeff.clinvar.vcf \
  > chinese_trio_GRCh38_chr22.fully_annotated.vcf

bgzip chinese_trio_GRCh38_chr22.fully_annotated.vcf
tabix -p vcf chinese_trio_GRCh38_chr22.fully_annotated.vcf.gz
```

#### Option C: Piped SnpEff + SnpSift (no intermediate files)

```bash
snpEff ann -v -noStats GRCh38.mane.1.2.ensembl chinese_trio_GRCh38_chr22.vcf.gz \
  | SnpSift annotate -name CLINVAR_ -info CLNSIG,CLNDN,CLNREVSTAT clinvar.vcf.gz \
  | SnpSift dbnsfp -db dbNSFP4.5c.txt.gz -f SIFT_pred,CADD_phred,REVEL_score \
  | bgzip > chinese_trio_GRCh38_chr22.fully_annotated.vcf.gz
tabix -p vcf chinese_trio_GRCh38_chr22.fully_annotated.vcf.gz
```

### 2.5 Final Test Files

After preparation, we'll have these test assets:

| File | Purpose | Approx. Size |
|------|---------|-------------|
| `chinese_trio_GRCh38_chr22.vcf.gz` | Raw merged trio VCF (no annotations) | ~5-10 MB |
| `chinese_trio_GRCh38_chr22.vep.vcf.gz` | VEP-annotated trio VCF (CSQ field) | ~15-25 MB |
| `chinese_trio_GRCh38_chr22.fully_annotated.vcf.gz` | SnpEff+ClinVar+dbNSFP annotated trio VCF (ANN field) | ~15-25 MB |
| `chinese_trio.ped` | PED pedigree file | <1 KB |
| `HG005_GRCh38_chr22.vcf.gz` | Single-sample VCF (son only) | ~3-5 MB |

**For unit tests:** We'll also create a tiny synthetic VCF (~50 variants) with hand-crafted ANN/CSQ fields covering edge cases (multi-allelic, missing genotypes, multiple transcripts, etc.).

---

## 3. VCF Annotation Format Reference

### 3.1 VEP CSQ Field

Added to INFO as `CSQ`. Format defined in VCF header:

```
##INFO=<ID=CSQ,Number=.,Type=String,Description="... Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|...">
```

**Key fields for VarLens mapping:**

| CSQ Field | VarLens Column | Notes |
|-----------|---------------|-------|
| `SYMBOL` | `gene_symbol` | Gene symbol |
| `Consequence` | `consequence` | SO term(s), `&`-separated |
| `IMPACT` | (new or map to `func`) | HIGH/MODERATE/LOW/MODIFIER |
| `Feature` | `transcript` | Ensembl transcript ID |
| `HGVSc` | `cdna` | cDNA HGVS notation |
| `HGVSp` | `aa_change` | Protein HGVS notation |
| `gnomADe_AF` or `gnomADg_AF` | `gnomad_af` | Population allele frequency |
| `CADD_PHRED` | `cadd` | CADD phred-scaled score |
| `ClinVar_CLNSIG` | `clinvar` | ClinVar significance |
| `SIFT` | (optional) | Prediction + score |
| `PolyPhen` | (optional) | Prediction + score |
| `CANONICAL` | `is_canonical` (transcript) | YES if canonical |
| `MANE_SELECT` | `is_mane_select` (transcript) | MANE transcript ID |
| `BIOTYPE` | (transcript) | protein_coding, etc. |

### 3.2 SnpEff ANN Field

Added to INFO as `ANN`. 16 pipe-delimited subfields per annotation:

```
ANN=Allele|Annotation|Impact|Gene_Name|Gene_ID|Feature_Type|Feature_ID|Transcript_BioType|Rank|HGVS.c|HGVS.p|cDNA.pos/cDNA.length|CDS.pos/CDS.length|AA.pos/AA.length|Distance|ERRORS_WARNINGS_INFO
```

**Key fields for VarLens mapping:**

| ANN Field (#) | VarLens Column | Notes |
|---------------|---------------|-------|
| Gene_Name (4) | `gene_symbol` | HGNC symbol |
| Annotation (2) | `consequence` | SO term(s), `&`-separated |
| Impact (3) | (map to `func`) | HIGH/MODERATE/LOW/MODIFIER |
| Feature_ID (7) | `transcript` | Transcript ID with version |
| HGVS.c (10) | `cdna` | cDNA change |
| HGVS.p (11) | `aa_change` | Protein change |
| Transcript_BioType (8) | (transcript) | protein_coding, etc. |
| Rank (9) | (optional) | Exon/intron number |

**SnpSift-added fields** (separate INFO keys):
- `CLINVAR_CLNSIG` → `clinvar`
- `dbNSFP_CADD_phred` → `cadd`
- `dbNSFP_REVEL_score` → (new field or store in annotations)
- `dbNSFP_SIFT_pred` → (optional)

### 3.3 Genotype Fields (FORMAT column)

Critical for trio analysis (issue #50):

| FORMAT Field | VarLens Column | Description |
|-------------|---------------|-------------|
| `GT` | `gt_num` | Genotype (0/0, 0/1, 1/1, ./.) |
| `GQ` | `gq` (new) | Genotype quality |
| `DP` | `dp` (new) | Read depth |
| `AD` | `ad_ref`, `ad_alt` (new) | Allelic depths (ref,alt) |
| `AB` (computed) | `ab` (new) | Allele balance = AD_alt / DP |
| `QUAL` | `qual` | Variant quality score |
| `FILTER` | (new or existing) | PASS or filter reasons |

---

## 4. VarLens Implementation Plan

### Phase 1: VCF Parser Core

**Goal:** Parse VCF files into VarLens variant records without annotation extraction.

1. **VCF parser module** (`src/main/import/vcf/`)
   - Header parser: extract `##INFO`, `##FORMAT`, `##contig`, `#CHROM` lines
   - Variant line parser: split fixed columns (CHROM, POS, ID, REF, ALT, QUAL, FILTER, INFO, FORMAT)
   - Genotype parser: extract per-sample GT, GQ, DP, AD from FORMAT/sample columns
   - Multi-allelic splitter: decompose multi-allelic sites into biallelic records
   - Genome build detection: from `##contig` or `##reference` headers (reuse existing `GenomeBuildDetector`)

2. **Stream parser for large files**
   - Line-by-line streaming (not full JSON like current importers)
   - Support `.vcf.gz` via existing `createDecompressedStream` (gzip detection already works)
   - Feed into existing `BatchAccumulator` → `insertBatch()` pattern

3. **Library choice**: `@gmod/vcf` (lightweight JS VCF parser) or custom line parser
   - `@gmod/vcf` handles header parsing, INFO/FORMAT field extraction, multi-allelic
   - Custom parser gives more control and fewer dependencies

4. **Format detection**: Extend `format-detection.ts` to detect VCF by first line (`##fileformat=VCFv4.x`)

### Phase 2: Annotation Extraction (CSQ/ANN Parsing)

**Goal:** Extract pre-existing VEP and SnpEff annotations from VCF INFO field.

1. **CSQ parser** (`src/main/import/vcf/csq-parser.ts`)
   - Parse CSQ field format from VCF header (`##INFO=<ID=CSQ,...Format: ...>`)
   - Split CSQ value by `,` (multiple annotations) then `|` (fields)
   - Map CSQ fields → VarLens variant schema (see table in §3.1)
   - Handle `--pick` output (single annotation) and multi-transcript output
   - For multi-transcript: populate `variant_transcripts` table, mark canonical/MANE as selected

2. **ANN parser** (`src/main/import/vcf/ann-parser.ts`)
   - Parse ANN field (fixed 16-field format, always same order)
   - Map ANN fields → VarLens variant schema (see table in §3.2)
   - Extract SnpSift-added INFO fields (CLINVAR_*, dbNSFP_*) separately

3. **Unified annotation extraction**
   - Auto-detect whether VCF has CSQ (VEP) or ANN (SnpEff) or both
   - If both present, prefer CSQ (more comprehensive with `--everything`)
   - Extract standalone INFO fields regardless (gnomAD AF, CADD, ClinVar, etc.)
   - Handle missing/empty annotation fields gracefully

### Phase 3: Multi-Sample VCF & Trio Support

**Goal:** Import multi-sample VCFs and create analysis groups for trio analysis.

1. **Sample extraction**
   - Parse `#CHROM` header line to get sample names
   - Import dialog: show sample list, let user select which to import
   - Create one case per sample, linked via analysis group

2. **Per-sample genotype storage**
   - For each sample: extract GT, GQ, DP, AD from FORMAT columns
   - Compute derived fields: AB = AD_alt / (AD_ref + AD_alt), VAF = AD_alt / DP
   - Store in existing variant columns + new genotype quality columns (from issue #50 schema)

3. **PED file import**
   - Parse PED format (6 columns: family, individual, father, mother, sex, phenotype)
   - Create analysis groups and link cases by family relationships
   - Validate sample IDs match VCF sample names

4. **Integration with issue #50**
   - Multi-sample VCF import feeds directly into the trio/analysis group model
   - Genotype quality fields (GQ, DP, AD) enable inheritance filtering

### Phase 4: Import Dialog UX

**Goal:** User-friendly VCF import experience.

1. **File selection**: Accept `.vcf`, `.vcf.gz` (add to existing file dialog filters)
2. **Preview panel**:
   - Variant count (quick scan of file)
   - Sample names detected
   - Annotation type detected (VEP CSQ / SnpEff ANN / unannotated)
   - Genome build detected
3. **Sample selection** (multi-sample): checkboxes for which samples to import
4. **Annotation options**:
   - "Parse existing annotations" (default ON if CSQ/ANN detected)
   - "Annotate via VEP REST API" (optional, for unannotated VCFs)
5. **Progress**: reuse existing progress bar with phases (reading → parsing → inserting)

### Phase 5: VEP REST API Annotation (Small Datasets Only)

**Goal:** Allow lightweight annotation of small, unannotated VCFs via Ensembl REST API. This is **not** intended for exome- or genome-scale data — users working with large datasets should annotate locally with VEP or SnpEff/SnpSift before importing.

**Scope:** Targeted at small gene panels, candidate variant lists, or ad-hoc queries (up to ~1,000 variants).

1. **Batch submission**: POST to `https://rest.ensembl.org/vep/human/region` (max 200 variants/request)
2. **Rate limiting**: 55,000 requests/hour, respect `Retry-After` on 429
3. **Response mapping**: Map REST JSON → VarLens variant schema
4. **Caching**: Store responses in existing `api_cache` table
5. **Progress**: Track batches submitted/remaining
6. **Guard rails**: Warn users if VCF contains >1,000 variants and suggest local annotation instead; hard limit at ~5,000 variants

---

## 5. VCF Parser → VarLens Schema Mapping

### 5.1 Core VCF Fields → Variant Columns

| VCF Field | VarLens Column | Transform |
|-----------|---------------|-----------|
| CHROM | `chr` | Strip `chr` prefix for GRCh37 if needed |
| POS | `pos` | Direct (1-based) |
| REF | `ref` | Direct |
| ALT | `alt` | Split multi-allelic first |
| QUAL | `qual` | Direct (float) |
| FILTER | (new or existing) | PASS or filter string |
| GT (FORMAT) | `gt_num` | Direct (0/0, 0/1, 1/1, ./.) |

### 5.2 Annotation Fields → Variant Columns

| Source | Field | VarLens Column |
|--------|-------|---------------|
| CSQ/ANN | Gene symbol | `gene_symbol` |
| CSQ/ANN | Consequence | `consequence` |
| CSQ/ANN | Impact | `func` or new `impact` |
| CSQ/ANN | Transcript ID | `transcript` |
| CSQ/ANN | HGVS.c | `cdna` |
| CSQ/ANN | HGVS.p | `aa_change` |
| CSQ `gnomADe_AF` / INFO `gnomAD_AF` | `gnomad_af` | Parse float |
| CSQ `CADD_PHRED` / INFO `dbNSFP_CADD_phred` | `cadd` | Parse float |
| CSQ `ClinVar_CLNSIG` / INFO `CLINVAR_CLNSIG` / INFO `CLNSIG` | `clinvar` | Map to VarLens classification |
| INFO `OMIM` or gene lookup | `omim_mim_number` | If available |

### 5.3 Multi-Transcript Handling

When VEP/SnpEff output contains multiple transcripts per variant:

1. Parse all transcripts into `variant_transcripts` table
2. Select "best" transcript using priority:
   - MANE Select (`MANE_SELECT` in CSQ) → `is_mane_select = 1`
   - Canonical (`CANONICAL=YES` in CSQ) → `is_canonical = 1`
   - Highest impact (HIGH > MODERATE > LOW > MODIFIER)
   - First protein_coding transcript
3. Copy selected transcript's annotations to main `variants` row

---

## 6. Tool Installation Quick Reference

### VEP Installation

| Method | Command | Pros |
|--------|---------|------|
| **Docker** | `docker pull ensemblorg/ensembl-vep:release_115.2` | Most reproducible |
| **Conda** | `conda install -c bioconda ensembl-vep=115.2` | Easy, but Perl deps fragile |
| **Source** | `git clone https://github.com/Ensembl/ensembl-vep.git && perl INSTALL.pl` | Most control |

**Cache:** ~20 GB compressed, ~30 GB uncompressed (GRCh38). Download from `https://ftp.ensembl.org/pub/release-115/variation/indexed_vep_cache/`

### SnpEff/SnpSift Installation

| Method | Command | Pros |
|--------|---------|------|
| **Conda** | `conda install -c bioconda snpeff snpsift` | Easiest |
| **Docker** | `docker pull quay.io/biocontainers/snpeff:5.2--hdfd78af_3` | Reproducible |
| **Manual** | `wget https://snpeff-public.s3.amazonaws.com/versions/snpEff_latest_core.zip` | Self-contained JAR |

**Database:** Auto-downloads on first use. Pre-download: `snpEff download GRCh38.mane.1.2.ensembl`
**Java:** Requires Java 21+, allocate `-Xmx8g` for human genomes.

### bcftools (for dataset preparation)

```bash
conda install -c bioconda bcftools   # or apt-get install bcftools
```

---

## 7. VEP vs SnpEff: Recommendation for VarLens

| Criterion | VEP (CSQ) | SnpEff (ANN) |
|-----------|-----------|-------------|
| Clinical adoption | Higher (ACMG/ClinGen) | Good but less |
| MANE Select support | Native | Via database choice |
| Field richness | 30+ with `--everything` | 16 fixed + SnpSift extras |
| gnomAD AF | Included in cache | Requires SnpSift + dbNSFP |
| CADD | Plugin | SnpSift + dbNSFP |
| ClinVar | `--custom` flag | SnpSift annotate |
| Speed | Moderate | Fast |
| Concordance | ~95% agreement on consequence calls |

**VarLens should support both.** Both are widely used. The parser detects CSQ vs ANN automatically and maps to the same internal schema.

---

## 8. Implementation Priority

| Priority | Task | Effort | Dependency |
|----------|------|--------|-----------|
| **P0** | VCF line parser (CHROM/POS/REF/ALT/GT) | Medium | None |
| **P0** | Format detection for VCF | Small | None |
| **P0** | VCF import strategy (single-sample, no annotations) | Medium | Parser |
| **P1** | CSQ parser (VEP annotations) | Medium | Parser |
| **P1** | ANN parser (SnpEff annotations) | Medium | Parser |
| **P1** | Multi-allelic site splitting | Medium | Parser |
| **P1** | GIAB test dataset preparation | Medium | External tools |
| **P2** | Multi-sample VCF import | Large | Parser + issue #50 schema |
| **P2** | PED file import | Small | Multi-sample |
| **P2** | Import dialog UX for VCF | Medium | Parser |
| **P3** | VEP REST API annotation (small datasets only, ≤1K variants) | Medium | None |
| **P3** | Genotype quality fields (GQ, DP, AD) | Medium | Issue #50 schema |

---

## 9. Test Strategy

### Unit Tests (Vitest)

1. **VCF header parsing** — extract INFO/FORMAT definitions, sample names, contigs
2. **VCF line parsing** — fixed fields, INFO key-value extraction
3. **CSQ field parsing** — single annotation, multiple transcripts, edge cases
4. **ANN field parsing** — 16-field extraction, multi-annotation, `&`-separated effects
5. **Multi-allelic splitting** — 2+ ALT alleles decomposed correctly
6. **Genotype parsing** — GT/GQ/DP/AD extraction per sample
7. **Schema mapping** — CSQ/ANN fields → VarLens variant record
8. **PED file parsing** — family structure, validation

### Integration Tests

1. **Single-sample VCF import** — unannotated VCF → database records
2. **VEP-annotated VCF import** — CSQ parsing → variant + transcript records
3. **SnpEff-annotated VCF import** — ANN parsing → variant + transcript records
4. **Multi-sample VCF import** — 3-sample trio → 3 cases + analysis group
5. **Large file performance** — chr22 GIAB dataset (~40K variants) import time

### E2E Tests (Playwright)

1. **VCF file selection** — file dialog accepts .vcf/.vcf.gz
2. **Import preview** — shows variant count, samples, annotation type
3. **Import progress** — progress bar during import
4. **Imported variant view** — annotations visible in variant table

---

## 10. References

- [GIAB Chinese Trio FTP](https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/release/ChineseTrio/)
- [GIAB GitHub](https://github.com/genome-in-a-bottle)
- [Ensembl VEP Documentation](https://www.ensembl.org/info/docs/tools/vep/index.html)
- [VEP REST API](https://rest.ensembl.org/documentation/info/vep_region_post)
- [SnpEff & SnpSift Documentation](https://pcingola.github.io/SnpEff/)
- [VCF Annotation Format v1.0 Spec](https://snpeff.sourceforge.net/VCFannotationformat_v1.0.pdf)
- [VarLens Trio/Somatic Analysis Report](.planning/docs/TRIO-SOMATIC-ANALYSIS-REPORT.md)
- [bcftools Documentation](https://samtools.github.io/bcftools/)
