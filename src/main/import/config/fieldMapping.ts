import type { FieldMapping } from '../types'

/** Column name keys used internally by FieldMapper */
export type ColumnName = keyof typeof COLUMN_INDICES

// Default column indices — only used as fallback when header is unavailable
export const COLUMN_INDICES = {
  SELECTED_TRANSCRIPT: 1,
  CHR: 9,
  POS: 10,
  REF: 11,
  ALT: 12,
  QUAL: 14,
  GT_NUM: 15,
  FUNC: 20,
  IMPACT: 21,
  GENE: 24,
  OMIM: 25,
  TRANSCRIPT: 28,
  CDNA: 29,
  AA_CHANGE: 30,
  CADD: 46,
  CLINVAR: 72,
  GNOMAD_AF: 108,
  HPO_SIM_SCORE: 156,
  MOI: 162
} as const

/**
 * Map of header field IDs to internal column names.
 * Multiple aliases are supported for different VarVis versions.
 */
const HEADER_ID_TO_COLUMN: Record<string, ColumnName> = {
  selectedTranscript: 'SELECTED_TRANSCRIPT',
  Chr: 'CHR',
  Pos: 'POS',
  Ref: 'REF',
  Alt: 'ALT',
  // Qual variants
  Qual: 'QUAL',
  'Qual-Index': 'QUAL',
  // Genotype variants
  Genotype: 'GT_NUM',
  'GTNum-Index': 'GT_NUM',
  // Function/consequence variants
  VarType: 'FUNC',
  Func: 'FUNC',
  Consequence: 'IMPACT',
  Impact: 'IMPACT',
  // Gene
  Gene: 'GENE',
  // OMIM variants
  Omim: 'OMIM',
  OMIM: 'OMIM',
  // Transcript
  Transcript: 'TRANSCRIPT',
  // cDNA variants
  HGVS_C: 'CDNA',
  cDNA: 'CDNA',
  // AA change variants
  HGVS_P: 'AA_CHANGE',
  AAChange: 'AA_CHANGE',
  // CADD
  CADDPhredScore: 'CADD',
  // ClinVar variants
  ClinVar: 'CLINVAR',
  ClinVSig: 'CLINVAR',
  // gnomAD AF variants
  GnomadAF: 'GNOMAD_AF',
  GnomPMaxFiltAF: 'GNOMAD_AF',
  GnomTotal: 'GNOMAD_AF',
  // HPO
  HpoSimScore: 'HPO_SIM_SCORE',
  // MOI
  MoI: 'MOI'
}

/** Type for dynamic column indices resolved from header */
export type ColumnIndices = Record<ColumnName, number>

/**
 * Build column index map dynamically from header field IDs.
 * Falls back to COLUMN_INDICES defaults for any fields not found in header.
 */
export function resolveColumnIndices(header: { id: string }[]): ColumnIndices {
  // Start with defaults
  const indices = { ...COLUMN_INDICES } as Record<ColumnName, number>

  for (let i = 0; i < header.length; i++) {
    const columnName = HEADER_ID_TO_COLUMN[header[i].id]
    if (columnName !== undefined) {
      indices[columnName] = i
    }
  }

  return indices
}

// Data dictionaries (loaded from header at parse time)
export interface DataDictionaries {
  gene: Record<string, string> // Gene ID -> symbol
  impact: Record<string, string> // Impact code -> label
  transcript: Record<string, string> // Transcript ID -> name
  hpoSimScore: Record<string, number> // ID -> score
  moi: Record<string, string> // ID -> abbreviation (AD/AR)
}

// Static Impact dictionary (constant across files)
export const IMPACT_DICTIONARY: Record<string, string> = {
  '1': 'HIGH',
  '2': 'MODERATE',
  '3': 'LOW',
  '4': 'MODIFIER'
}

// Field mappings array
export const FIELD_MAPPINGS: FieldMapping[] = [
  { source: 'Chr', sourceIndex: 9, target: 'chr', isMultiValue: true, hasDictionary: false },
  { source: 'Pos', sourceIndex: 10, target: 'pos', isMultiValue: true, hasDictionary: false },
  { source: 'Ref', sourceIndex: 11, target: 'ref', isMultiValue: false, hasDictionary: false },
  { source: 'Alt', sourceIndex: 12, target: 'alt', isMultiValue: false, hasDictionary: false },
  {
    source: 'Gene',
    sourceIndex: 24,
    target: 'gene_symbol',
    isMultiValue: true,
    hasDictionary: true
  },
  {
    source: 'OMIM',
    sourceIndex: 25,
    target: 'omim_mim_number',
    isMultiValue: true,
    hasDictionary: false
  },
  {
    source: 'Impact',
    sourceIndex: 21,
    target: 'consequence',
    isMultiValue: true,
    hasDictionary: true
  },
  {
    source: 'GnomPMaxFiltAF',
    sourceIndex: 108,
    target: 'gnomad_af',
    isMultiValue: false,
    hasDictionary: false
  },
  {
    source: 'CADDPhredScore',
    sourceIndex: 46,
    target: 'cadd',
    isMultiValue: false,
    hasDictionary: false
  },
  {
    source: 'ClinVSig',
    sourceIndex: 72,
    target: 'clinvar',
    isMultiValue: false,
    hasDictionary: false
  }
]

// Helper function to resolve dictionary value
export function resolveDictionaryValue(
  value: string | number | null,
  dictionary: Record<string, string> | null
): string | null {
  if (value === null || value === undefined) return null
  if (dictionary === null) return String(value)
  return dictionary[String(value)] ?? String(value)
}
