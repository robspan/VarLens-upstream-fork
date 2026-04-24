export interface MetadataUpdates {
  affected_status?: string | null
  sex?: string | null
  notes?: string | null
  age?: number | null
  date_of_birth?: string | null
}

export interface CohortCreateParams {
  name: string
  description?: string | null
}

export interface CohortUpdateParams {
  name?: string
  description?: string | null
}

export interface DataInfoUpdates {
  platform?: string | null
  platform_details?: string | null
  af_filter?: string | null
  gene_list_filter?: string | null
  region_filter?: string | null
  quality_filter?: string | null
  data_notes?: string | null
  gene_list_id?: number | null
  region_file_id?: number | null
}

export interface FullCaseMetadataResult {
  metadata: unknown
  cohorts: unknown[]
  hpoTerms: unknown[]
  comments: unknown[]
  metrics: unknown[]
  dataInfo: unknown
  externalIds: unknown[]
}
