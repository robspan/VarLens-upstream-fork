# Research: Trio/Duo Analysis, Somatic Analysis, and UI/UX Patterns

Compiled: 2026-03-09

---

## Table of Contents

1. [Topic 1: Trio/Duo Analysis in Variant Analysis Tools](#topic-1-trioduo-analysis)
   - [1.1 Standard Inheritance Filter Types](#11-standard-inheritance-filter-types)
   - [1.2 Pedigree/Relationship Data Models](#12-pedigreerelationship-data-models)
   - [1.3 Best Practices for Inheritance Filter Implementation](#13-best-practices-for-inheritance-filter-implementation)
   - [1.4 JSON/VCF Standards for Family Data](#14-jsonvcf-standards-for-family-data)
2. [Topic 2: Tumor-Normal (Somatic) Analysis](#topic-2-tumor-normal-somatic-analysis)
   - [2.1 Tumor-Normal Pair Relationship Modeling](#21-tumor-normal-pair-relationship-modeling)
   - [2.2 Somatic Variant Filtering](#22-somatic-variant-filtering)
   - [2.3 Best Practices from Existing Tools](#23-best-practices-from-existing-tools)
3. [Topic 3: UI/UX Patterns](#topic-3-uiux-patterns)
   - [3.1 Family/Relationship Configuration UI](#31-familyrelationship-configuration-ui)
   - [3.2 Inheritance Filter Selection UI](#32-inheritance-filter-selection-ui)
   - [3.3 Tumor-Normal Pair Assignment UI](#33-tumor-normal-pair-assignment-ui)
   - [3.4 Segregation Analysis Results Display](#34-segregation-analysis-results-display)

---

## Topic 1: Trio/Duo Analysis

### 1.1 Standard Inheritance Filter Types

#### De Novo Variants

**Definition:** Variants present in the proband (child) but absent from both parents. These arise as new mutations in the germline of one parent or early in embryonic development.

**Detection Criteria:**
- Proband must be heterozygous (0/1) for the variant
- Both parents must be homozygous reference (0/0)
- No alternative allele-carrying reads (AAC) allowed in parents for indels; AAC <= 1 for SNVs in parents
- Parental allele balance must be < 2% (to exclude mosaic parental carriers)

**Quality Thresholds (consensus from literature):**
| Parameter | Proband | Parents |
|-----------|---------|---------|
| Genotype Quality (GQ) | >= 20 | >= 20 |
| Read Depth (DP) | >= 10 | >= 10 |
| Allele Balance (AB) | 0.2 - 0.8 | < 0.02 (alt reads) |
| Alt Read Count | >= 3-5 | 0 (indels), <= 1 (SNVs) |

**Filter Effectiveness:**
- GQ >= 20 alone removes >80% of false positives while retaining >99% of true positives
- Depth and AB cutoffs each remove ~20% of false positives with >99% true positive retention
- Consensus calling across multiple callers (GATK HC, DeepTrio, GRAF) achieves 98.0-99.4% precision and 99.4% sensitivity

**ACMG Relevance:** De novo variants can be classified with the PS2 criterion (strong evidence of pathogenicity) when confirmed through inheritance data.

**References:**
- [Efficient identification of de novo mutations - Life Science Alliance](https://www.life-science-alliance.org/content/8/6/e202403039)
- [Effective variant filtering - npj Genomic Medicine](https://www.nature.com/articles/s41525-021-00227-3)
- [DeepTrio for de novo detection - NAR Genomics](https://academic.oup.com/nargab/article/6/1/lqae013/7606149)

---

#### Compound Heterozygous Variants

**Definition:** Two different heterozygous variants in the same gene, located on different copies of the chromosome (in *trans*), together disrupting both alleles of a recessive gene.

**Detection Algorithm:**
1. **Gene-based grouping:** Group all heterozygous variants by gene
2. **Pair identification:** Find pairs of heterozygous variants within each gene in the affected individual
3. **Trans verification (phasing):** Confirm the two variants are on different chromosomes:
   - **Trio phasing (best):** One variant inherited from mother, the other from father. Check: parent A is het at site 1 and ref at site 2; parent B is het at site 2 and ref at site 1
   - **Read-based phasing:** If variants are within a read-pair distance, check that they appear on different reads
   - **Population-based phasing:** Statistical phasing using reference haplotype panels (less reliable for rare variants)
4. **Exclusion criteria:**
   - Neither parent can be homozygous alt at either site
   - Both parents cannot be heterozygous at BOTH sites (would make it ambiguous cis vs trans)
   - Unaffected siblings should not carry the same compound het pair

**GEMINI comp_het rules (strict):**
- All affected individuals must be heterozygous at both sites
- No unaffected individual can be homozygous alt at either site
- Neither parent of an affected can be homozygous reference at BOTH sites (at least one must carry each variant)
- Excludes intronic/non-coding variants with `impact_severity == 'LOW' AND is_exonic == FALSE`

**Phasing Tools:**
- **SmartPhase:** Combines trio phasing, read-based phasing, and GATK physical phasing for clinical workflows
- **WhatsHap:** Read-based phasing for long reads
- **SHAPEIT5:** Population-based phasing for large cohorts

**References:**
- [SmartPhase - PLOS Comp Bio](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007613)
- [CompoundHetVIP pipeline](https://pmc.ncbi.nlm.nih.gov/articles/PMC7905494/)
- [Inferring compound heterozygosity - Nature Genetics](https://www.nature.com/articles/s41588-023-01608-3)

---

#### Homozygous Recessive (Autosomal Recessive)

**Definition:** Affected individual is homozygous for the alternate allele at a variant position in an autosomal recessive gene.

**Genotype Criteria:**
| Family Member | Genotype Requirement |
|---------------|---------------------|
| Affected proband | Homozygous alt (1/1) |
| Unaffected parents | Heterozygous carriers (0/1) each |
| Unaffected siblings | NOT homozygous alt (0/0 or 0/1) |

**Additional Considerations:**
- Regions of Homozygosity (ROH) > 1 MB may indicate consanguinity, uniparental disomy, or large deletions
- In consanguineous families, expect longer ROH segments with disease-causing homozygous variants within them
- GEMINI `autosomal_recessive` tool: all affected must be HOM_ALT; unaffected cannot be HOM_ALT; parents of affected must be HET (carriers)

---

#### X-Linked Inheritance

**Hemizygous Males:**
- Males have only one X chromosome, so all X-linked variants are hemizygous
- In VCF, hemizygous genotypes should be encoded as 0 or 1 (not 0/0 or 0/1), though some callers output 0/1 or 1/1 for males on chrX
- Males with a single mutant copy are treated as "homozygous" for filtering purposes, exempting them from compound het checking

**X-Linked Recessive:**
| Family Member | Genotype Requirement |
|---------------|---------------------|
| Affected male | Hemizygous alt (1 or 1/1) |
| Carrier mother | Heterozygous (0/1), may be unaffected |
| Unaffected father | Hemizygous ref (0 or 0/0) |

**X-Linked Dominant:**
| Family Member | Genotype Requirement |
|---------------|---------------------|
| Affected individual | Het (0/1) female or hemizygous (1) male |
| Unaffected parents | Homozygous ref (except for incomplete penetrance) |

**X-Linked De Novo:**
- Variant present in affected male, absent from both parents
- For affected females: variant present as het, absent from both parents

**Pseudoautosomal Regions (PAR1, PAR2):**
- Variants in PARs function like autosomal variants (diploid in both sexes)
- Must be excluded from X-linked inheritance filtering
- PAR1: chrX:10,001-2,781,479 (GRCh38)
- PAR2: chrX:155,701,383-156,030,895 (GRCh38)

**References:**
- [Hemizygosity reveals variant pathogenicity on X chromosome - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9840679/)
- [OVAS inheritance modeling - BMC Bioinformatics](https://pmc.ncbi.nlm.nih.gov/articles/PMC5806474/)
- [Patterns of X-linked inheritance - Genetics in Medicine](https://www.sciencedirect.com/science/article/abs/pii/S1098360025000310)

---

#### Autosomal Dominant

**Definition:** A single heterozygous variant is sufficient to cause disease.

**Genotype Criteria:**
| Family Member | Genotype Requirement |
|---------------|---------------------|
| Affected individual | Heterozygous (0/1) |
| Unaffected family | Homozygous reference (0/0) |

**Incomplete Penetrance Considerations:**
- With complete penetrance: variant must be present in ALL affected and ABSENT from ALL unaffected
- With incomplete penetrance: variant must be present in ALL affected; unaffected members MAY carry the variant
- Genomics England handles this with separate "complete penetrance" and "incomplete penetrance" analysis modes
- GEMINI `autosomal_dominant` tool: all affected must have the variant; with `--lenient`, unaffected carriers are allowed

**De Novo Dominant:** A special case where the variant is de novo (absent in parents) and causes a dominant disorder. This is common for severe developmental disorders.

---

### 1.2 Pedigree/Relationship Data Models

#### PED File Format (PLINK/GATK Standard)

The PED file is the universal standard for encoding family relationships. Six mandatory tab-delimited columns:

```
#Family_ID  Individual_ID  Paternal_ID  Maternal_ID  Sex  Phenotype
FAM001      proband        father       mother       1    2
FAM001      father         0            0            1    1
FAM001      mother         0            0            2    1
FAM001      sibling        father       mother       2    1
```

| Column | Field | Values |
|--------|-------|--------|
| 1 | Family ID | String identifier |
| 2 | Individual ID | String identifier (unique with Family ID) |
| 3 | Paternal ID | Father's Individual ID, or `0` if unknown/founder |
| 4 | Maternal ID | Mother's Individual ID, or `0` if unknown/founder |
| 5 | Sex | `1` = male, `2` = female, `0`/other = unknown |
| 6 | Phenotype | `1` = unaffected, `2` = affected, `0`/`-9` = unknown |

**Notes:**
- Lines starting with `#` are comments
- Family + Individual ID must be globally unique
- GATK supports tags: `NO_FAMILY_ID`, `NO_PARENTS`, `NO_SEX`, `NO_PHENOTYPE` for missing fields
- The phenotype can also be a quantitative trait (GATK auto-detects based on values)

#### How Tools Model Family Relationships

**GEMINI:**
- PED file loaded at VCF import time, stored in `samples` table
- Genotype data stored as compressed arrays per variant
- Inheritance tools query genotypes with family structure context
- Supports extended pedigrees, not just trios
- Unknown phenotype samples do not affect inheritance tools by default

**seqr (Broad Institute):**
- Stores pedigrees with HPO phenotype terms per individual
- Supports thousands of families with standardized inheritance-based searches
- Family overview shows pedigree diagram, analysis status, analyst, load date
- Open source, web-based, used for >10,000 families at Broad CMG
- Ref: [seqr - Human Mutation](https://onlinelibrary.wiley.com/doi/10.1002/humu.24366)

**VarSeq (Golden Helix):**
- First-class pedigree support with prebuilt inheritance filters
- Project templates for trio analysis (ACMG Guidelines Trio Template)
- Supports extended pedigrees and CNV segregation analysis
- Checks all inheritance modes in parallel with proven parameter settings
- Ref: [VarSeq Family Workflows](https://www.goldenhelix.com/resources/webcasts/family-based-workflows-in-varseq-and-vsclinical/)

**Fabric Genomics (OPAL):**
- Links genes to conditions with mode of inheritance and penetrance
- ROH viewer for consanguinity detection (>1 MB regions)
- VAAST algorithm for causative variant/gene ranking
- De Novo filter: both parents must have no-ref-call (both alleles reference)

**OVAS (Open-source):**
- Offline, modular pipeline with 11+ filtering components
- Inheritance modeling: X-linked recessive, mosaicism, compound het
- Preserves VCF specification at each pipeline step
- Ref: [OVAS - BMC Bioinformatics](https://pmc.ncbi.nlm.nih.gov/articles/PMC5806474/)

---

### 1.3 Best Practices for Inheritance Filter Implementation

#### Genotype Quality Thresholds for De Novo Calls

**Recommended minimum thresholds:**
- **GQ >= 20** for all family members (most impactful single filter)
- **DP >= 10** for all family members
- **AB 0.2-0.8** for heterozygous calls in proband
- **AB < 0.02** for parental "reference" calls (catch mosaic parents)
- **Alt read count = 0** in parents for indels; **<= 1** for SNVs

**Advanced filtering:**
- Consensus calling across 2-3 callers (GATK HC, DeepTrio, GRAF) with force-calling achieves 98-99.4% precision
- Strand bias filters (both strands must support variant)
- Mapping quality filters (MQ >= 40)

#### Handling Missing/No-Call Genotypes

**VCF encoding:** Missing genotypes are represented as `./.` (diploid) or `.` (haploid).

**Strategies:**
1. **Conservative (default):** Treat no-call as "unknown" - exclude the variant from inheritance analysis. This prevents false positives but may miss true positives.
2. **Lenient:** Ignore no-call samples when evaluating inheritance. GEMINI's `--lenient` flag implements this.
3. **Depth-aware:** If depth is 0, treat as truly missing. If depth > 0 but genotype is no-call, the caller was uncertain - treat conservatively.
4. **GATK approach:** `--set-filtered-gt-to-nocall` converts filtered genotypes to `./.` so downstream tools handle them uniformly.

**Recommendation:** Default to conservative. Provide a "lenient" option that relaxes no-call handling for exploratory analysis.

#### Compound Het Detection Algorithm

**Recommended implementation (based on GEMINI/brentp/inheritance):**

```
function findCompoundHets(variants, family):
  1. Group all heterozygous variants by gene (for each affected)
  2. For each gene with >= 2 het variants in any affected:
     a. Generate all pairs of het variants
     b. For each pair (v1, v2):
        - ALL affected must be HET at both v1 and v2
        - NO unaffected can be HOM_ALT at either v1 or v2
        - If parents available:
          * Parent A must be HET at v1 and HOM_REF at v2 (or vice versa)
          * Parent B must be HET at v2 and HOM_REF at v1 (or vice versa)
          * This confirms trans configuration
        - If both parents are HET at BOTH sites: AMBIGUOUS (could be cis)
          * Attempt read-based phasing if BAM available
          * Otherwise flag as "unphased compound het candidate"
     c. Exclude pairs where both variants are low-impact intronic
  3. Return confirmed and candidate pairs
```

**Key considerations:**
- Gene definition matters: use canonical transcript or all transcripts?
- Splicing variants near exon boundaries should be included
- Consider gene panels and known disease genes for prioritization

#### Handling X-Linked Regions

**Implementation requirements:**
1. **Determine sex** of each sample (from PED file)
2. **Check chromosome:** If variant is on chrX (but NOT in PAR1/PAR2):
   - For males: expect hemizygous genotypes (0 or 1), not diploid
   - Some callers output 0/0 or 1/1 for males on chrX; normalize to hemizygous
3. **Apply X-linked rules** instead of autosomal rules
4. **PAR detection:** Check coordinates against known PAR boundaries; treat PAR variants as autosomal

**PAR boundaries (GRCh38):**
- PAR1: chrX:10,001-2,781,479
- PAR2: chrX:155,701,383-156,030,895

---

### 1.4 JSON/VCF Standards for Family Data

#### VCF Multi-Sample Format

VCF natively supports multiple samples per file. Family trios are commonly stored as multi-sample VCFs:

```
#CHROM  POS  ID  REF  ALT  QUAL  FILTER  INFO  FORMAT     proband    father     mother
chr1    1000 .   A    G    50    PASS    .     GT:GQ:DP   0/1:35:20  0/0:40:25  0/0:38:22
```

**Key FORMAT fields for inheritance analysis:**
- `GT` - Genotype (0/0, 0/1, 1/1, ./.)
- `GQ` - Genotype quality (Phred-scaled confidence)
- `DP` - Read depth
- `AD` - Allele depth (ref,alt read counts)
- `PL` - Phred-scaled genotype likelihoods

**Phasing notation:**
- `0/1` = unphased heterozygous
- `0|1` = phased: ref on haplotype 1, alt on haplotype 2
- `1|0` = phased: alt on haplotype 1, ref on haplotype 2

#### GA4GH Phenopackets (JSON/Protobuf)

The GA4GH Phenopacket Schema is the emerging standard for encoding clinical genomic data including family relationships.

**Family message structure:**
```json
{
  "id": "family-001",
  "proband": {
    "id": "proband-001",
    "subject": {
      "id": "patient-001",
      "sex": "MALE",
      "karyotypicSex": "XY"
    },
    "phenotypicFeatures": [
      {"type": {"id": "HP:0001250", "label": "Seizure"}}
    ]
  },
  "relatives": [
    {
      "id": "mother-001",
      "subject": {"id": "patient-002", "sex": "FEMALE"}
    }
  ],
  "pedigree": {
    "persons": [
      {
        "familyId": "FAM001",
        "individualId": "patient-001",
        "paternalId": "patient-003",
        "maternalId": "patient-002",
        "sex": "MALE",
        "affectedStatus": "AFFECTED"
      }
    ]
  }
}
```

**Key points:**
- Pedigree element uses a transformation of the PED format
- Supports YAML, JSON, binary protobuf, RDF, and SQL representations
- HPO terms for phenotype annotation
- GA4GH Pedigree Standard (in development) will support richer clinical pedigrees
- Ref: [GA4GH Phenopackets](https://advanced.onlinelibrary.wiley.com/doi/full/10.1002/ggn2.202200016)

---

## Topic 2: Tumor-Normal (Somatic) Analysis

### 2.1 Tumor-Normal Pair Relationship Modeling

#### Matched vs. Unmatched Normal

**Matched Tumor-Normal (Gold Standard):**
- Tumor and normal (germline) DNA from the same patient
- Normal typically from blood, buccal swab, or adjacent non-tumor tissue
- Comparison identifies true somatic variants: present in tumor only
- Eliminates ~1/3 of false positives that occur in tumor-only analysis
- Ref: [SOPHiA Genetics matched T/N](https://www.sophiagenetics.com/resource/matched-tumor-normal-sequencing-preferred-method-identifying-somatic-mutations-driving-tumorigenesis/)

**Tumor-Only (Unmatched):**
- Only tumor sample sequenced; no paired normal
- Must use population databases (gnomAD, ExAC) to filter common germline variants
- Computational approaches (SGZ, UNMASC) attempt to distinguish somatic vs germline
- Higher false positive rate; germline variants often misclassified as somatic
- VAF ~50% or ~100% suggests germline origin
- Ref: [UNMASC - NAR Cancer](https://academic.oup.com/narcancer/article/3/4/zcab040/6382329)

**Panel of Normals (PoN):**
- Collection of normal samples processed with the same sequencing pipeline
- Used to filter systematic artifacts and recurrent germline variants
- Recommended by GATK Mutect2 workflow as supplement to matched normal

#### Multiple Tumor Samples from Same Patient

**Use cases:**
- Primary tumor + metastasis
- Pre-treatment + post-treatment (resistance monitoring)
- Multiple biopsies from same tumor (heterogeneity assessment)

**Challenges:**
- Most tools process tumor-normal pairs independently
- Custom workflows exist for joint calling across multiple tumors (FreeBayesSomatic, Strelka2Pass)
- Critical lack of robust multi-sample somatic calling algorithms
- Current practice: call pairs separately, then combine/intersect results
- Ref: [Custom workflows for multiple tumors - Bioinformatics](https://academic.oup.com/bioinformatics/article/37/21/3916/6361543)

#### Data Model Considerations for Implementation

```
Patient
  |-- Normal Sample (germline reference)
  |-- Tumor Sample 1 (primary)
  |    |-- tumor_type: "primary"
  |    |-- tissue_site: "lung"
  |    |-- tumor_purity: 0.65
  |    |-- ploidy: 2.1
  |-- Tumor Sample 2 (metastasis)
       |-- tumor_type: "metastasis"
       |-- tissue_site: "liver"
       |-- tumor_purity: 0.45
       |-- ploidy: 3.2
```

---

### 2.2 Somatic Variant Filtering

#### Definition and Criteria for Somatic Variants

A somatic variant is a mutation acquired during the lifetime of an individual, present in tumor cells but not in the germline. Key distinction from GATK: "Somatic calling is NOT simply a difference between two callsets."

**Somatic callers make different assumptions than germline callers:**
- No explicit ploidy assumption (tumors have aneuploidy)
- Must detect low-frequency alleles (subclonal variants)
- No genotyping in the traditional sense
- Must model tumor purity and clonal architecture

#### Key Somatic Filters

**1. Variant Allele Frequency (VAF):**
- Minimum VAF threshold: typically 5% for clinical reporting (some assays go to 1-2%)
- Variants with < 5 supporting reads are typically considered likely false positives
- VAF ~50% or ~100% suggests germline origin (in matched analysis)
- Low VAF variants (< 5%) require orthogonal confirmation
- VAF interpretation depends on tumor purity: `True VAF = Observed VAF / tumor_purity`

**2. Presence in Normal:**
- For matched T/N: variant should be absent in normal (0 alt reads ideally)
- Allow very low alt reads in normal (1-2) due to sequencing error
- VAF in normal should be < 1% (artifact threshold)
- Higher normal VAF may indicate germline variant or clonal hematopoiesis

**3. Strand Bias:**
- Variant should be supported by reads on both strands
- Extreme strand bias (all reads from one strand) suggests artifact
- Fisher's exact test on strand counts is common metric

**4. Additional Filters:**
- Base quality: alt reads should have adequate base quality
- Mapping quality: reads supporting variant should map well
- Position in read: variants clustered at read ends are suspicious
- Clustered variants: multiple variants in close proximity may indicate alignment artifact
- Panel of normals: filter variants seen in unrelated normal samples

#### Somatic Databases

**COSMIC (Catalogue of Somatic Mutations in Cancer):**
- Expert-curated knowledgebase of somatic variants
- Data from >29,000 publications and large studies
- Includes mutation frequency by cancer type
- Cancer hotspot identification
- Ref: [COSMIC database - Nucleic Acids Research](https://academic.oup.com/nar/article/52/D1/D1210/7335750)

**ClinVar (Somatic):**
- Contains some somatic variant classifications
- Distinguishes germline vs somatic assertions

**OncoKB:**
- Precision oncology knowledge base (Memorial Sloan Kettering)
- Levels of evidence for actionable variants
- FDA-recognized companion diagnostic

**CIViC (Clinical Interpretation of Variants in Cancer):**
- Open-access knowledgebase
- Community-curated clinical evidence

#### AMP/ASCO/CAP Tier Classification (2017)

The four-tier system for somatic variant clinical significance:

| Tier | Category | Level | Description |
|------|----------|-------|-------------|
| **I** | Strong Clinical Significance | **A** | FDA-approved therapies or professional guidelines |
| **I** | Strong Clinical Significance | **B** | Well-powered studies with expert consensus |
| **II** | Potential Clinical Significance | **C** | FDA-approved therapies for different tumor types; investigational therapies in clinical trials |
| **II** | Potential Clinical Significance | **D** | Case reports, small studies, or preclinical data |
| **III** | Unknown Clinical Significance | - | Variants not observed in cancer databases; no convincing evidence |
| **IV** | Benign/Likely Benign | - | High population frequency; no cancer association |

**Ten evidence types for clinical significance assessment:**
1. FDA-approved therapies
2. Investigational therapies
3. Mutation type (gain-of-function, loss-of-function)
4. Variant allele fraction
5. Population databases
6. Germline databases
7. Somatic databases (COSMIC, etc.)
8. Computational algorithms
9. Pathway involvement
10. Publications

**References:**
- [AMP/ASCO/CAP 2017 Guidelines - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5707196/)
- [ClinGen/CGC/VICC Oncogenicity Standards - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9081216/)
- [GenomOncology AMP Guidelines Update](https://genomoncology.com/blog/somatic-variant-classification-a-welcome-update-to-the-amp-asco-cap-guidelines/)

---

### 2.3 Best Practices from Existing Tools

#### Franklin (Genoox)

- AI-based interpretation engine supporting oncology workflows
- Somatic Clinical Evidence tab shows AMP-based classification
- Lists therapeutic, diagnostic, prognostic, and predisposing evidences
- Cancer Hotspot Count filter for SNPs by amino acid position or exact change
- Automated germline and somatic classification
- Ref: [Franklin Somatic Interpretation](https://help.genoox.com/en/articles/4996685-franklin-somatic-variant-interpretation)

#### VarSome Clinical

- Somatic variant classifier based on AMP/ASCO/CAP guidelines
- Integrates COSMIC, OncoKB, CKB datasets
- Four-tier classification (Tier 1-4)
- Supports both germline and somatic workflows
- Ref: [VarSome Oncology](https://landing.varsome.com/oncology)

#### cBioPortal

- Open platform for cancer genomics data exploration
- **OncoPrint:** Compact visualization of genomic alterations (rows=genes, columns=patients)
- Integrates somatic mutations, CNAs, expression, methylation
- Patient View: condenses all molecular + clinical data per patient
- Mutation frequency histograms across cancer types
- Survival analysis, mutual exclusivity analysis
- Ref: [cBioPortal - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4160307/)

#### Tumor Mutational Burden (TMB)

**Definition:** Total number of somatic mutations per megabase (Mb) of interrogated genomic sequence.

**Calculation:**
- WES: `TMB = total somatic mutations / 38 Mb` (approximate exome size)
- Panel: `TMB = somatic mutations in panel / panel size in Mb`
- Typically count nonsynonymous SNVs + indels

**Thresholds:**
- TMB-High: generally >= 10 mutations/Mb (FDA-approved threshold for pembrolizumab)
- Varies by cancer type

**Clinical Relevance:**
- Predictive biomarker for immunotherapy response
- FDA recognized TMB-H as tumor-agnostic biomarker
- Ref: [TMB as predictive biomarker - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7710563/)

#### Microsatellite Instability (MSI)

**Definition:** Condition where microsatellite repeats acquire mutations due to defective DNA mismatch repair (MMR).

**Classification:**
- MSI-High (MSI-H): MSIsensor score >= 10
- MSI-Low (MSI-L) or Microsatellite Stable (MSS): score < 10

**Relationship to TMB:**
- MSI-H tumors often have high TMB, but not always
- Significant disparities exist between MSI and TMB classification
- Both are immunotherapy biomarkers but capture different biology
- Ref: [IDT - TMB & MSI](https://www.idtdna.com/pages/research-area/cancer/cancer-research/tumor-mutational-burden-(tmb)-microsatellite-instability-(msi))

---

## Topic 3: UI/UX Patterns

### 3.1 Family/Relationship Configuration UI

#### Pedigree Editor Interfaces

**pedigreejs (JavaScript Library):**
- SVG-based pedigree drawing using d3.js
- Interactive editor widget for adding/editing individuals
- Supports standard pedigree nomenclature (circles=female, squares=male, filled=affected)
- Configurable editor dialog for individual attributes
- Open source: [pedigreejs on GitHub](https://ccge-boadicea.github.io/pedigreejs/)

**QuickPed (Web Application):**
- Click-based pedigree creation
- Buttons to add relationships (parents, children, siblings)
- Toggle attributes: sex, affection status, twin status, ID labels
- Ref: [QuickPed](https://magnusdv.github.io/pedsuite/articles/web_only/quickped.html)

**genoDraw:**
- Graph-based three-step process for pedigree creation
- Compliant with standardized pedigree nomenclature
- Interactive and compatible with biomedical vocabularies
- Ref: [genoDraw - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7153108/)

**TrakGene:**
- Automated pedigree generation from family history data
- Commercial clinical-grade solution
- Ref: [TrakGene](https://www.trakgene.com)

#### Recommended UI Approach for VarLens

**Simple table-based approach (most practical for desktop app):**
```
Family Configuration
+------------------------------------------------------------------+
| Sample          | Relation  | Sex    | Affected | Father | Mother |
|-----------------|-----------|--------|----------|--------|--------|
| SampleA (VCF)   | Proband   | Male   | Yes      | SampleB| SampleC|
| SampleB (VCF)   | Father    | Male   | No       | -      | -      |
| SampleC (VCF)   | Mother    | Female | No       | -      | -      |
+------------------------------------------------------------------+
[+ Add Family Member]  [Import PED File]  [Validate]
```

**Visual pedigree display (optional, secondary):**
- Show standard pedigree symbols after configuration
- Filled shapes for affected, open for unaffected
- Lines connecting parent-child and spouse relationships
- Consider using pedigreejs for SVG rendering

---

### 3.2 Inheritance Filter Selection UI

#### How seqr Handles It

- Dropdown/checkbox selection of inheritance modes
- "Search" button applies selected inheritance filters
- Standard options: de novo, recessive (homozygous + compound het), dominant, X-linked
- Customizable search parameters
- Results show inheritance annotation per variant

#### How VarSeq Handles It

- Project templates with prebuilt inheritance filter chains
- Parallel evaluation of all inheritance modes
- Each variant annotated with matching inheritance pattern
- Filter panel shows counts per mode

#### Recommended UI for VarLens

**Inheritance filter panel (shown when family is configured):**
```
Inheritance Filters
+--------------------------------------------------+
| [ ] De Novo                                       |
|     Min GQ: [20]  Min Depth: [10]  Max Parent AB: [0.02] |
|                                                   |
| [ ] Autosomal Recessive                           |
|     [x] Homozygous    [x] Compound Heterozygous  |
|                                                   |
| [ ] Autosomal Dominant                            |
|     [x] Complete penetrance                       |
|     [ ] Incomplete penetrance                     |
|                                                   |
| [ ] X-Linked                                      |
|     [x] Recessive    [ ] Dominant    [ ] De novo  |
|                                                   |
| Missing genotypes: [Exclude variant] v            |
|                                                   |
| [Apply Filters]                                   |
+--------------------------------------------------+
```

**Inheritance annotation column in variant table:**
- Show matched inheritance mode(s) per variant
- Color-coded badges: "De Novo", "AR-Hom", "AR-CompHet", "AD", "XLR"
- Tooltip shows family genotypes for that variant

---

### 3.3 Tumor-Normal Pair Assignment UI

#### Recommended UI for VarLens

**Sample relationship configuration:**
```
Somatic Analysis Configuration
+----------------------------------------------------------+
| Patient: [Patient Name / ID]                              |
|                                                           |
| Normal Sample:                                            |
|   [SampleA (blood)] v   Source: [Blood] v                |
|                                                           |
| Tumor Samples:                                            |
|   1. [SampleB (tumor)] v  Type: [Primary] v              |
|      Purity: [0.65]  Ploidy: [2.1]                       |
|   [+ Add Tumor Sample]                                    |
|                                                           |
| Analysis Mode:                                            |
|   (o) Matched Tumor-Normal                                |
|   ( ) Tumor-Only (no matched normal)                      |
|                                                           |
| Somatic Filters:                                          |
|   Min Tumor VAF: [5%]    Max Normal VAF: [1%]            |
|   Min Tumor Alt Reads: [5]                                |
|   [ ] Filter by Panel of Normals                          |
+----------------------------------------------------------+
```

---

### 3.4 Segregation Analysis Results Display

#### How Tools Display Segregation Results

**Genomics England Tiering:**
- Variants annotated with segregation pattern label: "DeNovo", "SimpleRecessive", "CompoundHeterozygous", "Monoallelic"
- Penetrance mode indicated (complete/incomplete)
- Report Events link variant to gene, mode of inheritance, and tier

**seqr:**
- Family pedigree shown alongside variant list
- Genotype for each family member displayed per variant
- Color-coded by zygosity (het, hom, ref, no-call)
- Inheritance tag per variant

**GEMINI:**
- Text output with inheritance tool name as context
- Reports gene, variant, and family member genotypes

#### Recommended Display for VarLens

**Variant table with family genotypes:**
```
+------+--------+-----+------+---------+----------+----------+----------+
| Gene | Variant| Type| Impact| Inherit | Proband  | Father   | Mother   |
+------+--------+-----+------+---------+----------+----------+----------+
| SCN1A| c.1234 | SNV | HIGH | De Novo | 0/1 (35) | 0/0 (42) | 0/0 (38) |
| CFTR | c.1521 | Del | HIGH | AR-CHet | 0/1 (28) | 0/1 (30) | 0/0 (35) |
| CFTR | c.3846 | SNV | HIGH | AR-CHet | 0/1 (32) | 0/0 (40) | 0/1 (33) |
| GJB2 | c.35   | Ins | HIGH | AR-Hom  | 1/1 (25) | 0/1 (28) | 0/1 (30) |
+------+--------+-----+------+---------+----------+----------+----------+
```
*Numbers in parentheses = GQ values*

**Genotype cell color coding:**
- `0/0` (Hom Ref): light grey background
- `0/1` (Het): light blue background
- `1/1` (Hom Alt): deep blue background
- `./.` (No Call): yellow/warning background

**Compound het grouping:**
- Visually group compound het pairs (shared background color or bracket)
- Show gene name spanning both rows
- Indicate trans phasing confidence: "Phased by parents", "Phased by reads", "Unphased candidate"

**Expanded row detail:**
- Pedigree diagram with genotypes overlaid on each individual
- Read depth and allele balance for each family member
- Link to IGV or read visualization

---

## Summary of Key Implementation Recommendations

### For Trio/Family Analysis

1. **Data model:** Use PED-compatible fields (familyId, individualId, paternalId, maternalId, sex, affectedStatus)
2. **Store genotypes per sample** with GT, GQ, DP, AD fields from VCF
3. **Implement five core inheritance filters:** de novo, AR homozygous, AR compound het, AD, X-linked
4. **Default quality thresholds:** GQ >= 20, DP >= 10, AB 0.2-0.8
5. **Handle missing genotypes** conservatively by default with lenient option
6. **Support PED file import** for batch family configuration
7. **Compound het phasing:** Use parental genotypes when available; flag unphased candidates
8. **X-linked awareness:** Detect chrX, exclude PARs, handle hemizygous males

### For Somatic Analysis

1. **Model tumor-normal relationships** per patient with metadata (purity, ploidy, tissue type)
2. **Implement VAF-based filtering** with configurable thresholds (default 5% tumor, 1% normal)
3. **Support both matched T/N and tumor-only modes**
4. **Integrate somatic databases:** COSMIC for hotspot annotation, ClinVar somatic, OncoKB
5. **AMP/ASCO/CAP tier classification** for clinical significance
6. **TMB calculation** as a summary metric per sample
7. **Consider MSI status** integration for immunotherapy relevance

### For UI/UX

1. **Table-based family configuration** with optional visual pedigree
2. **Inheritance filter panel** with mode checkboxes and quality parameter controls
3. **Genotype display per family member** in variant table with color coding
4. **Inheritance mode badges** on each variant row
5. **Compound het visual grouping** with phasing confidence indicators
6. **Somatic configuration panel** with sample role assignment and filter thresholds
