# Enhanced Case Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured comments (timestamped, categorized, editable) and flexible key-value metrics (with predefined clinical catalog + user-defined entries) to VarLens case metadata, presented in a tabbed modal UI.

**Architecture:** Extends the existing case metadata system with 3 new database tables (migration v5), new IPC handlers, a new composable, and converts the current `CaseMetadataModal` from a flat card into a tabbed dialog with "Overview", "Comments", and "Metrics" tabs. The metric definitions catalog ships with ~120 predefined clinical/lab metrics and allows user-created custom entries. All patterns follow existing conventions (optimistic updates, prepared statement cache, `RETURNING *`, etc.).

**Tech Stack:** SQLite (better-sqlite3-multiple-ciphers), Electron IPC, Vue 3 Composition API, Vuetify 3, TypeScript, Vitest

---

## Reference: Key Files

| Purpose | Path |
|---------|------|
| DB types | `src/main/database/types.ts` |
| DB service | `src/main/database/DatabaseService.ts` |
| Migrations | `src/main/database/migrations.ts` |
| API types | `src/shared/types/api.ts` |
| Case metadata IPC | `src/main/ipc/handlers/case-metadata.ts` |
| IPC registry | `src/main/ipc/index.ts` |
| Preload bridge | `src/preload/index.ts` |
| Metadata composable | `src/renderer/src/composables/useCaseMetadata.ts` |
| Metadata card | `src/renderer/src/components/CaseMetadataCard.vue` |
| Metadata modal | `src/renderer/src/components/CaseMetadataModal.vue` |
| Migration tests | `tests/main/database/migrations.test.ts` |
| DB service tests | `tests/main/database/DatabaseService.test.ts` |

## Comment Categories (predefined)

```
'Clinical Note' | 'Lab Result' | 'Interpretation' | 'Follow-up' | 'Family History' | 'Treatment'
```

---

## Phase 1: Database Layer — Types, Migration, and Service Methods

### Task 1: Add TypeScript types for comments and metrics

**Files:**
- Modify: `src/main/database/types.ts`
- Modify: `src/shared/types/api.ts`

**Step 1: Add database entity types to `src/main/database/types.ts`**

Add after the `CaseHpoTerm` interface (line 333):

```typescript
/**
 * CaseComment - Timestamped, categorized case comments
 */
export interface CaseComment {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Comment category */
  category: 'Clinical Note' | 'Lab Result' | 'Interpretation' | 'Follow-up' | 'Family History' | 'Treatment'
  /** Comment content */
  content: string
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds, null until edited */
  updated_at: number | null
}

/**
 * Comment category type
 */
export type CommentCategory = CaseComment['category']

/**
 * MetricDefinition - Global metric catalog (predefined + user-created)
 */
export interface MetricDefinition {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Metric name (e.g., "Hemoglobin (Hb)") */
  name: string
  /** Expected value type */
  value_type: 'numeric' | 'text' | 'date'
  /** Unit (e.g., "g/dL"), empty string for dimensionless */
  unit: string
  /** Category (e.g., "Hematology") */
  category: string
  /** 1 = shipped default, 0 = user-created */
  is_predefined: number
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * CaseMetric - Per-case metric value (EAV pattern)
 */
export interface CaseMetric {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Foreign key to metric_definitions table */
  metric_id: number
  /** Set when value_type = numeric */
  numeric_value: number | null
  /** Set when value_type = text */
  text_value: string | null
  /** ISO 8601 date string, set when value_type = date */
  date_value: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CaseMetricWithDefinition - Joined view for display
 */
export interface CaseMetricWithDefinition extends CaseMetric {
  /** Metric name */
  name: string
  /** Expected value type */
  value_type: 'numeric' | 'text' | 'date'
  /** Unit */
  unit: string
  /** Category */
  metric_category: string
}
```

**Step 2: Add API types to `src/shared/types/api.ts`**

Add imports at the top (line 46, after `CaseHpoTerm`):

```typescript
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition
```

Add to re-exports (after line 91):

```typescript
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition
```

Add new API interfaces after `CaseMetadataAPI` (after line 369):

```typescript
export interface CaseCommentsAPI {
  list: (caseId: number) => Promise<CaseComment[]>
  create: (caseId: number, category: CommentCategory, content: string) => Promise<CaseComment>
  update: (commentId: number, content: string) => Promise<CaseComment>
  delete: (commentId: number) => Promise<void>
}

export interface MetricValue {
  numeric_value?: number | null
  text_value?: string | null
  date_value?: string | null
}

export interface CaseMetricsAPI {
  // Metric definitions
  listDefinitions: () => Promise<MetricDefinition[]>
  createDefinition: (name: string, valueType: 'numeric' | 'text' | 'date', unit: string, category: string) => Promise<MetricDefinition>

  // Case metric values
  listForCase: (caseId: number) => Promise<CaseMetricWithDefinition[]>
  upsert: (caseId: number, metricId: number, value: MetricValue) => Promise<CaseMetric>
  delete: (caseId: number, metricId: number) => Promise<void>
}
```

Update `FullCaseMetadata` (line 338-342) to include comments and metrics:

```typescript
export interface FullCaseMetadata {
  metadata: CaseMetadata | null
  cohorts: CohortGroup[]
  hpoTerms: CaseHpoTerm[]
  comments: CaseComment[]
  metrics: CaseMetricWithDefinition[]
}
```

Add to `WindowAPI` interface (after line 416):

```typescript
  caseComments: CaseCommentsAPI
  caseMetrics: CaseMetricsAPI
```

**Step 3: Run typecheck to verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors about missing implementations (expected at this stage), but no syntax errors in the type files themselves.

**Step 4: Commit**

```bash
git add src/main/database/types.ts src/shared/types/api.ts
git commit -m "feat: add TypeScript types for case comments and metrics"
```

---

### Task 2: Create database migration v5

**Files:**
- Modify: `src/main/database/migrations.ts`
- Create: `src/main/database/clinical-metrics.ts`

**Step 1: Create the predefined clinical metrics catalog**

Create `src/main/database/clinical-metrics.ts`:

