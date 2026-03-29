# Trio/Duo & Tumor-Normal Analysis: Research Report

**Date:** 2026-03-09
**Scope:** Feature research for VarLens — family-based inheritance filtering and somatic variant analysis

---

## 1. Executive Summary

VarLens currently models each case as an independent single-sample entity with no concept of family relationships or tumor-normal pairing. To support trio/duo and somatic analysis, we need:

1. **A relationship/pedigree data model** linking cases together as family members or tumor-normal pairs
2. **Multi-sample genotype storage** (GT, GQ, DP, AD per sample per variant)
3. **Inheritance filter engine** (de novo, compound het, homozygous recessive, X-linked, autosomal dominant)
4. **Somatic filter engine** (VAF-based, presence-in-normal, strand bias)
5. **UI for configuring relationships** and applying inheritance/somatic filters

Two entry points for relationship data:
- **Import-time:** JSON/VCF already contains multi-sample genotypes and pedigree info
- **Manual assignment:** User links existing cases and sets roles (proband/mother/father, tumor/normal)

---

## 2. Current VarLens Architecture (Relevant Parts)

### 2.1 Data Model Gaps

| What Exists | What's Missing |
|-------------|----------------|
| `cases` table (one sample = one case) | Family/analysis group linking cases together |
| `case_metadata` with `affected_status`, `sex` | Paternal/maternal ID, proband flag, sample role |
| `gt_num` string field ("0/1", "1/1") | Per-sample genotype fields: GQ, DP, AD, AB |
| Cohort groups (flat grouping) | Hierarchical family structure with inheritance semantics |
| Variant filters (AF, CADD, consequence, etc.) | Inheritance-mode filters, somatic filters |

### 2.2 Key Files That Will Need Changes

| Layer | File | Change |
|-------|------|--------|
| Schema | `src/main/database/schema.ts` | New tables: `analysis_groups`, `analysis_group_members`, genotype quality fields |
| Migrations | `src/main/database/migrations.ts` | Migration v12+ for new schema |
| Types | `src/shared/types/` | New interfaces for family/somatic relationships |
| Import | `src/main/import/strategies/` | Multi-sample import support, PED file parsing |
| Filters | `src/shared/types/filters.ts` | Inheritance mode filter options |
| Query | `src/main/database/VariantRepository.ts` | Inheritance-aware variant queries |
| IPC | `src/main/ipc/handlers/` | New handlers for relationship CRUD |
| Statistics | `src/main/statistics/` | New inheritance filter engine |

---

## 3. Inheritance Analysis: Domain Research

### 3.1 The Five Core Inheritance Filters

#### 3.1.1 De Novo

A variant present in the proband but absent from both parents. Arises as a new germline mutation.

**Genotype rules:**

| Member | Requirement |
|--------|------------|
| Proband | Heterozygous (0/1) |
| Father | Homozygous reference (0/0) |
| Mother | Homozygous reference (0/0) |

**Quality thresholds (consensus from literature):**

| Parameter | Proband | Parents |
|-----------|---------|---------|
| Genotype Quality (GQ) | >= 20 | >= 20 |
| Read Depth (DP) | >= 10 | >= 10 |
| Allele Balance (AB) | 0.20 - 0.80 | < 0.02 |
| Alt Read Count | >= 3 | 0 (indels), <= 1 (SNVs) |

- GQ >= 20 alone removes >80% of false de novo calls while retaining >99% of true positives
- Consensus calling across multiple callers achieves 98-99.4% precision
- ACMG criterion PS2 (strong pathogenicity evidence) applies to confirmed de novo variants

