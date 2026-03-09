/**
 * Predefined clinical and laboratory metric definitions
 *
 * Ships with VarLens as the default metric catalog.
 * Users can add custom metrics on top of these.
 * Predefined metrics across 15 categories, verified against clinical standards.
 * Excludes metrics computable from VarLens data (variant counts, HPO count, ACMG).
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
  {
    name: 'Age at Last Evaluation',
    value_type: 'numeric',
    unit: 'years',
    category: 'Demographics'
  },
  { name: 'Gestational Age', value_type: 'numeric', unit: 'weeks', category: 'Demographics' },
  { name: 'Date of Diagnosis', value_type: 'date', unit: '', category: 'Demographics' },
  { name: 'Date of Sample Collection', value_type: 'date', unit: '', category: 'Demographics' },
  { name: 'Ethnicity', value_type: 'text', unit: '', category: 'Demographics' },
  { name: 'Consanguinity Status', value_type: 'text', unit: '', category: 'Demographics' },

  // Anthropometrics
  { name: 'Height', value_type: 'numeric', unit: 'cm', category: 'Anthropometrics' },
  { name: 'Weight', value_type: 'numeric', unit: 'kg', category: 'Anthropometrics' },
  {
    name: 'Body Mass Index (BMI)',
    value_type: 'numeric',
    unit: 'kg/m²',
    category: 'Anthropometrics'
  },
  { name: 'Head Circumference', value_type: 'numeric', unit: 'cm', category: 'Anthropometrics' },
  {
    name: 'Body Surface Area (BSA)',
    value_type: 'numeric',
    unit: 'm²',
    category: 'Anthropometrics'
  },

  // Vitals
  { name: 'Systolic Blood Pressure', value_type: 'numeric', unit: 'mmHg', category: 'Vitals' },
  { name: 'Diastolic Blood Pressure', value_type: 'numeric', unit: 'mmHg', category: 'Vitals' },
  { name: 'Heart Rate', value_type: 'numeric', unit: 'bpm', category: 'Vitals' },
  { name: 'Respiratory Rate', value_type: 'numeric', unit: 'breaths/min', category: 'Vitals' },
  { name: 'Body Temperature', value_type: 'numeric', unit: '°C', category: 'Vitals' },
  { name: 'Oxygen Saturation (SpO2)', value_type: 'numeric', unit: '%', category: 'Vitals' },

  // Hematology (CBC)
  {
    name: 'White Blood Cell Count (WBC)',
    value_type: 'numeric',
    unit: '×10³/µL',
    category: 'Hematology'
  },
  {
    name: 'Red Blood Cell Count (RBC)',
    value_type: 'numeric',
    unit: '×10⁶/µL',
    category: 'Hematology'
  },
  { name: 'Hemoglobin (Hb)', value_type: 'numeric', unit: 'g/dL', category: 'Hematology' },
  { name: 'Hematocrit (Hct)', value_type: 'numeric', unit: '%', category: 'Hematology' },
  {
    name: 'Mean Corpuscular Volume (MCV)',
    value_type: 'numeric',
    unit: 'fL',
    category: 'Hematology'
  },
  {
    name: 'Mean Corpuscular Hemoglobin (MCH)',
    value_type: 'numeric',
    unit: 'pg',
    category: 'Hematology'
  },
  {
    name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)',
    value_type: 'numeric',
    unit: 'g/dL',
    category: 'Hematology'
  },
  {
    name: 'Red Cell Distribution Width (RDW)',
    value_type: 'numeric',
    unit: '%',
    category: 'Hematology'
  },
  { name: 'Platelet Count', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Mean Platelet Volume (MPV)', value_type: 'numeric', unit: 'fL', category: 'Hematology' },
  {
    name: 'Neutrophils (Absolute)',
    value_type: 'numeric',
    unit: '×10³/µL',
    category: 'Hematology'
  },
  {
    name: 'Lymphocytes (Absolute)',
    value_type: 'numeric',
    unit: '×10³/µL',
    category: 'Hematology'
  },
  { name: 'Monocytes (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  {
    name: 'Eosinophils (Absolute)',
    value_type: 'numeric',
    unit: '×10³/µL',
    category: 'Hematology'
  },
  { name: 'Basophils (Absolute)', value_type: 'numeric', unit: '×10³/µL', category: 'Hematology' },
  { name: 'Reticulocyte Count', value_type: 'numeric', unit: '%', category: 'Hematology' },
  {
    name: 'Erythrocyte Sedimentation Rate (ESR)',
    value_type: 'numeric',
    unit: 'mm/hr',
    category: 'Hematology'
  },

  // Coagulation
  {
    name: 'Prothrombin Time (PT)',
    value_type: 'numeric',
    unit: 'seconds',
    category: 'Coagulation'
  },
  {
    name: 'International Normalized Ratio (INR)',
    value_type: 'numeric',
    unit: '',
    category: 'Coagulation'
  },
  {
    name: 'Activated Partial Thromboplastin Time (aPTT)',
    value_type: 'numeric',
    unit: 'seconds',
    category: 'Coagulation'
  },
  { name: 'Fibrinogen', value_type: 'numeric', unit: 'mg/dL', category: 'Coagulation' },
  { name: 'D-Dimer', value_type: 'numeric', unit: 'µg/mL FEU', category: 'Coagulation' },

  // Biochemistry (Metabolic Panel)
  { name: 'Glucose (Fasting)', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  {
    name: 'Blood Urea Nitrogen (BUN)',
    value_type: 'numeric',
    unit: 'mg/dL',
    category: 'Biochemistry'
  },
  { name: 'Creatinine', value_type: 'numeric', unit: 'mg/dL', category: 'Biochemistry' },
  {
    name: 'Estimated GFR (eGFR)',
    value_type: 'numeric',
    unit: 'mL/min/1.73m²',
    category: 'Biochemistry'
  },
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
  {
    name: 'Aspartate Aminotransferase (AST)',
    value_type: 'numeric',
    unit: 'U/L',
    category: 'Liver'
  },
  { name: 'Alkaline Phosphatase (ALP)', value_type: 'numeric', unit: 'U/L', category: 'Liver' },
  {
    name: 'Gamma-Glutamyl Transferase (GGT)',
    value_type: 'numeric',
    unit: 'U/L',
    category: 'Liver'
  },
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
  {
    name: 'Thyroid-Stimulating Hormone (TSH)',
    value_type: 'numeric',
    unit: 'mIU/L',
    category: 'Endocrinology'
  },
  {
    name: 'Free Thyroxine (Free T4)',
    value_type: 'numeric',
    unit: 'ng/dL',
    category: 'Endocrinology'
  },
  {
    name: 'Free Triiodothyronine (Free T3)',
    value_type: 'numeric',
    unit: 'pg/mL',
    category: 'Endocrinology'
  },
  {
    name: 'Total Thyroxine (Total T4)',
    value_type: 'numeric',
    unit: 'µg/dL',
    category: 'Endocrinology'
  },

  // Urinalysis
  { name: 'Urine pH', value_type: 'numeric', unit: '', category: 'Urinalysis' },
  { name: 'Urine Specific Gravity', value_type: 'numeric', unit: '', category: 'Urinalysis' },
  { name: 'Urine Protein', value_type: 'numeric', unit: 'mg/dL', category: 'Urinalysis' },
  { name: 'Urine Glucose', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine Ketones', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine Blood', value_type: 'text', unit: '', category: 'Urinalysis' },
  { name: 'Urine WBC', value_type: 'numeric', unit: 'cells/hpf', category: 'Urinalysis' },
  { name: 'Urine RBC', value_type: 'numeric', unit: 'cells/hpf', category: 'Urinalysis' },
  {
    name: 'Urine Albumin-to-Creatinine Ratio (UACR)',
    value_type: 'numeric',
    unit: 'mg/g',
    category: 'Urinalysis'
  },

  // Immunology
  { name: 'Immunoglobulin G (IgG)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin A (IgA)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin M (IgM)', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Immunoglobulin E (IgE)', value_type: 'numeric', unit: 'IU/mL', category: 'Immunology' },
  { name: 'Complement C3', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'Complement C4', value_type: 'numeric', unit: 'mg/dL', category: 'Immunology' },
  { name: 'C-Reactive Protein (CRP)', value_type: 'numeric', unit: 'mg/L', category: 'Immunology' },
  {
    name: 'High-Sensitivity CRP (hs-CRP)',
    value_type: 'numeric',
    unit: 'mg/L',
    category: 'Immunology'
  },
  { name: 'Antinuclear Antibody (ANA)', value_type: 'text', unit: '', category: 'Immunology' },
  { name: 'Ferritin', value_type: 'numeric', unit: 'ng/mL', category: 'Immunology' },

  // Lysosomal Enzymes
  {
    name: 'Alpha-Galactosidase A (Fabry)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Beta-Glucocerebrosidase (Gaucher)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Acid Sphingomyelinase (Niemann-Pick A/B)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Alpha-L-Iduronidase (MPS I)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Iduronate-2-Sulfatase (MPS II)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Alpha-Glucosidase (Pompe)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Galactocerebrosidase (Krabbe)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Arylsulfatase A (MLD)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Beta-Hexosaminidase A (Tay-Sachs)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Acid Lipase (Wolman/CESD)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Tripeptidyl Peptidase 1 (CLN2)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },
  {
    name: 'Palmitoyl-Protein Thioesterase 1 (CLN1)',
    value_type: 'numeric',
    unit: 'nmol/hr/mg protein',
    category: 'Lysosomal Enzymes'
  },

  // Rare Disease Biomarkers
  {
    name: 'Globotriaosylsphingosine (LysoGb3, Fabry)',
    value_type: 'numeric',
    unit: 'nmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Glucosylsphingosine (LysoGL1, Gaucher)',
    value_type: 'numeric',
    unit: 'ng/mL',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Chitotriosidase (Gaucher)',
    value_type: 'numeric',
    unit: 'nmol/hr/mL',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Oxysterols (Niemann-Pick C)',
    value_type: 'numeric',
    unit: 'ng/mL',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Creatine Kinase (CK)',
    value_type: 'numeric',
    unit: 'U/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Phenylalanine (PKU)',
    value_type: 'numeric',
    unit: 'µmol/L',
    category: 'Rare Disease Biomarkers'
  },
  { name: 'Tyrosine', value_type: 'numeric', unit: 'µmol/L', category: 'Rare Disease Biomarkers' },
  {
    name: 'Galactose-1-Phosphate (Galactosemia)',
    value_type: 'numeric',
    unit: 'mg/dL',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Biotinidase Activity',
    value_type: 'numeric',
    unit: 'U/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Very Long Chain Fatty Acids (VLCFA, C26:0)',
    value_type: 'numeric',
    unit: 'µg/mL',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Acylcarnitine Profile (C0)',
    value_type: 'numeric',
    unit: 'µmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Acylcarnitine (C8, MCADD)',
    value_type: 'numeric',
    unit: 'µmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Succinylacetone (Tyrosinemia I)',
    value_type: 'numeric',
    unit: 'µmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Methylmalonic Acid (MMA)',
    value_type: 'numeric',
    unit: 'nmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Homocysteine',
    value_type: 'numeric',
    unit: 'µmol/L',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Urine Glycosaminoglycans (MPS Screen)',
    value_type: 'numeric',
    unit: 'mg/mmol creatinine',
    category: 'Rare Disease Biomarkers'
  },
  {
    name: 'Urine Organic Acids',
    value_type: 'text',
    unit: '',
    category: 'Rare Disease Biomarkers'
  },
  { name: 'Plasma Amino Acids', value_type: 'text', unit: '', category: 'Rare Disease Biomarkers' },

  // Clinical Scores / Assessments
  { name: 'Primary Diagnosis (ICD Code)', value_type: 'text', unit: '', category: 'Clinical' },
  { name: 'Disease Severity', value_type: 'text', unit: '', category: 'Clinical' }
]