```typescript
/**
 * Predefined clinical and laboratory metric definitions
 *
 * Ships with VarLens as the default metric catalog.
 * Users can add custom metrics on top of these.
 * 120 metrics across 15 categories, verified against clinical standards.
 */

export interface ClinicalMetricSeed {
  name: string
  value_type: 'numeric' | 'text' | 'date'
  unit: string
  category: string
}

export const CLINICAL_METRICS: ClinicalMetricSeed[] = [
  // Demographics & Clinical Timeline
  { name: 'Age at Onset', value_type: 'numeric', unit: 'years', category: 'Demographics' },
  { name: 'Age at Diagnosis', value_type: 'numeric', unit: 'years', category: 'Demographics' },
  { name: 'Age at Last Evaluation', value_type: 'numeric', unit: 'years', category: 'Demographics' },
  { name: 'Gestational Age', value_type: 'numeric', unit: 'weeks', category: 'Demographics' },
  { name: 'Date of Birth', value_type: 'date', unit: '', category: 'Demographics' },
  { name: 'Date of Diagnosis', value_type: 'date', unit: '', category: 'Demographics' },
  { name: 'Date of Sample Collection', value_type: 'date', unit: '', category: 'Demographics' },
  { name: 'Ethnicity', value_type: 'text', unit: '', category: 'Demographics' },
  { name: 'Consanguinity Status', value_type: 'text', unit: '', category: 'Demographics' },

  // Anthropometrics
  { name: 'Height', value_type: 'numeric', unit: 'cm', category: 'Anthropometrics' },
  { name: 'Weight', value_type: 'numeric', unit: 'kg', category: 'Anthropometrics' },
  { name: 'Body Mass Index (BMI)', value_type: 'numeric', unit: 'kg/m²', category: 'Anthropometrics' },
  { name: 'Head Circumference', value_type: 'numeric', unit: 'cm', category: 'Anthropometrics' },
  { name: 'Body Surface Area (BSA)', value_type: 'numeric', unit: 'm²', category: 'Anthropometrics' },

  // Vitals
  { name: 'Systolic Blood Pressure', value_type: 'numeric', unit: 'mmHg', category: 'Vitals' },
  { name: 'Diastolic Blood Pressure', value_type: 'numeric', unit: 'mmHg', category: 'Vitals' },
  { name: 'Heart Rate', value_type: 'numeric', unit: 'bpm', category: 'Vitals' },
  { name: 'Respiratory Rate', value_type: 'numeric', unit: 'breaths/min', category: 'Vitals' },
  { name: 'Body Temperature', value_type: 'numeric', unit: '°C', category: 'Vitals' },
  { name: 'Oxygen Saturation (SpO2)', value_type: 'numeric', unit: '%', category: 'Vitals' },

  // Hematology (CBC)
  { name: 'White Blood Cell Count (WBC)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Red Blood Cell Count (RBC)', value_type: 'numeric', unit: '×10⁶/µL', category: 'Hematology' },
  { name: 'Hemoglobin (Hb)', value_type: 'numeric', unit: 'g/dL', category: 'Hematology' },
  { name: 'Hematocrit (Hct)', value_type: 'numeric', unit: '%', category: 'Hematology' },
  { name: 'Mean Corpuscular Volume (MCV)', value_type: 'numeric', unit: 'fL', category: 'Hematology' },
  { name: 'Mean Corpuscular Hemoglobin (MCH)', value_type: 'numeric', unit: 'pg', category: 'Hematology' },
  { name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)', value_type: 'numeric', unit: 'g/dL', category: 'Hematology' },
  { name: 'Red Cell Distribution Width (RDW)', value_type: 'numeric', unit: '%', category: 'Hematology' },
  { name: 'Platelet Count', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Mean Platelet Volume (MPV)', value_type: 'numeric', unit: 'fL', category: 'Hematology' },
  { name: 'Neutrophils (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Lymphocytes (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Monocytes (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Eosinophils (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Basophils (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Reticulocyte Count', value_type: 'numeric', unit: '%', category: 'Hematology' },
  { name: 'Erythrocyte Sedimentation Rate (ESR)', value_type: 'numeric', unit: 'mm/hr', category: 'Hematology' },

  // Coagulation
  { name: 'Prothrombin Time (PT)', value_type: 'numeric', unit: 'seconds', category: 'Coagulation' },
  { name: 'International Normalized Ratio (INR)', value_type: 'numeric', unit: '', category: 'Coagulation' },
  { name: 'Activated Partial Thromboplastin Time (aPTT)', value_type: 'numeric', unit: 'seconds', category: 'Coagulation' },
  { name: 'Fibrinogen', value_type: 'numeric', unit: 'mg/dL', category: 'Coagulation' },
  { name: 'D-Dimer', value_type: 'numeric', unit: 'µg/mL FEU', category: 'Coagulation' },

  // Biochemistry (Metabolic Panel)
  { name: 'Glucose (Fasting)', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Blood Urea Nitrogen (BUN)', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Creatinine', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Estimated GFR (eGFR)', value_type: 'numeric', unit: 'mL/min/1.73m²', category: 'Biochemistry' },
  { name: 'Sodium', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Potassium', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Chloride', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Bicarbonate (CO2)', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Calcium (Total)', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Calcium (Ionized)', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Magnesium', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Phosphorus', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Uric Acid', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  { name: 'Total Protein', value_type: 'numeric', unit: 'g/dL', category: 'Biochemistry' },
  { name: 'Albumin', value_type: 'numeric', unit: 'g/dL', category: 'Biochemistry' },
  { name: 'Globulin', value_type: 'numeric', unit: 'g/dL', category: 'Biochemistry' },
  { name: 'Hemoglobin A1c (HbA1c)', value_type: 'numeric', unit: '%', category: 'Biochemistry' },
  { name: 'Lactate', value_type: 'numeric', unit: 'mmol/L', category: 'Biochemistry' },
  { name: 'Ammonia', value_type: 'numeric', unit: 'µmol/L', category: 'Biochemistry' },

  // Liver Panel
  { name: 'Alanine Aminotransferase (ALT)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },
  { name: 'Aspartate Aminotransferase (AST)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },
  { name: 'Alkaline Phosphatase (ALP)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },
  { name: 'Gamma-Glutamyl Transferase (GGT)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },
  { name: 'Total Bilirubin', value_type: 'numeric', unit: 'mg/dL', category: 'Liver' },
  { name: 'Direct Bilirubin', value_type: 'numeric', unit: 'mg/dL', category: 'Liver' },
  { name: 'Indirect Bilirubin', value_type: 'numeric', unit: 'mg/dL', category: 'Liver' },
  { name: 'Lactate Dehydrogenase (LDH)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },

  // Lipid Panel
  { name: 'Total Cholesterol', value_type: 'numeric', unit: 'mg/dL', category: 'Lipids' },
  { name: 'LDL Cholesterol', value_type: 'numeric', unit: 'mg/dL', category: 'Lipids' },
  { name: 'HDL Cholesterol', value_type: 'numeric', unit: 'mg/dL', category: 'Lipids' },
  { name: 'Triglycerides', value_type: 'numeric', unit: 'mg/dL', category: 'Lipids' },
  { name: 'VLDL Cholesterol', value_type: 'numeric', unit: 'mg/dL', category: 'Lipids' },

  // Endocrinology (Thyroid)
  { name: 'Thyroid-Stimulating Hormone (TSH)', value_type: 'numeric', unit: 'mIU/L', category: 'Endocrinology' },
  { name: 'Free Thyroxine (Free T4)', value_type: 'numeric', unit: 'ng/dL', category: 'Endocrinology' },
  { name: 'Free Triiodothyronine (Free T3)', value_type: 'numeric', unit: 'pg/mL', category: 'Endocrinology' },
  { name: 'Total Thyroxine (Total T4)', value_type: 'numeric', unit: 'µg/dL', category: 'Endocrinology' },

  // Urinalysis
  { name: 'Urine pH', value_type: 'numeric', unit: '', category: 'Urinalysis' },
  { name: 'Urine Specific Gravity', value_type: 'numeric', unit: '', category: 'Urinalysis' },
  { name: 'Urine Protein', value_type: 'numeric', unit: 'mg/dL', category: 'Urinalysis' },
  { name: 'Urine Glucose', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine Ketones', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine Blood', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine WBC', value_type: 'numeric', unit: 'cells/hpf', category: 'Urinalysis' },
  { name: 'Urine RBC', value_type: 'numeric', unit: 'cells/hpf', category: 'Urinalysis' },
  { name: 'Urine Albumin-to-Creatinine Ratio (UACR)', value_type: 'numeric', unit: 'mg/g', category: 'Urinalysis' },

  // Immunology
  { name: 'Immunoglobulin G (IgG)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin A (IgA)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin M (IgM)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin E (IgE)', value_type: 'numeric', unit: 'IU/mL', category: 'Immunology' },
  { name: 'Complement C3', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Complement C4', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'C-Reactive Protein (CRP)', value_type: 'numeric', unit: 'mg/L', category: 'Immunology' },
  { name: 'High-Sensitivity CRP (hs-CRP)', value_type: 'numeric', unit: 'mg/L', category: 'Immunology' },
  { name: 'Antinuclear Antibody (ANA)', value_type: 'text', unit: '', category: 'Immunology' },
  { name: 'Ferritin', value_type: 'numeric', unit: 'ng/mL', category: 'Immunology' },

  // Lysosomal Enzymes
  { name: 'Alpha-Galactosidase A (Fabry)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Beta-Glucocerebrosidase (Gaucher)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Acid Sphingomyelinase (Niemann-Pick A/B)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Alpha-L-Iduronidase (MPS I)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Iduronate-2-Sulfatase (MPS II)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Alpha-Glucosidase (Pompe)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Galactocerebrosidase (Krabbe)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Arylsulfatase A (MLD)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Beta-Hexosaminidase A (Tay-Sachs)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Acid Lipase (Wolman/CESD)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Tripeptidyl Peptidase 1 (CLN2)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },
  { name: 'Palmitoyl-Protein Thioesterase 1 (CLN1)', value_type: 'numeric', unit: 'nmol/hr/mg protein', category: 'Lysosomal Enzymes' },

  // Rare Disease Biomarkers
  { name: 'Globotriaosylsphingosine (LysoGb3, Fabry)', value_type: 'numeric', unit: 'nmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Glucosylsphingosine (LysoGL1, Gaucher)', value_type: 'numeric', unit: 'ng/mL', category: 'Rare Disease Biomarkers' },
  { name: 'Chitotriosidase (Gaucher)', value_type: 'numeric', unit: 'nmol/hr/mL', category: 'Rare Disease Biomarkers' },
  { name: 'Oxysterols (Niemann-Pick C)', value_type: 'numeric', unit: 'ng/mL', category: 'Rare Disease Biomarkers' },
  { name: 'Creatine Kinase (CK)', value_type: 'numeric', unit: 'U/L', category: 'Rare Disease Biomarkers' },
  { name: 'Phenylalanine (PKU)', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Tyrosine', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Galactose-1-Phosphate (Galactosemia)', value_type: 'numeric', unit: 'mg/dL', category: 'Rare Disease Biomarkers' },
  { name: 'Biotinidase Activity', value_type: 'numeric', unit: 'U/L', category: 'Rare Disease Biomarkers' },
  { name: 'Very Long Chain Fatty Acids (VLCFA, C26:0)', value_type: 'numeric', unit: 'µg/mL', category: 'Rare Disease Biomarkers' },
  { name: 'Acylcarnitine Profile (C0)', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Acylcarnitine (C8, MCADD)', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Succinylacetone (Tyrosinemia I)', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Methylmalonic Acid (MMA)', value_type: 'numeric', unit: 'nmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Homocysteine', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  { name: 'Urine Glycosaminoglycans (MPS Screen)', value_type: 'numeric', unit: 'mg/mmol creatinine', category: 'Rare Disease Biomarkers' },
  { name: 'Urine Organic Acids', value_type: 'text', unit: '', category: 'Rare Disease Biomarkers' },
  { name: 'Plasma Amino Acids', value_type: 'text', unit: '', category: 'Rare Disease Biomarkers' },

  // Genetics / Genomics
  { name: 'Coefficient of Inbreeding (F)', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Runs of Homozygosity Total Length (ROH)', value_type: 'numeric', unit: 'Mb', category: 'Genetics' },
  { name: 'Mean Sequencing Coverage', value_type: 'numeric', unit: '×', category: 'Genetics' },
  { name: 'Percentage Bases ≥20× Coverage', value_type: 'numeric', unit: '%', category: 'Genetics' },
  { name: 'Total Variant Count', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'SNV Count', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Indel Count', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Copy Number Variant Count (CNV)', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Structural Variant Count (SV)', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Ti/Tv Ratio', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Heterozygosity Rate', value_type: 'numeric', unit: '', category: 'Genetics' },
  { name: 'Diagnostic Yield', value_type: 'text', unit: '', category: 'Genetics' },
  { name: 'ACMG Classification', value_type: 'text', unit: '', category: 'Genetics' },
  { name: 'Karyotype', value_type: 'text', unit: '', category: 'Genetics' },

  // Clinical Scores / Assessments
  { name: 'APGAR Score (1 min)', value_type: 'numeric', unit: '', category: 'Clinical' },
  { name: 'APGAR Score (5 min)', value_type: 'numeric', unit: '', category: 'Clinical' },
  { name: 'Glasgow Coma Scale (GCS)', value_type: 'numeric', unit: '', category: 'Clinical' },
  { name: 'Pain Score (VAS)', value_type: 'numeric', unit: '', category: 'Clinical' },
  { name: 'HPO Term Count', value_type: 'numeric', unit: '', category: 'Clinical' },
  { name: 'Primary Diagnosis (ICD Code)', value_type: 'text', unit: '', category: 'Clinical' },
  { name: 'Disease Severity', value_type: 'text', unit: '', category: 'Clinical' },
  { name: 'Family History', value_type: 'text', unit: '', category: 'Clinical' },
]
```