**Sources:** [Life Science Alliance 2025](https://www.life-science-alliance.org/content/8/6/e202403039), [npj Genomic Medicine 2021](https://www.nature.com/articles/s41525-021-00227-3)

#### 3.1.2 Autosomal Recessive — Homozygous

Proband is homozygous for the alternate allele; both parents are carriers.

| Member | Requirement |
|--------|------------|
| Affected proband | Homozygous alt (1/1) |
| Unaffected parents | Heterozygous carriers (0/1) each |
| Unaffected siblings | NOT homozygous alt |

- Regions of Homozygosity (ROH) > 1 MB may indicate consanguinity or uniparental disomy
- GEMINI: all affected must be HOM_ALT; unaffected cannot be HOM_ALT; parents must be HET

#### 3.1.3 Autosomal Recessive — Compound Heterozygous

Two different heterozygous variants in the same gene on different chromosomes (in *trans*), together disrupting both alleles.

**Detection algorithm:**

```
1. Group all heterozygous variants by gene (for each affected)
2. For each gene with >= 2 het variants in any affected:
   a. Generate all pairs of het variants
   b. For each pair (v1, v2):
      - ALL affected must be HET at both v1 and v2
      - NO unaffected can be HOM_ALT at either site
      - If parents available (trio):
        * One parent HET at v1, HOM_REF at v2
        * Other parent HET at v2, HOM_REF at v1
        → Confirms trans configuration
      - If both parents HET at BOTH sites: AMBIGUOUS (cis vs trans)
        → Flag as "unphased compound het candidate"
   c. Exclude pairs where both variants are low-impact intronic
3. Return confirmed pairs + unphased candidates
```

**Phasing hierarchy:** trio-based (best) > read-based > population-based (least reliable for rare variants)

**Sources:** [SmartPhase — PLOS Comp Bio](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007613), [CompoundHetVIP](https://pmc.ncbi.nlm.nih.gov/articles/PMC7905494/)

#### 3.1.4 Autosomal Dominant

A single heterozygous variant sufficient to cause disease.

| Member | Requirement (complete penetrance) |
|--------|----------------------------------|
| Affected | Heterozygous (0/1) |
| Unaffected | Homozygous reference (0/0) |

**Penetrance modes:**
- **Complete:** variant present in ALL affected, ABSENT from ALL unaffected
- **Incomplete (lenient):** variant present in ALL affected; unaffected MAY carry it

GEMINI implements this via `--lenient` flag. Genomics England uses separate "complete" and "incomplete" analysis modes.

#### 3.1.5 X-Linked

Special handling for variants on chromosome X (outside pseudoautosomal regions).

**X-Linked Recessive:**

| Member | Requirement |
|--------|------------|
| Affected male | Hemizygous alt (1 or 1/1 depending on caller) |
| Carrier mother | Heterozygous (0/1), typically unaffected |
| Unaffected father | Hemizygous ref (0 or 0/0) |

**X-Linked De Novo:**
- Variant in affected male, absent from both parents

**Implementation requirements:**
- Determine sex from PED/metadata
- Detect chrX variants (exclude PAR regions)
- Normalize hemizygous genotypes (some callers output 0/1 or 1/1 for males on chrX)
- PAR boundaries (GRCh38): PAR1 chrX:10,001-2,781,479; PAR2 chrX:155,701,383-156,030,895

**Sources:** [PMC 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9840679/), [OVAS — BMC Bioinformatics](https://pmc.ncbi.nlm.nih.gov/articles/PMC5806474/)

### 3.2 Missing/No-Call Genotype Handling

VCF encodes missing genotypes as `./.` (diploid) or `.` (haploid).

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| **Conservative** (default) | Exclude variant from inheritance analysis if any family member has no-call | Prevents false positives |
| **Lenient** | Ignore no-call samples when evaluating inheritance | Exploratory analysis |
| **Depth-aware** | DP=0 → truly missing; DP>0 + no-call → caller uncertain → conservative | Most nuanced |

**Recommendation:** Default to conservative with a user-togglable "lenient" option.

---

## 4. Somatic Analysis: Domain Research

### 4.1 Tumor-Normal Relationship Model

**Matched Tumor-Normal (gold standard):**
- Tumor and normal DNA from the same patient
- Normal typically from blood, buccal swab, or adjacent tissue
- Comparison identifies true somatic variants (present in tumor only)
- Eliminates ~1/3 of false positives vs tumor-only analysis

**Tumor-Only:**
- No paired normal; must use population databases (gnomAD) to filter germline
- Higher false positive rate
- VAF ~50% or ~100% suggests germline origin

**Multi-tumor per patient:** primary + metastasis, pre/post-treatment. Current best practice: call pairs separately, then combine results.

**Data model:**
```
Patient/AnalysisGroup
  |-- Normal Sample (germline reference)
  |-- Tumor Sample 1 (primary)
  |    |-- tumor_type, tissue_site, purity, ploidy
  |-- Tumor Sample 2 (metastasis, optional)
       |-- tumor_type, tissue_site, purity, ploidy
```

### 4.2 Somatic Variant Filters

#### Variant Allele Frequency (VAF)
- **Minimum tumor VAF:** 5% for clinical reporting (1-2% for research/liquid biopsy)
- **Maximum normal VAF:** < 1% (higher suggests germline or clonal hematopoiesis)
- **True VAF correction:** `True VAF = Observed VAF / tumor_purity`
- Variants with < 5 supporting alt reads are likely false positives

#### Presence in Normal
- For matched T/N: variant should have 0 alt reads in normal (allow 1-2 for sequencing error)
- Normal VAF > 1% → likely germline

#### Strand Bias
- Variant must be supported by reads on both strands
- Extreme strand bias suggests sequencing artifact
- Fisher's exact test on strand counts is the standard metric

#### Additional Filters
- Base quality of alt reads
- Mapping quality
- Position-in-read clustering (variants at read ends are suspicious)
- Panel of Normals filtering (recurrent artifacts in unrelated normals)

### 4.3 AMP/ASCO/CAP Somatic Tier Classification

The standard four-tier system for clinical somatic variant significance:

| Tier | Category | Evidence Level |
|------|----------|---------------|
| **I** | Strong Clinical Significance | A: FDA-approved therapy / guidelines; B: Well-powered studies + expert consensus |
| **II** | Potential Clinical Significance | C: FDA-approved for different tumor type / clinical trials; D: Case reports / preclinical |
| **III** | Unknown Clinical Significance | Not in cancer databases; no convincing evidence |
| **IV** | Benign / Likely Benign | High population frequency; no cancer association |

**Source:** [AMP/ASCO/CAP 2017 Guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC5707196/)

### 4.4 Somatic Databases & Metrics

| Resource | Use |
|----------|-----|
| **COSMIC** | Somatic mutation catalog, hotspot identification, cancer-type frequency |
| **OncoKB** | Actionable variant levels of evidence (FDA-recognized) |
| **CIViC** | Community-curated clinical evidence for variants in cancer |
| **ClinVar (somatic)** | Somatic assertions distinguished from germline |

**Tumor Mutational Burden (TMB):**
- `TMB = somatic mutations / exome size in Mb` (typically ~38 Mb for WES)
- TMB-High >= 10 mut/Mb (FDA-approved threshold for pembrolizumab)
- Count nonsynonymous SNVs + indels

**Microsatellite Instability (MSI):**
- MSI-High: MSIsensor score >= 10
- Often correlates with high TMB but captures different biology
- Both are immunotherapy biomarkers

---

## 5. Pedigree & Relationship Data Standards

### 5.1 PED File Format (PLINK/GATK Standard)

Six mandatory tab-delimited columns:

```
#Family_ID  Individual_ID  Paternal_ID  Maternal_ID  Sex  Phenotype
FAM001      proband        father       mother       1    2
FAM001      father         0            0            1    1
FAM001      mother         0            0            2    1
```

| Column | Values |
|--------|--------|
| Family ID | String identifier |
| Individual ID | Unique within family |
| Paternal ID | Father's ID, or `0` if unknown/founder |
| Maternal ID | Mother's ID, or `0` if unknown/founder |
| Sex | `1`=male, `2`=female, `0`=unknown |
| Phenotype | `1`=unaffected, `2`=affected, `0`/`-9`=unknown |

### 5.2 GA4GH Phenopackets (JSON)

Emerging standard for clinical genomic data. The `pedigree` element maps directly from PED format:

```json
{
  "pedigree": {
    "persons": [
      {
        "familyId": "FAM001",
        "individualId": "proband",
        "paternalId": "father",
        "maternalId": "mother",
        "sex": "MALE",
        "affectedStatus": "AFFECTED"
      }
    ]
  }
}
```

### 5.3 How Existing Tools Model Relationships

| Tool | Approach |
|------|----------|
| **GEMINI** | PED file at VCF import; stored in `samples` table; inheritance tools query with family context |
| **seqr** | Pedigrees + HPO terms per individual; supports extended pedigrees; web-based, >10K families at Broad |
| **VarSeq** | First-class pedigree support; prebuilt inheritance filter templates; parallel mode evaluation |
| **Fabric Genomics** | Links genes to conditions with MOI and penetrance; ROH viewer for consanguinity |

---

## 6. Proposed Data Model for VarLens

### 6.1 Unified Analysis Group Concept

A single `analysis_groups` table supports both family and tumor-normal use cases:

```sql
-- Groups cases into families or tumor-normal pairs
CREATE TABLE analysis_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_type TEXT NOT NULL CHECK(group_type IN ('family', 'tumor_normal')),
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- Links cases to groups with role metadata
CREATE TABLE analysis_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES analysis_groups(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  -- Family fields (group_type = 'family')
  family_role TEXT CHECK(family_role IN ('proband', 'mother', 'father', 'sibling', 'other')),
  paternal_case_id INTEGER REFERENCES cases(id),
  maternal_case_id INTEGER REFERENCES cases(id),

  -- Tumor-normal fields (group_type = 'tumor_normal')
  sample_role TEXT CHECK(sample_role IN ('normal', 'tumor')),
  tumor_type TEXT,          -- 'primary', 'metastasis', 'recurrence'
  tissue_site TEXT,
  tumor_purity REAL,        -- 0.0 - 1.0
  ploidy REAL,

  UNIQUE(group_id, case_id)
);
```

This reuses the existing `case_metadata.affected_status` and `case_metadata.sex` fields rather than duplicating them.

### 6.2 Genotype Quality Storage

Currently variants store only `gt_num` (e.g., "0/1"). For inheritance analysis we need per-sample quality metrics. Options:

**Option A: Add columns to existing `variants` table**
- Add `gq`, `dp`, `ad_ref`, `ad_alt`, `ab` columns
- Simple, works for single-sample cases
- For multi-sample analysis, we query across cases by matching chr:pos:ref:alt

**Option B: New `sample_genotypes` table**
- Stores per-sample genotype data for each variant position
- Better normalized, supports multi-sample queries directly

**Recommendation:** Option A for now (add quality columns to `variants`). Multi-sample queries join variants across cases by genomic position. This avoids a major schema restructure and leverages the existing one-case-per-sample model.

```sql
-- New columns on variants table
ALTER TABLE variants ADD COLUMN gq REAL;     -- Genotype quality
ALTER TABLE variants ADD COLUMN dp INTEGER;  -- Read depth
ALTER TABLE variants ADD COLUMN ad_ref INTEGER; -- Reference allele depth
ALTER TABLE variants ADD COLUMN ad_alt INTEGER; -- Alternate allele depth
ALTER TABLE variants ADD COLUMN ab REAL;     -- Allele balance (ad_alt / dp)
ALTER TABLE variants ADD COLUMN vaf REAL;    -- Variant allele frequency (for somatic)
```

### 6.3 Inheritance Filter Results

```sql
-- Cache inheritance filter results per analysis group
CREATE TABLE inheritance_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES analysis_groups(id) ON DELETE CASCADE,
  variant_chr TEXT NOT NULL,
  variant_pos INTEGER NOT NULL,
  variant_ref TEXT NOT NULL,
  variant_alt TEXT NOT NULL,
  gene_symbol TEXT,
  inheritance_mode TEXT NOT NULL CHECK(inheritance_mode IN (
    'de_novo', 'autosomal_recessive_hom', 'compound_het',
    'autosomal_dominant', 'x_linked_recessive', 'x_linked_dominant',
    'x_linked_de_novo', 'somatic'
  )),
  compound_het_pair_id INTEGER, -- links compound het pairs
  phasing_method TEXT,          -- 'trio', 'reads', 'population', 'unphased'
  confidence TEXT,              -- 'high', 'medium', 'low'
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

---

## 7. UI/UX Recommendations

### 7.1 Relationship Configuration

**Table-based approach** (primary — fits VarLens Vuetify patterns):

```
Analysis Group: [Family Smith]  Type: [Family ▼]

┌──────────────┬───────────┬────────┬──────────┬────────┬────────┐
│ Sample       │ Role      │ Sex    │ Affected │ Father │ Mother │
├──────────────┼───────────┼────────┼──────────┼────────┼────────┤
│ Case-001     │ Proband   │ Male   │ Yes      │ Case-002│ Case-003│
│ Case-002     │ Father    │ Male   │ No       │ —      │ —      │
│ Case-003     │ Mother    │ Female │ No       │ —      │ —      │
└──────────────┴───────────┴────────┴──────────┴────────┴────────┘
[+ Add Member]  [Import PED File]  [Validate Pedigree]
```

For tumor-normal:

```
Analysis Group: [Patient X]  Type: [Tumor-Normal ▼]

┌──────────────┬────────┬───────────┬──────────┬─────────┬────────┐
│ Sample       │ Role   │ Type      │ Tissue   │ Purity  │ Ploidy │
├──────────────┼────────┼───────────┼──────────┼─────────┼────────┤
│ Case-010     │ Normal │ —         │ Blood    │ —       │ —      │
│ Case-011     │ Tumor  │ Primary   │ Lung     │ 0.65    │ 2.1    │
└──────────────┴────────┴───────────┴──────────┴─────────┴────────┘
[+ Add Tumor Sample]
```

### 7.2 Inheritance Filter Panel

Shown when a family analysis group is active:

```
Inheritance Filters
┌─────────────────────────────────────────────────────┐
│ ☐ De Novo                                           │
│   Min GQ: [20]  Min DP: [10]  Max Parent AB: [0.02] │
│                                                      │
│ ☐ Autosomal Recessive                               │
│   ☑ Homozygous    ☑ Compound Heterozygous           │
│                                                      │
│ ☐ Autosomal Dominant                                │
│   ☑ Complete penetrance  ☐ Incomplete penetrance    │
│                                                      │
│ ☐ X-Linked                                          │
│   ☑ Recessive  ☐ Dominant  ☐ De Novo               │
│                                                      │
│ Missing genotypes: [Exclude variant ▼]              │
│                                                      │
│ [Run Analysis]                                       │
└─────────────────────────────────────────────────────┘
```

### 7.3 Variant Table Enhancements

**Family member genotype columns:**
```
┌───────┬────────┬────────┬──────────┬──────────┬──────────┬──────────┐
│ Gene  │ Variant│ Impact │ Inherit  │ Proband  │ Father   │ Mother   │
├───────┼────────┼────────┼──────────┼──────────┼──────────┼──────────┤
│ SCN1A │ c.1234 │ HIGH   │ De Novo  │ 0/1 (35) │ 0/0 (42) │ 0/0 (38) │
│ CFTR  │ c.1521 │ HIGH   │ CompHet  │ 0/1 (28) │ 0/1 (30) │ 0/0 (35) │
│ CFTR  │ c.3846 │ HIGH   │ CompHet  │ 0/1 (32) │ 0/0 (40) │ 0/1 (33) │
│ GJB2  │ c.35   │ HIGH   │ AR-Hom   │ 1/1 (25) │ 0/1 (28) │ 0/1 (30) │
└───────┴────────┴────────┴──────────┴──────────┴──────────┴──────────┘
```

**Genotype cell color coding:**
- `0/0` → light grey
- `0/1` → light blue
- `1/1` → deep blue
- `./.` → yellow/warning

**Inheritance mode badges:** color-coded chips — "De Novo" (red), "AR-Hom" (purple), "CompHet" (orange), "AD" (green), "XLR" (teal), "Somatic" (dark red)

**Compound het visual grouping:** bracket or shared background spanning the pair, with phasing confidence label.

### 7.4 Somatic Filter Panel

Shown when a tumor-normal analysis group is active:

```
Somatic Filters
┌───────────────────────────────────────────────┐
│ Min Tumor VAF:      [5%]                      │
│ Max Normal VAF:     [1%]                      │
│ Min Tumor Alt Reads:[5]                       │
│ ☐ Require both-strand support                 │
│                                               │
│ Classification: AMP/ASCO/CAP Tier             │
│ TMB: — mut/Mb  (calculated after filtering)   │
│                                               │
│ [Run Somatic Analysis]                        │
└───────────────────────────────────────────────┘
```

---

## 8. Import Considerations

### 8.1 JSON Import with Relationship Data

The Object format already supports a `samples` map with multiple sample IDs. We can extend it:

```json
{
  "metadata": {
    "analysis_type": "family",
    "family_id": "FAM001"
  },
  "pedigree": [
    { "sample_id": "proband", "father": "father", "mother": "mother", "sex": "male", "affected": true },
    { "sample_id": "father", "sex": "male", "affected": false },
    { "sample_id": "mother", "sex": "female", "affected": false }
  ],
  "samples": {
    "proband": {
      "variants": [
        { "chr": "1", "pos": 12345, "ref": "A", "alt": "T", "gt": "0/1", "gq": 35, "dp": 20, "ad_ref": 10, "ad_alt": 10 }
      ]
    },
    "father": { "variants": [...] },
    "mother": { "variants": [...] }
  }
}
```

For tumor-normal:

```json
{
  "metadata": {
    "analysis_type": "tumor_normal",
    "patient_id": "PATIENT-001"
  },
  "sample_relationships": {
    "normal": "blood_sample",
    "tumors": [
      { "sample_id": "tumor_biopsy", "type": "primary", "tissue": "lung", "purity": 0.65 }
    ]
  },
  "samples": {
    "blood_sample": { "variants": [...] },
    "tumor_biopsy": { "variants": [...] }
  }
}
```

### 8.2 PED File Import

Standalone PED file import to configure relationships between already-imported cases:
1. Parse PED file (6 tab-delimited columns)
2. Match Individual IDs to existing cases (by case name or external ID)
3. Create analysis group + members
4. Validate: all referenced parents exist, sex consistency, no circular references

### 8.3 Multi-Sample VCF Considerations

Currently VarLens doesn't parse VCF directly (uses JSON). If VCF import is added later:
- Parse FORMAT/sample columns for GT, GQ, DP, AD per sample
- Create one case per sample
- Auto-create analysis group from VCF header sample names + accompanying PED file

---

## 9. Implementation Priority & Phasing

### Phase 1: Data Model & Relationship Management
- New database tables (analysis_groups, analysis_group_members)
- Add genotype quality columns to variants
- IPC handlers for CRUD
- UI for creating/editing analysis groups
- PED file import

### Phase 2: Inheritance Filter Engine
- De novo filter
- Autosomal recessive (homozygous)
- Autosomal dominant
- X-linked (recessive + de novo)
- Compound heterozygous detection
- Results caching and display

### Phase 3: Somatic Analysis
- Somatic variant filter (VAF, presence in normal)
- Tumor-normal pair configuration UI
- TMB calculation
- AMP tier classification (future: database integration)

### Phase 4: Enhanced Import
- Extend JSON format for multi-sample + pedigree data
- Auto-create analysis groups on import
- Multi-sample VCF support (future)

---

## 10. Reference Tools & Literature

### Tools Studied
| Tool | Key Feature | Reference |
|------|------------|-----------|
| **GEMINI** | PED-based inheritance tools, comp het detection | [GEMINI docs](https://gemini.readthedocs.io/) |
| **seqr** | Web-based family analysis, >10K families | [Human Mutation 2022](https://onlinelibrary.wiley.com/doi/10.1002/humu.24366) |
| **VarSeq** | Prebuilt trio templates, parallel inheritance modes | [Golden Helix](https://www.goldenhelix.com/) |
| **Fabric Genomics** | MOI linking, ROH viewer, VAAST ranking | [fabricgenomics.com](https://fabricgenomics.com/) |
| **Franklin** | AI interpretation, AMP somatic classification | [Genoox](https://franklin.genoox.com/) |
| **VarSome** | AMP/ASCO/CAP tier classifier | [VarSome](https://varsome.com/) |
| **cBioPortal** | OncoPrint, multi-omic cancer genomics | [PMC 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4160307/) |

### Key Papers
- De novo quality thresholds: [Life Science Alliance 2025](https://www.life-science-alliance.org/content/8/6/e202403039)
- Effective variant filtering: [npj Genomic Medicine 2021](https://www.nature.com/articles/s41525-021-00227-3)
- Compound het phasing (SmartPhase): [PLOS Comp Bio 2020](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007613)
- AMP/ASCO/CAP somatic classification: [JMD 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5707196/)
- GA4GH Phenopackets: [Amer J Human Genetics 2022](https://advanced.onlinelibrary.wiley.com/doi/full/10.1002/ggn2.202200016)
- TMB as biomarker: [PMC 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7710563/)
- Matched tumor-normal: [SOPHiA Genetics](https://www.sophiagenetics.com/resource/matched-tumor-normal-sequencing-preferred-method-identifying-somatic-mutations-driving-tumorigenesis/)
