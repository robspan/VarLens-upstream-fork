# VCF Import — Design Spec

**Date:** 2026-03-30
**Issue:** [#42](https://github.com/berntpopp/VarLens/issues/42) — VCF file import with direct parsing and VEP annotation
**Prerequisite:** `.planning/docs/VCF-IMPORT-AND-ANNOTATION-PLAN.md` (research), `.planning/specs/2026-03-29-giab-trio-test-data-design.md` (test data)

---

## 1. Goal

Add native VCF (`.vcf`, `.vcf.gz`) import to VarLens that:

1. Parses standard VCF 4.x files with streaming line-by-line processing
2. Auto-detects and extracts VEP CSQ and SnpEff ANN annotations
3. Discovers all INFO fields from the header, maps known fields to typed columns, stores the rest as JSON
4. Supports multi-sample VCFs with user-selectable sample import (each sample = one case)
5. Decomposes multi-allelic sites into biallelic records respecting VCF Number semantics
6. Extracts per-sample genotype quality fields (GT, GQ, DP, AD) for future trio analysis
7. Auto-detects genome build from VCF header with user override
8. Uses a configurable, data-driven field mapping registry extensible for future formats (CNV, STR, SV)
9. Integrates seamlessly with the existing import wizard UX

**Out of scope:** VEP REST API annotation, trio/inheritance filtering (issue #50), CNV/STR/SV-specific parsing.

---

## 2. Architecture Overview

### 2.1 New Files

```
src/main/import/vcf/
├── VcfStrategy.ts              # ImportStrategy implementation for VCF
├── vcf-header-parser.ts        # Parse ## meta lines and #CHROM header
├── vcf-line-parser.ts          # Parse variant data lines → raw records
├── vcf-annotation-parser.ts    # Extract CSQ/ANN → VarLens fields
├── vcf-genotype-parser.ts      # Extract per-sample GT/GQ/DP/AD
├── vcf-allele-splitter.ts      # Multi-allelic → biallelic decomposition
├── VcfMapper.ts                # Assemble VarLens Variant + Transcripts
└── info-field-registry.ts      # Configurable INFO → column mapping
```

### 2.2 Modified Files

| File | Change |
|------|--------|
| `src/main/import/format-detection.ts` | Add VCF detection (first line `##fileformat=VCFv4`) |
| `src/main/import/strategies/StrategyRegistry.ts` | Register VcfStrategy |
| `src/main/import/ImportService.ts` | Accept `.vcf`/`.vcf.gz`, pass sample selection |
| `src/main/import/types.ts` | Add VCF-specific import options (selected samples, genome build override) |
| `src/main/workers/import-worker.ts` | Handle multi-sample → multiple cases |
| `src/main/database/schema.ts` | Add new columns |
| `src/main/database/migrations.ts` | Migration for new columns |
| `src/main/database/VariantRepository.ts` | Insert new columns in batch insert |
| `src/main/ipc/handlers/import.ts` | New channel for VCF preview |
| `src/shared/types/database-schema.ts` | Update Kysely schema types |
| `src/renderer/src/components/import/ImportWizard.vue` | Add VCF preview step |

### 2.3 Data Flow

```
.vcf/.vcf.gz file
  → createDecompressedStream (if .gz, reuse existing)
  → vcf-header-parser
      → extract samples, INFO defs, FORMAT defs, contigs
      → detect annotation type (CSQ / ANN / none)
      → detect genome build (delegates to GenomeBuildDetector)
      → build field mapping from info-field-registry
  → line-by-line text streaming (readline, not JSON parser)
  → vcf-line-parser (tab-split → VcfRawRecord)
  → vcf-allele-splitter (multi-allelic → biallelic, Number-aware)
  → vcf-annotation-parser (CSQ or ANN → gene, consequence, transcripts)
  → vcf-genotype-parser (GT/GQ/DP/AD for selected sample)
  → VcfMapper (assemble Variant + TranscriptInsertRow[] + info_json)
  → BatchAccumulator (reuse existing, flush to DB)
```

**Key difference from JSON strategies:** VCF is line-oriented text, not JSON. We stream line-by-line — no JSON parser needed. The existing `pipeline()` and `BatchAccumulator` patterns are reused.

---

## 3. VCF Header Parser

**File:** `src/main/import/vcf/vcf-header-parser.ts`

Reads all `##` meta lines and the `#CHROM` header line, producing:

```typescript
interface VcfHeader {
  fileformat: string                          // "VCFv4.2"
  samples: string[]                           // ["HG005", "HG006", "HG007"]
  infoDefs: Map<string, InfoFieldDef>         // INFO field definitions
  formatDefs: Map<string, FormatFieldDef>     // FORMAT field definitions
  contigs: Map<string, ContigDef>             // contig name → length
  annotationType: 'csq' | 'ann' | 'none'     // auto-detected
  csqFields?: string[]                        // CSQ Format subfield names
  genomeBuild?: string                        // detected from ##reference/contigs
}

interface InfoFieldDef {
  id: string
  number: string       // "0", "1", "A", "R", "G", "."
  type: 'Integer' | 'Float' | 'Flag' | 'Character' | 'String'
  description: string
}

interface FormatFieldDef {
  id: string
  number: string
  type: 'Integer' | 'Float' | 'Character' | 'String'
  description: string
}
```

**CSQ format extraction:** VEP's CSQ header contains `Format: Allele|Consequence|IMPACT|SYMBOL|...` in its Description. We parse this to build a field-name-to-index mapping, so extraction works regardless of VEP version or flags.

**ANN format:** Fixed 16-field order (SnpEff standard). We validate the ANN INFO definition exists but don't need to parse field names from the header.

**Genome build detection:** Delegates to existing `GenomeBuildDetector` with parsed contig/reference info.

The parser stops at the first non-`#` line. It returns the header plus the first data line (already read), so the line parser doesn't miss it.

---

## 4. Line Parser and Raw Record

**File:** `src/main/import/vcf/vcf-line-parser.ts`

Parses one VCF data line into a raw record via string splitting:

```typescript
interface VcfRawRecord {
  chrom: string
  pos: number
  id: string | null             // rs ID or null if "."
  ref: string
  alt: string[]                 // split on comma: ["G", "T"]
  qual: number | null           // null if "."
  filter: string                // "PASS" or semicolon-separated filter names
  info: Map<string, string>     // raw INFO key-value pairs (unparsed values)
  format: string[]              // FORMAT field order: ["GT", "GQ", "DP", "AD"]
  samples: Map<string, string[]> // sample name → values matching format order
}
```

Implementation: tab-split the line (9 fixed columns + N sample columns), comma-split ALT, semicolon-split INFO into key=value pairs, colon-split FORMAT and sample columns. No complex parsing — pure string operations.

Sample names come from the VcfHeader (columns 10+ of the `#CHROM` line).

---

## 5. Multi-Allelic Splitter

**File:** `src/main/import/vcf/vcf-allele-splitter.ts`

Takes a `VcfRawRecord` with multiple ALT alleles and yields one record per ALT allele. Single-allelic records pass through unchanged.

**Splitting rules by VCF Number:**

| Number | Meaning | Split behavior |
|--------|---------|---------------|
| `0` | Flag | Copy to all split records |
| `1` | Single value | Copy to all split records |
| `A` | Per-ALT allele | Select the value at the current ALT index |
| `R` | Per-allele (REF + ALTs) | Keep REF value (index 0) + current ALT value |
| `G` | Per-genotype (colex order) | Select genotypes involving REF + current ALT only |
| `.` | Variable / unknown | Copy as-is (CSQ/ANN handled by annotation parser's Allele subfield matching) |

**Genotype adjustment:** For ALT allele at index N:
- Remap GT so allele N becomes 1, REF stays 0, all others become `.` (missing)
- Example: `0/2` with allele index 2 → `0/1`; `1/2` with allele index 1 → `1/.`
- AD: select `[ref_count, alt_N_count]` from the full AD array

The splitter uses the `VcfHeader.infoDefs` to determine the Number for each INFO field, and `VcfHeader.formatDefs` for FORMAT fields.

---

## 6. Annotation Parser (CSQ / ANN)

**File:** `src/main/import/vcf/vcf-annotation-parser.ts`

### 6.1 VEP CSQ Extraction

1. Read the field order from `VcfHeader.csqFields` (parsed from header Description)
2. Split CSQ value by `,` → multiple transcript annotations
3. Split each annotation by `|` → individual fields
4. Map fields by index to names from header
5. Filter by Allele subfield to match the current ALT allele (post-splitting)
6. Select "best" transcript: MANE Select > Canonical > highest IMPACT > first protein_coding
7. Copy selected transcript's values to main variant fields
8. Return all transcripts as `TranscriptInsertRow[]`

**VarLens field mapping from CSQ:**

| CSQ Field | VarLens Column |
|-----------|---------------|
| `SYMBOL` | `gene_symbol` |
| `Consequence` | `consequence` |
| `IMPACT` | `func` |
| `Feature` | `transcript` |
| `HGVSc` | `cdna` |
| `HGVSp` | `aa_change` |
| `gnomADe_AF` or `gnomADg_AF` | `gnomad_af` |
| `CADD_PHRED` | `cadd` |
| `ClinVar_CLNSIG` | `clinvar` |
| `CANONICAL` | `is_canonical` (transcript) |
| `MANE_SELECT` | `is_mane_select` (transcript) |
| `BIOTYPE` | (transcript biotype) |

### 6.2 SnpEff ANN Extraction

1. ANN has a fixed 16-field pipe-delimited format (same order always)
2. Split ANN value by `,` → multiple annotations
3. Split each by `|` → 16 fields by position
4. Filter by Allele subfield (index 0) to match current ALT allele
5. Same transcript selection logic as CSQ
6. Return all transcripts as `TranscriptInsertRow[]`

**VarLens field mapping from ANN:**

| ANN Field (index) | VarLens Column |
|-------------------|---------------|
| Gene_Name (3) | `gene_symbol` |
| Annotation (1) | `consequence` |
| Annotation_Impact (2) | `func` |
| Feature_ID (6) | `transcript` |
| HGVS.c (9) | `cdna` |
| HGVS.p (10) | `aa_change` |
| Transcript_BioType (7) | (transcript biotype) |

SnpSift-added standalone INFO fields (`CLINVAR_CLNSIG`, `dbNSFP_CADD_phred`, etc.) are handled separately by the INFO field registry (Section 8), not by the ANN parser.

### 6.3 Unified Interface

```typescript
interface AnnotationResult {
  // Selected transcript values (copied to main variant row)
  geneSymbol: string | null
  consequence: string | null
  impact: string | null          // HIGH/MODERATE/LOW/MODIFIER
  transcript: string | null
  cdna: string | null
  aaChange: string | null
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null

  // All transcripts for variant_transcripts table
  transcripts: TranscriptInsertRow[]
}

function parseAnnotation(
  info: Map<string, string>,
  header: VcfHeader,
  altAllele: string
): AnnotationResult
```

Auto-detects CSQ vs ANN from header and dispatches to the right parser. If neither present, returns all nulls (unannotated VCF).

---

## 7. Genotype Parser

**File:** `src/main/import/vcf/vcf-genotype-parser.ts`

Extracts per-sample genotype fields using the FORMAT field order:

```typescript
interface GenotypeData {
  gt: string              // "0/1", "1/1", "./.", "1" (hemizygous)
  gq: number | null       // Genotype quality
  dp: number | null       // Read depth
  adRef: number | null    // Reference allele depth
  adAlt: number | null    // Alternate allele depth
  ab: number | null       // Allele balance: adAlt / (adRef + adAlt)
}

function parseGenotype(
  sampleValues: string[],
  formatFields: string[]
): GenotypeData
```

- Uses FORMAT field order to index into sample values (e.g., if FORMAT is `GT:GQ:DP:AD`, then index 0=GT, 1=GQ, etc.)
- Missing values (`.`) → null
- AD field is comma-separated: `ref,alt1[,alt2,...]`. After allele splitting, we take `[0]` for ref and `[1]` for alt.
- AB is computed: `adAlt / (adRef + adAlt)`, null if either is null or sum is 0
- Hemizygous GT on chrX: single value (`0` or `1`) is valid

---

## 8. Configurable INFO Field Registry

**File:** `src/main/import/vcf/info-field-registry.ts`

A data-driven mapping from VCF INFO field IDs to VarLens variant columns. Designed to be extensible for any VCF-based format (SNV, CNV, STR, SV) without code changes.

```typescript
interface InfoFieldMapping {
  /** One or more INFO field IDs that map to this column (first match wins) */
  infoIds: string[]
  /** Target column on the variants table */
  column: string
  /** How to parse the raw string value */
  type: 'float' | 'integer' | 'string'
  /** Optional: which CSQ subfield also maps here (for deduplication) */
  csqField?: string
  /** Human-readable description */
  description: string
}

// Default registry — covers common annotation pipelines
const DEFAULT_INFO_FIELD_MAPPINGS: InfoFieldMapping[] = [
  {
    infoIds: ['gnomADe_AF', 'gnomADg_AF', 'gnomAD_AF', 'AF'],
    column: 'gnomad_af',
    type: 'float',
    csqField: 'gnomADe_AF',
    description: 'gnomAD population allele frequency',
  },
  {
    infoIds: ['CADD_phred', 'dbNSFP_CADD_phred', 'CADD_PHRED'],
    column: 'cadd',
    type: 'float',
    csqField: 'CADD_PHRED',
    description: 'CADD phred-scaled score',
  },
  {
    infoIds: ['CLNSIG', 'CLINVAR_CLNSIG', 'ClinVar_CLNSIG'],
    column: 'clinvar',
    type: 'string',
    csqField: 'ClinVar_CLNSIG',
    description: 'ClinVar clinical significance',
  },
  // Extensible: add CNV/STR/SV mappings here without code changes
  // { infoIds: ['SVTYPE'], column: 'sv_type', type: 'string', description: '...' },
  // { infoIds: ['SVLEN'], column: 'sv_length', type: 'integer', description: '...' },
]
```

**Resolution logic:**

1. For each INFO key in the variant, check if it matches any `infoIds` in the registry
2. If matched → parse the value according to `type` and assign to `column`
3. If a CSQ/ANN annotation already populated that column (e.g., `gnomad_af` from CSQ), the annotation value takes priority (it's allele-specific). Standalone INFO values are only used as fallback.
4. If not matched → add to `info_json` object

**Priority:** CSQ/ANN annotation values > standalone INFO fields (registry) > info_json fallback

This means the same VCF can have gnomAD AF in both CSQ and a standalone INFO field, and we consistently pick the CSQ value (which is allele-specific after splitting).

---

## 9. VCF Mapper

**File:** `src/main/import/vcf/VcfMapper.ts`

Orchestrates all parsers to transform a stream of `VcfRawRecord`s into VarLens `Variant` + `TranscriptInsertRow[]` objects:

```typescript
class VcfMapper extends Transform {
  constructor(
    private header: VcfHeader,
    private sampleName: string,      // which sample to extract genotype for
    private registry: InfoFieldMapping[],
  )

  _transform(record: VcfRawRecord, encoding, callback):
    // 1. Split multi-allelic (vcf-allele-splitter)
    // 2. For each biallelic record:
    //    a. Parse annotation (vcf-annotation-parser) → gene, consequence, transcripts
    //    b. Parse genotype for selected sample (vcf-genotype-parser) → GT/GQ/DP/AD
    //    c. Apply INFO field registry → map known fields to columns
    //    d. Collect unmapped INFO fields → info_json
    //    e. Assemble Variant object + TranscriptInsertRow[]
    //    f. Push downstream (to BatchAccumulator)
}
```

**Skip logic:** Variants where the selected sample has no ALT allele (GT is `0/0` or `./.`) are skipped — they represent reference-homozygous or no-call sites for that sample.

---

## 10. Database Schema Changes

**Migration:** Next version after current (single migration adding all columns).

### 10.1 New Columns on `variants`

```sql
ALTER TABLE variants ADD COLUMN gq REAL;            -- Genotype quality
ALTER TABLE variants ADD COLUMN dp INTEGER;         -- Read depth
ALTER TABLE variants ADD COLUMN ad_ref INTEGER;     -- Reference allele depth
ALTER TABLE variants ADD COLUMN ad_alt INTEGER;     -- Alternate allele depth
ALTER TABLE variants ADD COLUMN ab REAL;            -- Allele balance
ALTER TABLE variants ADD COLUMN filter TEXT;         -- VCF FILTER (PASS or names)
ALTER TABLE variants ADD COLUMN info_json TEXT;      -- Unmapped INFO fields as JSON
ALTER TABLE variants ADD COLUMN source_format TEXT;  -- 'vcf', 'columnar', 'object', 'simple'
```

All columns are nullable with no default. Existing JSON-imported variants get NULL in all new columns — this is correct (the data doesn't exist for those formats).

### 10.2 New Columns on `cases`

```sql
ALTER TABLE cases ADD COLUMN source_format TEXT;     -- 'vcf', 'json'
ALTER TABLE cases ADD COLUMN sample_name TEXT;        -- VCF sample name (e.g., "HG005")
```

### 10.3 New Index

```sql
CREATE INDEX idx_variants_info_json ON variants(case_id)
  WHERE info_json IS NOT NULL;
```

A partial index for efficient queries on VCF-imported variants. Individual JSON fields can be queried via `json_extract(info_json, '$.fieldName')`.

### 10.4 Impact on Existing Code

- **JSON importers:** Continue working unchanged. New columns receive NULL.
- **VariantRepository.insertBatch:** Extended to include new columns in INSERT statement (nulls for unset fields).
- **VariantRepository.getVariants:** No changes needed — new columns are not in any existing WHERE clauses.
- **UI variant table:** New columns available for display but not shown by default until explicitly added.

---

## 11. Import Service Changes

### 11.1 Format Detection

**File:** `src/main/import/format-detection.ts`

Add VCF detection before JSON detection:

```typescript
async function detectFormat(filePath: string): Promise<FormatInfo> {
  // 1. Check file extension: .vcf or .vcf.gz
  // 2. Read first line (decompress if .gz)
  // 3. If starts with "##fileformat=VCFv4" → format: 'vcf'
  // 4. Otherwise fall through to existing JSON detection
}
```

### 11.2 VCF Strategy

**File:** `src/main/import/vcf/VcfStrategy.ts`

```typescript
class VcfStrategy implements ImportStrategy {
  readonly formatId = 'vcf'

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'vcf'
  }

  async import(filePath, options, context): Promise<ImportResult> {
    // 1. Parse header → VcfHeader
    // 2. Build INFO field registry mapping
    // 3. For each selected sample:
    //    a. Create case (name from sample_name or user override)
    //    b. Stream: lines → parse → split → annotate → genotype → map → batch → DB
    //    c. Track progress per sample
    // 4. Return combined ImportResult
  }
}
```

### 11.3 Import Options Extension

```typescript
interface VcfImportOptions extends ImportOptions {
  selectedSamples: string[]      // which samples to import (from preview)
  genomeBuild?: string           // user override of detected build
}
```

### 11.4 VCF Preview IPC Channel

New IPC channel for the import dialog to get VCF metadata without full import:

```typescript
// Channel: import:vcfPreview
// Request: (filePath: string)
// Response:
interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number   // from line count, fast
  annotationType: 'csq' | 'ann' | 'none'
  detectedGenomeBuild: string | null
  infoFields: Array<{
    id: string
    type: string
    number: string
    description: string
    mapsToColumn: string | null  // which VarLens column, or null if → info_json
  }>
}
```

---

## 12. Import Wizard UX Changes

### 12.1 Modified Flow

```
Step 1: Source Selection (existing)
  ├─ JSON file → Step 3 (existing review)
  └─ VCF file  → Step 2 (new VCF preview)

Step 2: VCF Preview (new, VCF only)
  ├─ File info: filename, size, genome build (editable dropdown)
  ├─ Annotation type badge: "VEP (CSQ)" / "SnpEff (ANN)" / "Unannotated"
  ├─ INFO fields: collapsible list (field name, type, → column or info_json)
  ├─ Sample selection: checkboxes, all checked by default
  └─ Case naming: auto from sample names, editable text fields

Step 3: Review (existing, reused)
  └─ Summary: N samples, estimated variants, genome build, annotation type

Step 4: Progress (existing, reused)
  └─ Per-sample progress bars if multi-sample
```

### 12.2 VCF Preview Component

New component `VcfPreviewStep.vue`:

- Calls `import:vcfPreview` on mount to get VCF metadata
- Genome build: `v-select` dropdown pre-filled with detected value, editable
- Sample checkboxes: `v-checkbox` per sample, all checked by default
- Case naming: `v-text-field` per selected sample, pre-filled with sample name
- INFO field list: `v-expansion-panels` showing field discovery results
- Annotation type: `v-chip` badge (green for CSQ/ANN, grey for none)

---

## 13. Multi-Sample Import Flow

When a multi-sample VCF is imported with N samples selected:

1. **Preview** shows all sample names with checkboxes
2. User selects samples (default: all) and optionally renames cases
3. Import creates N cases, each with:
   - `case.sample_name` = VCF sample name
   - `case.source_format` = 'vcf'
   - `case.genome_build` = detected or overridden build
4. For each sample, the pipeline streams through the entire file once:
   - Parses genotype for that sample only
   - Skips variants where sample GT is `0/0` or `./.`
   - Inserts variants with that sample's genotype data
5. Progress tracks per-sample completion

**Optimization:** For multi-sample VCFs, we could read the file once and dispatch variants to multiple case pipelines simultaneously. However, for v1 we do N sequential passes — simpler, and the files in scope (chr22 region, ~2K variants) are small. Optimization can come later if needed for genome-scale VCFs.

---

## 14. Testing Strategy

### 14.1 Unit Tests

| Module | Test file | Test data | Key assertions |
|--------|-----------|-----------|----------------|
| vcf-header-parser | `vcf-header-parser.test.ts` | `synthetic-unit-test.vcf` | Samples, INFO/FORMAT defs, CSQ field order, ANN detection, genome build |
| vcf-line-parser | `vcf-line-parser.test.ts` | `synthetic-unit-test.vcf` | All 18 lines parsed correctly, tab/comma/semicolon splitting |
| vcf-annotation-parser | `vcf-annotation-parser.test.ts` | `synthetic-unit-test.vcf` | CSQ multi-transcript selection, ANN 16-field extraction, empty CSQ, SnpSift fields |
| vcf-genotype-parser | `vcf-genotype-parser.test.ts` | `synthetic-unit-test.vcf` | GT/GQ/DP/AD parsing, missing values, hemizygous chrX, AB computation |
| vcf-allele-splitter | `vcf-allele-splitter.test.ts` | `synthetic-unit-test.vcf` | Multi-allelic → biallelic, GT remapping, AD selection, Number=A/R splitting |
| VcfMapper | `vcf-mapper.test.ts` | `synthetic-unit-test.vcf` | End-to-end transform, skip ref-hom, info_json assembly |
| info-field-registry | `info-field-registry.test.ts` | Inline data | Known field mapping, fallback to info_json, priority order |
| format-detection | Extend existing test | `synthetic-unit-test.vcf` | Detects VCF format, doesn't break JSON detection |

### 14.2 Integration Tests

| Test | Test data | Validates |
|------|-----------|-----------|
| Single-sample import | `single-sample.vcf.gz` | File → DB end-to-end, correct variant count, source_format set |
| VEP-annotated import | `trio-region.vep.vcf.gz` | CSQ parsed, gene_symbol/consequence/transcript populated correctly |
| SnpEff-annotated import | `trio-region.snpeff.vcf.gz` | ANN parsed, CLINVAR_ fields mapped, unmapped fields in info_json |
| Multi-sample import | `trio-region.vcf.gz` | 3 cases created, correct sample_name, per-sample variant counts |
| Edge cases | `edge-cases.vcf.gz` | Multi-allelic split, missing GT, indels, genotype patterns |
| Unannotated import | `trio-region.vcf.gz` (raw) | Core fields only, info_json empty or minimal |
| Schema migration | — | New columns exist, existing data has NULL in new columns |
| Format detection | All test VCFs + JSON fixtures | VCF detected for .vcf/.vcf.gz, JSON still works |

### 14.3 Test Data

All test data already committed in `tests/test-data/vcf/`:

| File | Purpose |
|------|---------|
| `synthetic-unit-test.vcf` | Hand-crafted edge cases (18 variants, CSQ+ANN, chrX, multi-allelic) |
| `trio-region.vcf.gz` | Real GIAB trio, ~2K variants, unannotated |
| `trio-region.vep.vcf.gz` | Same region, VEP CSQ annotations |
| `trio-region.snpeff.vcf.gz` | Same region, SnpEff ANN + ClinVar annotations |
| `single-sample.vcf.gz` | HG005 only |
| `edge-cases.vcf.gz` | Cherry-picked inheritance patterns |
| `chinese_trio.ped` | Pedigree (for future trio analysis) |

---

## 15. Implementation Phases

The implementation should proceed in this order, each phase producing testable, committable work:

1. **Schema migration + types** — New DB columns, updated Kysely types, migration
2. **VCF parser core** — Header parser, line parser, genotype parser (unit-tested against synthetic VCF)
3. **Allele splitter** — Multi-allelic decomposition with Number-aware splitting
4. **Annotation parser** — CSQ + ANN extraction and transcript selection
5. **INFO field registry** — Configurable mapping, info_json assembly
6. **VcfMapper + VcfStrategy** — Full transform pipeline, strategy registration
7. **Format detection** — VCF detection in existing format-detection.ts
8. **Import worker integration** — Multi-sample handling, progress tracking
9. **IPC + VCF preview** — New preview channel, VcfPreviewResult
10. **Import wizard UI** — VcfPreviewStep component, sample selection, genome build override

---

## 16. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Large VCF files (WGS ~5M variants) may be slow with N sequential passes | v1 targets panel/exome VCFs; optimize to single-pass multi-sample later |
| VCF spec edge cases (mixed ploidy, structural variants) | Graceful handling — skip unparseable lines with warning, don't crash |
| INFO field type mismatches (header says Integer, value is ".") | Parse with fallback — if parsing fails, store raw string in info_json |
| CSQ/ANN field order varies across VEP/SnpEff versions | CSQ: parsed from header (version-independent). ANN: fixed spec, validate field count |
| Migration breaks existing databases | All new columns nullable, no defaults, no constraints — zero impact on existing data |
| info_json bloat for heavily-annotated VCFs | Partial index only on non-null rows; user can exclude fields in future UI |

---

## 17. Success Criteria

- [ ] `.vcf` and `.vcf.gz` files import successfully via the existing import wizard
- [ ] VEP CSQ annotations extracted and visible in variant table (gene, consequence, scores)
- [ ] SnpEff ANN annotations extracted similarly
- [ ] Multi-sample VCF creates one case per selected sample with correct genotype data
- [ ] Multi-allelic sites decomposed into biallelic records
- [ ] Genotype quality fields (GQ, DP, AD, AB) populated for VCF imports
- [ ] Unmapped INFO fields accessible via info_json
- [ ] Genome build auto-detected with user override in import dialog
- [ ] All existing JSON imports continue working unchanged
- [ ] All unit + integration tests pass against GIAB test data
- [ ] Import of trio-region.vep.vcf.gz (~2K variants) completes in < 5 seconds