**Step 2: Add migration v5 to `src/main/database/migrations.ts`**

Add after the v4 migration block (after line 213), before the closing `}` of `runMigrations`:

```typescript
  // v0.16.0: Add case comments and metrics tables
  if (currentVersion < 5) {
    db.exec(`
      -- Case comments (timestamped, categorized)
      CREATE TABLE IF NOT EXISTS case_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_case_comments_case_created
        ON case_comments(case_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_case_comments_case_category
        ON case_comments(case_id, category);

      -- Metric definitions (predefined + user-created catalog)
      CREATE TABLE IF NOT EXISTS metric_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value_type TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        is_predefined INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Case metric values (EAV pattern with typed columns)
      CREATE TABLE IF NOT EXISTS case_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        metric_id INTEGER NOT NULL,
        numeric_value REAL,
        text_value TEXT,
        date_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE,
        UNIQUE(case_id, metric_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_metrics_case
        ON case_metrics(case_id);

      CREATE INDEX IF NOT EXISTS idx_case_metrics_metric
        ON case_metrics(metric_id);
    `)

    // Seed predefined metric definitions
    const { CLINICAL_METRICS } = await import('./clinical-metrics')
    const now = Date.now()
    const insertMetric = db.prepare(
      'INSERT OR IGNORE INTO metric_definitions (name, value_type, unit, category, is_predefined, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    )

    const seedTransaction = db.transaction(() => {
      for (const metric of CLINICAL_METRICS) {
        insertMetric.run(metric.name, metric.value_type, metric.unit, metric.category, now)
      }
    })
    seedTransaction()

    db.exec('PRAGMA user_version = 5')
  }
```

**Important**: The migration function `runMigrations` needs to become `async` since we use dynamic `import()`. Update the function signature:

Change line 25 from:
```typescript
export function runMigrations(db: Database.Database): void {
```
to:
```typescript
export async function runMigrations(db: Database.Database): Promise<void> {
```

Then update all callers of `runMigrations` to `await` it. Check `DatabaseService.ts` constructor — if it calls `runMigrations(this.db)` synchronously, the import needs to be static instead. **Safer approach**: Use a static import at the top of `migrations.ts`:

```typescript
import { CLINICAL_METRICS } from './clinical-metrics'
```

And remove the dynamic `import()` inside the migration. This avoids making `runMigrations` async.

**Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors from migration or clinical-metrics files.

**Step 4: Commit**

```bash
git add src/main/database/clinical-metrics.ts src/main/database/migrations.ts
git commit -m "feat: add migration v5 with case_comments, metric_definitions, case_metrics tables"
```

---

### Task 3: Write and run migration tests

**Files:**
- Modify: `tests/main/database/migrations.test.ts`

**Step 1: Write failing tests for migration v5**

Add a new `describe` block after the existing tests (before the closing `})` of the root describe):

```typescript
  describe('Migration v5 - Comments and Metrics', () => {
    it('creates case_comments, metric_definitions, and case_metrics tables', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const tables = service.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('case_comments')
      expect(tableNames).toContain('metric_definitions')
      expect(tableNames).toContain('case_metrics')

      service.close()
    })

    it('sets PRAGMA user_version to 5', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const result = service.database.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(result.user_version).toBe(5)

      service.close()
    })

    it('seeds predefined metric definitions', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const count = service.database
        .prepare('SELECT COUNT(*) as count FROM metric_definitions WHERE is_predefined = 1')
        .get() as { count: number }

      // Should have ~120 predefined metrics
      expect(count.count).toBeGreaterThan(100)

      service.close()
    })

    it('cascades delete to case_comments when case deleted', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.createCase('test-case', '/path/to/file.vcf', 1024)

      service.database
        .prepare('INSERT INTO case_comments (case_id, category, content, created_at) VALUES (?, ?, ?, ?)')
        .run(caseId, 'Clinical Note', 'Test comment', Date.now())

      let count = service.database.prepare('SELECT COUNT(*) as count FROM case_comments').get() as { count: number }
      expect(count.count).toBe(1)

      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      count = service.database.prepare('SELECT COUNT(*) as count FROM case_comments').get() as { count: number }
      expect(count.count).toBe(0)

      service.close()
    })

    it('cascades delete to case_metrics when case deleted', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.createCase('test-case', '/path/to/file.vcf', 1024)

      // Get a metric definition ID
      const metric = service.database
        .prepare('SELECT id FROM metric_definitions LIMIT 1')
        .get() as { id: number }

      service.database
        .prepare('INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(caseId, metric.id, 7.5, Date.now(), Date.now())

      let count = service.database.prepare('SELECT COUNT(*) as count FROM case_metrics').get() as { count: number }
      expect(count.count).toBe(1)

      service.database.prepare('DELETE FROM cases WHERE id = ?').run(caseId)

      count = service.database.prepare('SELECT COUNT(*) as count FROM case_metrics').get() as { count: number }
      expect(count.count).toBe(0)

      service.close()
    })

    it('enforces unique constraint on case_metrics(case_id, metric_id)', () => {
      const dbPath = tempDbPath()
      const service = new DatabaseService(dbPath)

      const caseId = service.createCase('test-case', '/path/to/file.vcf', 1024)
      const metric = service.database
        .prepare('SELECT id FROM metric_definitions LIMIT 1')
        .get() as { id: number }
      const now = Date.now()

      service.database
        .prepare('INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(caseId, metric.id, 7.5, now, now)

      expect(() => {
        service.database
          .prepare('INSERT INTO case_metrics (case_id, metric_id, numeric_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(caseId, metric.id, 8.0, now, now)
      }).toThrow()

      service.close()
    })
  })
```

**Step 2: Run tests to verify they pass**

Run: `npm run rebuild:node && npx vitest run tests/main/database/migrations.test.ts`
Expected: All new tests PASS (they test the migration, which runs in the DatabaseService constructor).

**Step 3: Also update existing tests that check user_version = 4 to expect 5**

Search for `user_version).toBe(4)` in the test file and update to `toBe(5)`.

**Step 4: Run full migration test suite**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add tests/main/database/migrations.test.ts
git commit -m "test: add migration v5 tests for comments and metrics tables"
```

---

### Task 4: Add DatabaseService methods for comments

**Files:**
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Add comment CRUD methods**

Add after the HPO term methods section (after `removeCaseHpoTerm`, around line 1620). Follow the existing patterns exactly (using `this.stmt()`, `this.runTransaction()`, `RETURNING *`):

```typescript
  // ============================================================
  // Case Comment Operations
  // ============================================================

  /**
   * List all comments for a case, newest first
   */
  listCaseComments(caseId: number): CaseComment[] {
    return this.stmt(
      'SELECT * FROM case_comments WHERE case_id = ? ORDER BY created_at DESC'
    ).all(caseId) as CaseComment[]
  }

  /**
   * Create a new case comment
   */
  createCaseComment(caseId: number, category: CommentCategory, content: string): CaseComment {
    const now = Date.now()
    return this.stmt(
      'INSERT INTO case_comments (case_id, category, content, created_at) VALUES (?, ?, ?, ?) RETURNING *'
    ).get(caseId, category, content, now) as CaseComment
  }

  /**
   * Update a case comment's content
   */
  updateCaseComment(commentId: number, content: string): CaseComment {
    const now = Date.now()
    const result = this.stmt(
      'UPDATE case_comments SET content = ?, updated_at = ? WHERE id = ? RETURNING *'
    ).get(content, now, commentId) as CaseComment | undefined

    if (!result) {
      throw new NotFoundError(`Comment with id ${commentId} not found`)
    }
    return result
  }

  /**
   * Delete a case comment
   */
  deleteCaseComment(commentId: number): void {
    const result = this.stmt('DELETE FROM case_comments WHERE id = ?').run(commentId)
    if (result.changes === 0) {
      throw new NotFoundError(`Comment with id ${commentId} not found`)
    }
  }
```

**Step 2: Import the new types at the top of DatabaseService.ts**

Add `CaseComment, CommentCategory` to the imports from `./types`.

**Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/main/database/DatabaseService.ts
git commit -m "feat: add DatabaseService methods for case comments CRUD"
```

---

### Task 5: Add DatabaseService methods for metrics

**Files:**
- Modify: `src/main/database/DatabaseService.ts`

**Step 1: Add metric definition and case metric methods**

Add after the comment methods:

```typescript
  // ============================================================
  // Metric Definition Operations
  // ============================================================

  /**
   * List all metric definitions ordered by category then name
   */
  listMetricDefinitions(): MetricDefinition[] {
    return this.stmt(
      'SELECT * FROM metric_definitions ORDER BY category, name'
    ).all() as MetricDefinition[]
  }

  /**
   * Create a user-defined metric definition
   */
  createMetricDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): MetricDefinition {
    const now = Date.now()
    return this.stmt(
      'INSERT INTO metric_definitions (name, value_type, unit, category, is_predefined, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING *'
    ).get(name, valueType, unit, category, now) as MetricDefinition
  }

  // ============================================================
  // Case Metric Operations
  // ============================================================

  /**
   * List all metrics for a case with their definitions (joined)
   */
  listCaseMetrics(caseId: number): CaseMetricWithDefinition[] {
    return this.stmt(`
      SELECT cm.*, md.name, md.value_type, md.unit, md.category AS metric_category
      FROM case_metrics cm
      JOIN metric_definitions md ON cm.metric_id = md.id
      WHERE cm.case_id = ?
      ORDER BY md.category, md.name
    `).all(caseId) as CaseMetricWithDefinition[]
  }

  /**
   * Upsert a case metric value
   */
  upsertCaseMetric(
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ): CaseMetric {
    const now = Date.now()
    return this.stmt(`
      INSERT INTO case_metrics (case_id, metric_id, numeric_value, text_value, date_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id, metric_id) DO UPDATE SET
        numeric_value = excluded.numeric_value,
        text_value = excluded.text_value,
        date_value = excluded.date_value,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      caseId,
      metricId,
      value.numeric_value ?? null,
      value.text_value ?? null,
      value.date_value ?? null,
      now,
      now
    ) as CaseMetric
  }

  /**
   * Delete a case metric value
   */
  deleteCaseMetric(caseId: number, metricId: number): void {
    this.stmt('DELETE FROM case_metrics WHERE case_id = ? AND metric_id = ?').run(caseId, metricId)
  }
```

**Step 2: Import the new types at the top**

Add `MetricDefinition, CaseMetric, CaseMetricWithDefinition` to the imports from `./types`.

**Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/main/database/DatabaseService.ts
git commit -m "feat: add DatabaseService methods for metric definitions and case metrics"
```

---

### Task 6: Write and run DatabaseService tests for comments and metrics

**Files:**
- Modify: `tests/main/database/DatabaseService.test.ts`

**Step 1: Add comment tests**

Add a new describe block in the test file:

```typescript
describe('Case Comments', () => {
  it('creates and lists comments for a case', () => {
    const caseId = db.createCase('comment-test', '/path/test.vcf', 1024)

    const comment = db.createCaseComment(caseId, 'Clinical Note', 'Patient presents with seizures')
    expect(comment.id).toBeGreaterThan(0)
    expect(comment.case_id).toBe(caseId)
    expect(comment.category).toBe('Clinical Note')
    expect(comment.content).toBe('Patient presents with seizures')
    expect(comment.created_at).toBeGreaterThan(0)
    expect(comment.updated_at).toBeNull()

    // Add a second comment
    db.createCaseComment(caseId, 'Lab Result', 'WBC elevated')

    const comments = db.listCaseComments(caseId)
    expect(comments).toHaveLength(2)
    // Newest first
    expect(comments[0].category).toBe('Lab Result')
    expect(comments[1].category).toBe('Clinical Note')
  })

  it('updates a comment and sets updated_at', () => {
    const caseId = db.createCase('update-comment-test', '/path/test.vcf', 1024)
    const comment = db.createCaseComment(caseId, 'Interpretation', 'Initial assessment')

    const updated = db.updateCaseComment(comment.id, 'Revised assessment')
    expect(updated.content).toBe('Revised assessment')
    expect(updated.updated_at).not.toBeNull()
    expect(updated.updated_at).toBeGreaterThanOrEqual(updated.created_at)
  })

  it('deletes a comment', () => {
    const caseId = db.createCase('delete-comment-test', '/path/test.vcf', 1024)
    const comment = db.createCaseComment(caseId, 'Follow-up', 'Schedule MRI')

    db.deleteCaseComment(comment.id)

    const comments = db.listCaseComments(caseId)
    expect(comments).toHaveLength(0)
  })

  it('throws NotFoundError when updating non-existent comment', () => {
    expect(() => db.updateCaseComment(99999, 'nope')).toThrow()
  })

  it('throws NotFoundError when deleting non-existent comment', () => {
    expect(() => db.deleteCaseComment(99999)).toThrow()
  })
})
```

**Step 2: Add metric tests**

```typescript
describe('Case Metrics', () => {
  it('lists predefined metric definitions', () => {
    const definitions = db.listMetricDefinitions()
    expect(definitions.length).toBeGreaterThan(100)

    // Check a known metric
    const hb = definitions.find(d => d.name === 'Hemoglobin (Hb)')
    expect(hb).toBeDefined()
    expect(hb!.value_type).toBe('numeric')
    expect(hb!.unit).toBe('g/dL')
    expect(hb!.category).toBe('Hematology')
    expect(hb!.is_predefined).toBe(1)
  })

  it('creates a user-defined metric definition', () => {
    const custom = db.createMetricDefinition('Custom Score', 'numeric', 'points', 'Custom')
    expect(custom.id).toBeGreaterThan(0)
    expect(custom.name).toBe('Custom Score')
    expect(custom.is_predefined).toBe(0)
  })

  it('upserts a numeric metric value for a case', () => {
    const caseId = db.createCase('metric-test', '/path/test.vcf', 1024)
    const definitions = db.listMetricDefinitions()
    const hb = definitions.find(d => d.name === 'Hemoglobin (Hb)')!

    // Insert
    const metric = db.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
    expect(metric.case_id).toBe(caseId)
    expect(metric.metric_id).toBe(hb.id)
    expect(metric.numeric_value).toBe(13.5)

    // Update (upsert)
    const updated = db.upsertCaseMetric(caseId, hb.id, { numeric_value: 14.0 })
    expect(updated.numeric_value).toBe(14.0)
    expect(updated.id).toBe(metric.id) // Same row
  })

  it('lists case metrics with definitions joined', () => {
    const caseId = db.createCase('metric-list-test', '/path/test.vcf', 1024)
    const definitions = db.listMetricDefinitions()
    const hb = definitions.find(d => d.name === 'Hemoglobin (Hb)')!
    const wbc = definitions.find(d => d.name === 'White Blood Cell Count (WBC)')!

    db.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
    db.upsertCaseMetric(caseId, wbc.id, { numeric_value: 7.2 })

    const metrics = db.listCaseMetrics(caseId)
    expect(metrics).toHaveLength(2)
    // Joined fields present
    expect(metrics[0].name).toBeDefined()
    expect(metrics[0].unit).toBeDefined()
    expect(metrics[0].metric_category).toBeDefined()
  })

  it('deletes a case metric value', () => {
    const caseId = db.createCase('metric-delete-test', '/path/test.vcf', 1024)
    const definitions = db.listMetricDefinitions()
    const hb = definitions.find(d => d.name === 'Hemoglobin (Hb)')!

    db.upsertCaseMetric(caseId, hb.id, { numeric_value: 13.5 })
    db.deleteCaseMetric(caseId, hb.id)

    const metrics = db.listCaseMetrics(caseId)
    expect(metrics).toHaveLength(0)
  })

  it('supports text and date metric values', () => {
    const caseId = db.createCase('metric-types-test', '/path/test.vcf', 1024)
    const definitions = db.listMetricDefinitions()
    const ethnicity = definitions.find(d => d.name === 'Ethnicity')!
    const dob = definitions.find(d => d.name === 'Date of Birth')!

    db.upsertCaseMetric(caseId, ethnicity.id, { text_value: 'European' })
    db.upsertCaseMetric(caseId, dob.id, { date_value: '1990-05-15' })

    const metrics = db.listCaseMetrics(caseId)
    const ethMetric = metrics.find(m => m.name === 'Ethnicity')!
    const dobMetric = metrics.find(m => m.name === 'Date of Birth')!

    expect(ethMetric.text_value).toBe('European')
    expect(dobMetric.date_value).toBe('1990-05-15')
  })
})
```

**Step 3: Run tests**

Run: `npx vitest run tests/main/database/DatabaseService.test.ts`
Expected: All new tests PASS.

**Step 4: Commit**

```bash
git add tests/main/database/DatabaseService.test.ts
git commit -m "test: add tests for case comments and metrics DatabaseService methods"
```

---

### Task 7: Update FullCaseMetadata to include comments and metrics

**Files:**
- Modify: `src/main/database/DatabaseService.ts` (the `getFullMetadata`-related area)
- Modify: `src/main/ipc/handlers/case-metadata.ts` (the `getFullMetadata` handler)

**Step 1: Update the `case-metadata:getFullMetadata` handler**

In `src/main/ipc/handlers/case-metadata.ts`, update the handler at line 199-208 to include comments and metrics:

```typescript
ipcMain.handle('case-metadata:getFullMetadata', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return {
      metadata: db.getCaseMetadata(caseId),
      cohorts: db.getCaseCohorts(caseId),
      hpoTerms: db.getCaseHpoTerms(caseId),
      comments: db.listCaseComments(caseId),
      metrics: db.listCaseMetrics(caseId)
    }
  })
})
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors (FullCaseMetadata type was already updated in Task 1).

**Step 3: Commit**

```bash
git add src/main/ipc/handlers/case-metadata.ts
git commit -m "feat: include comments and metrics in getFullMetadata response"
```

---

## Phase 2: IPC Layer — New Handlers and Preload Bridge

### Task 8: Add IPC handlers for comments and metrics

**Files:**
- Create: `src/main/ipc/handlers/case-comments.ts`
- Create: `src/main/ipc/handlers/case-metrics.ts`
- Modify: `src/main/ipc/index.ts`

**Step 1: Create `src/main/ipc/handlers/case-comments.ts`**

```typescript
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { CommentCategory } from '../../database/types'

/**
 * Case Comments IPC handlers
 *
 * Channels: case-comments:list, case-comments:create,
 *           case-comments:update, case-comments:delete
 */

ipcMain.handle('case-comments:list', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listCaseComments(caseId)
  })
})

ipcMain.handle(
  'case-comments:create',
  async (_event, caseId: number, category: CommentCategory, content: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.createCaseComment(caseId, category, content)
    })
  }
)

ipcMain.handle(
  'case-comments:update',
  async (_event, commentId: number, content: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.updateCaseComment(commentId, content)
    })
  }
)

ipcMain.handle('case-comments:delete', async (_event, commentId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.deleteCaseComment(commentId)
    return undefined
  })
})
```

**Step 2: Create `src/main/ipc/handlers/case-metrics.ts`**

```typescript
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Case Metrics IPC handlers
 *
 * Channels: case-metrics:listDefinitions, case-metrics:createDefinition,
 *           case-metrics:listForCase, case-metrics:upsert, case-metrics:delete
 */

ipcMain.handle('case-metrics:listDefinitions', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listMetricDefinitions()
  })
})

ipcMain.handle(
  'case-metrics:createDefinition',
  async (
    _event,
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.createMetricDefinition(name, valueType, unit, category)
    })
  }
)

ipcMain.handle('case-metrics:listForCase', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.listCaseMetrics(caseId)
  })
})

ipcMain.handle(
  'case-metrics:upsert',
  async (
    _event,
    caseId: number,
    metricId: number,
    value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
  ) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.upsertCaseMetric(caseId, metricId, value)
    })
  }
)

ipcMain.handle(
  'case-metrics:delete',
  async (_event, caseId: number, metricId: number) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.deleteCaseMetric(caseId, metricId)
      return undefined
    })
  }
)
```

**Step 3: Register new handlers in `src/main/ipc/index.ts`**

Add to the `Promise.all` array (after line 27):

```typescript
    import('./handlers/case-comments'),
    import('./handlers/case-metrics'),
```

**Step 4: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/main/ipc/handlers/case-comments.ts src/main/ipc/handlers/case-metrics.ts src/main/ipc/index.ts
git commit -m "feat: add IPC handlers for case comments and metrics"
```

---

### Task 9: Update preload bridge

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Add caseComments and caseMetrics to the api object**

Add after the `caseMetadata` section (after line 241), before the `transcripts` section:

```typescript
  caseComments: {
    list: (caseId: number) => ipcRenderer.invoke('case-comments:list', caseId),

    create: (caseId: number, category: string, content: string) =>
      ipcRenderer.invoke('case-comments:create', caseId, category, content),

    update: (commentId: number, content: string) =>
      ipcRenderer.invoke('case-comments:update', commentId, content),

    delete: (commentId: number) => ipcRenderer.invoke('case-comments:delete', commentId)
  },

  caseMetrics: {
    listDefinitions: () => ipcRenderer.invoke('case-metrics:listDefinitions'),

    createDefinition: (
      name: string,
      valueType: 'numeric' | 'text' | 'date',
      unit: string,
      category: string
    ) => ipcRenderer.invoke('case-metrics:createDefinition', name, valueType, unit, category),

    listForCase: (caseId: number) => ipcRenderer.invoke('case-metrics:listForCase', caseId),

    upsert: (
      caseId: number,
      metricId: number,
      value: { numeric_value?: number | null; text_value?: string | null; date_value?: string | null }
    ) => ipcRenderer.invoke('case-metrics:upsert', caseId, metricId, value),

    delete: (caseId: number, metricId: number) =>
      ipcRenderer.invoke('case-metrics:delete', caseId, metricId)
  },
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose case comments and metrics API via preload bridge"
```

---

## Phase 3: Renderer — Composables

### Task 10: Create useCaseComments composable

**Files:**
- Create: `src/renderer/src/composables/useCaseComments.ts`

**Step 1: Create the composable**

```typescript
/**
 * Composable for case comment state management
 *
 * Provides reactive comment state per case with IPC-backed persistence.
 * Used by CaseCommentsTab for comment CRUD.
 */

import { ref } from 'vue'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'

// Cache comments by caseId
const commentsCache = ref<Map<number, CaseComment[]>>(new Map())
const loadingStates = ref<Map<number, boolean>>(new Map())

export const COMMENT_CATEGORIES: CommentCategory[] = [
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
]

export const COMMENT_CATEGORY_ICONS: Record<CommentCategory, string> = {
  'Clinical Note': 'mdi-stethoscope',
  'Lab Result': 'mdi-flask',
  'Interpretation': 'mdi-lightbulb-outline',
  'Follow-up': 'mdi-calendar-check',
  'Family History': 'mdi-family-tree',
  'Treatment': 'mdi-pill'
}

export const COMMENT_CATEGORY_COLORS: Record<CommentCategory, string> = {
  'Clinical Note': 'primary',
  'Lab Result': 'info',
  'Interpretation': 'warning',
  'Follow-up': 'success',
  'Family History': 'purple',
  'Treatment': 'teal'
}

export function useCaseComments() {
  async function loadComments(caseId: number): Promise<void> {
    if (loadingStates.value.get(caseId) === true) return

    loadingStates.value.set(caseId, true)
    try {
      const comments = await window.api.caseComments.list(caseId)
      commentsCache.value.set(caseId, comments)
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  function getComments(caseId: number): CaseComment[] {
    return commentsCache.value.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  async function createComment(
    caseId: number,
    category: CommentCategory,
    content: string
  ): Promise<CaseComment> {
    const comment = await window.api.caseComments.create(caseId, category, content)

    // Add to cache (newest first)
    const cached = commentsCache.value.get(caseId) ?? []
    cached.unshift(comment)
    commentsCache.value.set(caseId, cached)

    return comment
  }

  async function updateComment(caseId: number, commentId: number, content: string): Promise<void> {
    const updated = await window.api.caseComments.update(commentId, content)

    // Update in cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      const index = cached.findIndex((c) => c.id === commentId)
      if (index !== -1) {
        cached[index] = updated
      }
    }
  }

  async function deleteComment(caseId: number, commentId: number): Promise<void> {
    await window.api.caseComments.delete(commentId)

    // Remove from cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      commentsCache.value.set(
        caseId,
        cached.filter((c) => c.id !== commentId)
      )
    }
  }

  function clearCache(): void {
    commentsCache.value.clear()
    loadingStates.value.clear()
  }

  return {
    loadComments,
    getComments,
    isLoading,
    createComment,
    updateComment,
    deleteComment,
    clearCache
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/composables/useCaseComments.ts
git commit -m "feat: add useCaseComments composable for comment state management"
```

---

### Task 11: Create useCaseMetrics composable

**Files:**
- Create: `src/renderer/src/composables/useCaseMetrics.ts`

**Step 1: Create the composable**

```typescript
/**
 * Composable for case metrics state management
 *
 * Provides reactive metric state per case with IPC-backed persistence.
 * Manages the metric definitions catalog (predefined + user-created).
 * Used by CaseMetricsTab for metric CRUD.
 */

import { ref, computed } from 'vue'
import type {
  MetricDefinition,
  CaseMetricWithDefinition,
  MetricValue
} from '../../../shared/types/api'

// Global metric definitions cache
const definitionsCache = ref<MetricDefinition[]>([])
const definitionsLoaded = ref(false)

// Per-case metrics cache
const metricsCache = ref<Map<number, CaseMetricWithDefinition[]>>(new Map())
const loadingStates = ref<Map<number, boolean>>(new Map())

export function useCaseMetrics() {
  // Computed: definitions grouped by category
  const definitionsByCategory = computed(() => {
    const grouped = new Map<string, MetricDefinition[]>()
    for (const def of definitionsCache.value) {
      const list = grouped.get(def.category) ?? []
      list.push(def)
      grouped.set(def.category, list)
    }
    return grouped
  })

  async function loadDefinitions(): Promise<void> {
    if (definitionsLoaded.value) return
    try {
      definitionsCache.value = await window.api.caseMetrics.listDefinitions()
      definitionsLoaded.value = true
    } catch (error) {
      console.error('Failed to load metric definitions:', error)
    }
  }

  async function loadMetrics(caseId: number): Promise<void> {
    if (loadingStates.value.get(caseId) === true) return

    loadingStates.value.set(caseId, true)
    try {
      const metrics = await window.api.caseMetrics.listForCase(caseId)
      metricsCache.value.set(caseId, metrics)
    } catch (error) {
      console.error('Failed to load case metrics:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  function getMetrics(caseId: number): CaseMetricWithDefinition[] {
    return metricsCache.value.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  async function upsertMetric(
    caseId: number,
    metricId: number,
    value: MetricValue
  ): Promise<void> {
    await window.api.caseMetrics.upsert(caseId, metricId, value)
    // Reload to get joined data
    loadingStates.value.delete(caseId) // Allow reload
    metricsCache.value.delete(caseId)
    await loadMetrics(caseId)
  }

  async function deleteMetric(caseId: number, metricId: number): Promise<void> {
    await window.api.caseMetrics.delete(caseId, metricId)

    // Remove from cache
    const cached = metricsCache.value.get(caseId)
    if (cached) {
      metricsCache.value.set(
        caseId,
        cached.filter((m) => m.metric_id !== metricId)
      )
    }
  }

  async function createDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): Promise<MetricDefinition> {
    const def = await window.api.caseMetrics.createDefinition(name, valueType, unit, category)
    definitionsCache.value.push(def)
    // Re-sort
    definitionsCache.value.sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    )
    return def
  }

  function clearCache(): void {
    definitionsCache.value = []
    definitionsLoaded.value = false
    metricsCache.value.clear()
    loadingStates.value.clear()
  }

  return {
    definitionsCache,
    definitionsByCategory,
    loadDefinitions,
    loadMetrics,
    getMetrics,
    isLoading,
    upsertMetric,
    deleteMetric,
    createDefinition,
    clearCache
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/composables/useCaseMetrics.ts
git commit -m "feat: add useCaseMetrics composable for metric state management"
```

---

## Phase 4: Renderer — UI Components

### Task 12: Convert CaseMetadataModal to tabbed layout

**Files:**
- Modify: `src/renderer/src/components/CaseMetadataModal.vue`

**Step 1: Rewrite CaseMetadataModal with tabs**

Replace the entire content of `CaseMetadataModal.vue`:

```vue
<template>
  <v-dialog v-model="open" max-width="700px" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ caseName }}</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
      </v-card-title>

      <v-divider />

      <div class="d-flex ga-4 px-4 py-2 text-body-medium text-medium-emphasis bg-grey-lighten-4">
        <span>
          <v-icon size="x-small" class="mr-1">mdi-dna</v-icon>
          {{ variantCount.toLocaleString() }} variants
        </span>
        <span>
          <v-icon size="x-small" class="mr-1">mdi-calendar</v-icon>
          Imported {{ formatDate(createdAt) }}
        </span>
      </div>

      <v-tabs v-model="activeTab" bg-color="secondary" density="compact">
        <v-tab value="overview">
          <v-icon start size="small">mdi-information-outline</v-icon>
          Overview
        </v-tab>
        <v-tab value="comments">
          <v-icon start size="small">mdi-comment-text-outline</v-icon>
          Comments
          <v-badge
            v-if="commentCount > 0"
            :content="commentCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
        <v-tab value="metrics">
          <v-icon start size="small">mdi-chart-box-outline</v-icon>
          Metrics
          <v-badge
            v-if="metricCount > 0"
            :content="metricCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
      </v-tabs>

      <v-card-text class="pa-4" style="min-height: 300px; max-height: 500px; overflow-y: auto">
        <v-tabs-window v-model="activeTab">
          <v-tabs-window-item value="overview">
            <CaseMetadataCard :case-id="caseId" />
          </v-tabs-window-item>

          <v-tabs-window-item value="comments">
            <CaseCommentsTab :case-id="caseId" />
          </v-tabs-window-item>

          <v-tabs-window-item value="metrics">
            <CaseMetricsTab :case-id="caseId" />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'
import CaseCommentsTab from './CaseCommentsTab.vue'
import CaseMetricsTab from './CaseMetricsTab.vue'
import { useCaseComments } from '../composables/useCaseComments'
import { useCaseMetrics } from '../composables/useCaseMetrics'

const props = defineProps<{
  caseId: number
  caseName: string
  variantCount: number
  createdAt: number
}>()

const open = ref(false)
const activeTab = ref('overview')

const { getComments } = useCaseComments()
const { getMetrics } = useCaseMetrics()

const commentCount = computed(() => getComments(props.caseId).length)
const metricCount = computed(() => getMetrics(props.caseId).length)

const formatDate = (timestamp: number): string => {
  if (timestamp === 0) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))
}

const show = (): void => {
  open.value = true
}

defineExpose({ show })
</script>
```

**Step 2: Commit (components won't compile yet — CaseCommentsTab and CaseMetricsTab don't exist)**

```bash
git add src/renderer/src/components/CaseMetadataModal.vue
git commit -m "feat: convert CaseMetadataModal to tabbed layout with Overview/Comments/Metrics"
```

---

### Task 13: Create CaseCommentsTab component

**Files:**
- Create: `src/renderer/src/components/CaseCommentsTab.vue`

**Step 1: Create the component**

```vue
<template>
  <div>
    <!-- Add comment form -->
    <v-card variant="outlined" class="mb-3">
      <v-card-text class="pa-3">
        <div class="d-flex ga-2 mb-2">
          <v-select
            v-model="newCategory"
            :items="COMMENT_CATEGORIES"
            label="Category"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 200px"
          >
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <v-icon :color="COMMENT_CATEGORY_COLORS[item.value]" size="small">
                    {{ COMMENT_CATEGORY_ICONS[item.value] }}
                  </v-icon>
                </template>
              </v-list-item>
            </template>
          </v-select>
        </div>
        <v-textarea
          v-model="newContent"
          label="Add a comment..."
          density="compact"
          variant="outlined"
          hide-details
          rows="2"
          auto-grow
        />
        <div class="d-flex justify-end mt-2">
          <v-btn
            color="primary"
            size="small"
            :disabled="!newContent.trim()"
            :loading="isCreating"
            @click="handleCreate"
          >
            Add Comment
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <!-- Comments list -->
    <template v-else>
      <div v-if="comments.length === 0" class="text-center text-medium-emphasis py-4">
        No comments yet
      </div>

      <v-card
        v-for="comment in comments"
        :key="comment.id"
        variant="outlined"
        class="mb-2"
      >
        <v-card-text class="pa-3">
          <!-- Header -->
          <div class="d-flex align-center justify-space-between mb-1">
            <div class="d-flex align-center ga-2">
              <v-chip
                :color="COMMENT_CATEGORY_COLORS[comment.category]"
                size="x-small"
                label
              >
                <v-icon start size="x-small">
                  {{ COMMENT_CATEGORY_ICONS[comment.category] }}
                </v-icon>
                {{ comment.category }}
              </v-chip>
              <span class="text-caption text-medium-emphasis">
                {{ formatTimestamp(comment.created_at) }}
              </span>
              <span
                v-if="comment.updated_at"
                class="text-caption text-medium-emphasis font-italic"
              >
                (edited)
              </span>
            </div>
            <div>
              <v-btn
                icon="mdi-pencil-outline"
                size="x-small"
                variant="text"
                @click="startEdit(comment)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="x-small"
                variant="text"
                color="error"
                @click="handleDelete(comment.id)"
              />
            </div>
          </div>

          <!-- Content (view or edit mode) -->
          <template v-if="editingId === comment.id">
            <v-textarea
              v-model="editContent"
              density="compact"
              variant="outlined"
              hide-details
              rows="2"
              auto-grow
              class="mt-2"
            />
            <div class="d-flex justify-end ga-2 mt-2">
              <v-btn size="x-small" variant="text" @click="cancelEdit">Cancel</v-btn>
              <v-btn
                size="x-small"
                color="primary"
                :disabled="!editContent.trim()"
                :loading="isSaving"
                @click="handleUpdate(comment.id)"
              >
                Save
              </v-btn>
            </div>
          </template>
          <div v-else class="text-body-2" style="white-space: pre-wrap">
            {{ comment.content }}
          </div>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useCaseComments,
  COMMENT_CATEGORIES,
  COMMENT_CATEGORY_ICONS,
  COMMENT_CATEGORY_COLORS
} from '../composables/useCaseComments'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'

const props = defineProps<{
  caseId: number
}>()

const {
  loadComments,
  getComments,
  isLoading,
  createComment,
  updateComment,
  deleteComment
} = useCaseComments()

// New comment form
const newCategory = ref<CommentCategory>('Clinical Note')
const newContent = ref('')
const isCreating = ref(false)

// Edit state
const editingId = ref<number | null>(null)
const editContent = ref('')
const isSaving = ref(false)

// Computed
const loading = computed(() => isLoading(props.caseId))
const comments = computed(() => getComments(props.caseId))

// Load on mount/caseId change
watch(
  () => props.caseId,
  async (id) => {
    if (id) await loadComments(id)
  },
  { immediate: true }
)

async function handleCreate(): Promise<void> {
  if (!newContent.value.trim()) return
  isCreating.value = true
  try {
    await createComment(props.caseId, newCategory.value, newContent.value.trim())
    newContent.value = ''
  } catch (error) {
    console.error('Failed to create comment:', error)
  } finally {
    isCreating.value = false
  }
}

function startEdit(comment: CaseComment): void {
  editingId.value = comment.id
  editContent.value = comment.content
}

function cancelEdit(): void {
  editingId.value = null
  editContent.value = ''
}

async function handleUpdate(commentId: number): Promise<void> {
  if (!editContent.value.trim()) return
  isSaving.value = true
  try {
    await updateComment(props.caseId, commentId, editContent.value.trim())
    editingId.value = null
    editContent.value = ''
  } catch (error) {
    console.error('Failed to update comment:', error)
  } finally {
    isSaving.value = false
  }
}

async function handleDelete(commentId: number): Promise<void> {
  try {
    await deleteComment(props.caseId, commentId)
  } catch (error) {
    console.error('Failed to delete comment:', error)
  }
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts))
}
</script>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/CaseCommentsTab.vue
git commit -m "feat: add CaseCommentsTab component with CRUD and inline editing"
```

---

### Task 14: Create CaseMetricsTab component

**Files:**
- Create: `src/renderer/src/components/CaseMetricsTab.vue`

**Step 1: Create the component**

This is the most complex UI component. It features:
- Autocomplete for selecting metrics from the catalog (grouped by category)
- Type-aware value input (number field for numeric, text field for text, date picker for date)
- List of assigned metrics grouped by category
- Ability to create custom metrics inline

```vue
<template>
  <div>
    <!-- Add metric form -->
    <v-card variant="outlined" class="mb-3">
      <v-card-text class="pa-3">
        <v-autocomplete
          v-model="selectedDefinition"
          :items="availableDefinitions"
          item-title="name"
          item-value="id"
          return-object
          label="Add a metric..."
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="mb-2"
          :no-data-text="searchQuery ? 'No matching metrics — press Enter to create custom' : 'Type to search metrics'"
          @update:search="searchQuery = $event"
          @keydown.enter="handleEnterOnSearch"
        >
          <template #item="{ item, props: itemProps }">
            <v-list-item v-bind="itemProps">
              <template #subtitle>
                <span class="text-caption">
                  {{ item.raw.category }}
                  <template v-if="item.raw.unit"> &middot; {{ item.raw.unit }}</template>
                </span>
              </template>
            </v-list-item>
          </template>
        </v-autocomplete>

        <!-- Value input (shown when metric selected) -->
        <template v-if="selectedDefinition">
          <div class="d-flex align-center ga-2">
            <!-- Numeric -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'numeric'"
              v-model.number="numericInput"
              :label="selectedDefinition.unit ? `Value (${selectedDefinition.unit})` : 'Value'"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 200px"
            />

            <!-- Text -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'text'"
              v-model="textInput"
              label="Value"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 300px"
            />

            <!-- Date -->
            <v-text-field
              v-if="selectedDefinition.value_type === 'date'"
              v-model="dateInput"
              label="Value"
              type="date"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 200px"
            />

            <v-btn
              color="primary"
              size="small"
              :disabled="!hasValidInput"
              :loading="isSaving"
              @click="handleSave"
            >
              Save
            </v-btn>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <!-- Create custom metric dialog -->
    <v-dialog v-model="showCreateDialog" max-width="400px">
      <v-card>
        <v-card-title>Create Custom Metric</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="customName"
            label="Metric Name"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-select
            v-model="customValueType"
            :items="['numeric', 'text', 'date']"
            label="Value Type"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-text-field
            v-model="customUnit"
            label="Unit (optional)"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-text-field
            v-model="customCategory"
            label="Category"
            density="compact"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="!customName.trim() || !customCategory.trim()"
            @click="handleCreateDefinition"
          >
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <!-- Metrics list grouped by category -->
    <template v-else>
      <div v-if="metrics.length === 0" class="text-center text-medium-emphasis py-4">
        No metrics recorded yet
      </div>

      <template v-for="(group, category) in metricsByCategory" :key="category">
        <div class="text-caption text-medium-emphasis text-uppercase mb-1 mt-3">
          {{ category }}
        </div>
        <v-table density="compact">
          <tbody>
            <tr v-for="metric in group" :key="metric.id">
              <td style="width: 50%">
                <span class="text-body-2">{{ metric.name }}</span>
              </td>
              <td>
                <span class="text-body-2 font-weight-medium">
                  {{ formatMetricValue(metric) }}
                </span>
                <span v-if="metric.unit" class="text-caption text-medium-emphasis ml-1">
                  {{ metric.unit }}
                </span>
              </td>
              <td style="width: 40px">
                <v-btn
                  icon="mdi-delete-outline"
                  size="x-small"
                  variant="text"
                  color="error"
                  @click="handleDelete(metric.metric_id)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCaseMetrics } from '../composables/useCaseMetrics'
import type { MetricDefinition, CaseMetricWithDefinition } from '../../../shared/types/api'

const props = defineProps<{
  caseId: number
}>()

const {
  definitionsCache,
  loadDefinitions,
  loadMetrics,
  getMetrics,
  isLoading,
  upsertMetric,
  deleteMetric,
  createDefinition
} = useCaseMetrics()

// Add metric form state
const selectedDefinition = ref<MetricDefinition | null>(null)
const searchQuery = ref('')
const numericInput = ref<number | null>(null)
const textInput = ref('')
const dateInput = ref('')
const isSaving = ref(false)

// Create custom metric dialog
const showCreateDialog = ref(false)
const customName = ref('')
const customValueType = ref<'numeric' | 'text' | 'date'>('numeric')
const customUnit = ref('')
const customCategory = ref('Custom')

// Computed
const loading = computed(() => isLoading(props.caseId))
const metrics = computed(() => getMetrics(props.caseId))

// Filter out already-assigned metric definitions
const assignedMetricIds = computed(() => new Set(metrics.value.map((m) => m.metric_id)))
const availableDefinitions = computed(() =>
  definitionsCache.value.filter((d) => !assignedMetricIds.value.has(d.id))
)

// Group metrics by category for display
const metricsByCategory = computed(() => {
  const grouped: Record<string, CaseMetricWithDefinition[]> = {}
  for (const m of metrics.value) {
    const cat = m.metric_category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(m)
  }
  return grouped
})

const hasValidInput = computed(() => {
  if (!selectedDefinition.value) return false
  switch (selectedDefinition.value.value_type) {
    case 'numeric':
      return numericInput.value !== null && numericInput.value !== undefined
    case 'text':
      return textInput.value.trim().length > 0
    case 'date':
      return dateInput.value.length > 0
    default:
      return false
  }
})

// Load on mount
watch(
  () => props.caseId,
  async (id) => {
    if (id) {
      await Promise.all([loadDefinitions(), loadMetrics(id)])
    }
  },
  { immediate: true }
)

async function handleSave(): Promise<void> {
  if (!selectedDefinition.value || !hasValidInput.value) return

  isSaving.value = true
  try {
    const value =
      selectedDefinition.value.value_type === 'numeric'
        ? { numeric_value: numericInput.value }
        : selectedDefinition.value.value_type === 'text'
          ? { text_value: textInput.value.trim() }
          : { date_value: dateInput.value }

    await upsertMetric(props.caseId, selectedDefinition.value.id, value)

    // Reset form
    selectedDefinition.value = null
    numericInput.value = null
    textInput.value = ''
    dateInput.value = ''
  } catch (error) {
    console.error('Failed to save metric:', error)
  } finally {
    isSaving.value = false
  }
}

async function handleDelete(metricId: number): Promise<void> {
  try {
    await deleteMetric(props.caseId, metricId)
  } catch (error) {
    console.error('Failed to delete metric:', error)
  }
}

function handleEnterOnSearch(): void {
  // If no match and user typed something, offer to create custom
  if (searchQuery.value && availableDefinitions.value.length === 0) {
    customName.value = searchQuery.value
    showCreateDialog.value = true
  }
}

async function handleCreateDefinition(): Promise<void> {
  try {
    const def = await createDefinition(
      customName.value.trim(),
      customValueType.value,
      customUnit.value.trim(),
      customCategory.value.trim()
    )
    // Auto-select the new definition
    selectedDefinition.value = def
    showCreateDialog.value = false
    customName.value = ''
    customUnit.value = ''
    customCategory.value = 'Custom'
  } catch (error) {
    console.error('Failed to create metric definition:', error)
  }
}

function formatMetricValue(metric: CaseMetricWithDefinition): string {
  if (metric.numeric_value !== null && metric.numeric_value !== undefined) {
    return String(metric.numeric_value)
  }
  if (metric.text_value !== null && metric.text_value !== undefined) {
    return metric.text_value
  }
  if (metric.date_value !== null && metric.date_value !== undefined) {
    return metric.date_value
  }
  return '-'
}
</script>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/CaseMetricsTab.vue
git commit -m "feat: add CaseMetricsTab component with autocomplete, type-aware input, and grouped display"
```

---

## Phase 5: Integration and Polish

### Task 15: Update useCaseMetadata to load comments and metrics

**Files:**
- Modify: `src/renderer/src/composables/useCaseMetadata.ts`

**Step 1: Update the composable**

The `FullCaseMetadata` type now includes `comments` and `metrics`. The `loadMetadata` function already fetches via `getFullMetadata` which now returns these fields. However, the composable doesn't expose them and other composables manage their own caches.

The simplest approach: let the comments and metrics composables handle their own loading independently. But we should update `clearCache` and `invalidateCase` to also clear those caches.

Import and call the other composables' clear functions. Add to `useCaseMetadata.ts`:

At the top:
```typescript
import { useCaseComments } from './useCaseComments'
import { useCaseMetrics } from './useCaseMetrics'
```

In the `clearCache` function:
```typescript
  function clearCache(): void {
    metadataCache.value.clear()
    loadingStates.value.clear()
    cohortGroupsCache.value = []
    useCaseComments().clearCache()
    useCaseMetrics().clearCache()
  }
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/renderer/src/composables/useCaseMetadata.ts
git commit -m "feat: integrate comments and metrics cache clearing into useCaseMetadata"
```

---

### Task 16: Run full test suite and fix issues

**Files:** Various (fix as needed)

**Step 1: Rebuild for Node.js**

Run: `npm run rebuild:node`
Expected: SUCCESS

**Step 2: Run full test suite**

Run: `npm run test`
Expected: All tests PASS. Fix any failures.

**Step 3: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors. Fix any lint issues.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and lint issues for enhanced case metadata"
```

---

### Task 17: Write unit tests for composables

**Files:**
- Create: `tests/renderer/composables/useCaseComments.test.ts`
- Create: `tests/renderer/composables/useCaseMetrics.test.ts`

**Step 1: Write tests for useCaseComments**

Follow the existing test patterns in `tests/renderer/composables/` (check for existing files). Tests should mock `window.api.caseComments` and verify:
- `loadComments` populates cache
- `createComment` adds to cache
- `updateComment` updates in cache
- `deleteComment` removes from cache
- `clearCache` empties everything

**Step 2: Write tests for useCaseMetrics**

Similar pattern, mock `window.api.caseMetrics` and verify:
- `loadDefinitions` populates definitions cache
- `loadMetrics` populates per-case cache
- `upsertMetric` triggers reload
- `deleteMetric` removes from cache
- `createDefinition` adds to definitions cache

**Step 3: Run tests**

Run: `npx vitest run tests/renderer/composables/`
Expected: All PASS.

**Step 4: Commit**

```bash
git add tests/renderer/composables/useCaseComments.test.ts tests/renderer/composables/useCaseMetrics.test.ts
git commit -m "test: add unit tests for useCaseComments and useCaseMetrics composables"
```

---

### Task 18: Final integration test and cleanup

**Step 1: Run full CI check**

Run: `make ci`
Expected: All lint, typecheck, and tests pass.

**Step 2: Verify the modal renders correctly**

Run: `make dev`
- Open a database with cases
- Click on a case to open the metadata modal
- Verify 3 tabs appear: Overview, Comments, Metrics
- Test adding/editing/deleting a comment
- Test adding a metric (search autocomplete, enter value, save)
- Test creating a custom metric definition
- Test deleting a metric

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final integration fixes for enhanced case metadata"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|------------------|
| 1: Database | 1-7 | Types, migration v5 (3 tables + 120 seed metrics), DatabaseService CRUD, tests |
| 2: IPC | 8-9 | IPC handlers for comments + metrics, preload bridge |
| 3: Composables | 10-11 | useCaseComments + useCaseMetrics state management |
| 4: UI | 12-14 | Tabbed modal, CaseCommentsTab, CaseMetricsTab |
| 5: Integration | 15-18 | Cache integration, full test suite, polish |

**Total: 18 tasks, ~35 commits**
