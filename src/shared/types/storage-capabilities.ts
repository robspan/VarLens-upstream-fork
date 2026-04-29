export type StorageBackendKind = 'sqlite' | 'postgres'

export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly workspace: {
    readonly localFileLifecycle: boolean
    readonly hostedConnectionLifecycle: boolean
    readonly encryptionAtRest: boolean
    readonly migrations: boolean
    readonly healthDiagnostics: boolean
  }
  readonly cases: {
    readonly list: boolean
    readonly query: boolean
    readonly deleteOne: boolean
    readonly deleteMany: boolean
    readonly deleteAll: boolean
    readonly overview: boolean
  }
  readonly imports: {
    readonly json: boolean
    readonly vcf: boolean
    readonly multiFileVcf: boolean
    readonly bedFilters: boolean
    readonly cancellation: boolean
  }
  readonly variants: {
    readonly query: boolean
    readonly searchQuery: boolean
    readonly legacySearch: boolean
    readonly filterOptions: boolean
    readonly columnMeta: boolean
    readonly typeCounts: boolean
    readonly typesPresent: boolean
    readonly geneSymbols: boolean
    readonly panelFilters: boolean
    readonly tagFilters: boolean
    readonly commentFilters: boolean
    readonly acmgFilters: boolean
    readonly annotationFilters: boolean
    readonly inheritanceFilters: boolean
    readonly analysisGroupFilters: boolean
    readonly phasingFilters: boolean
  }
  readonly workflow: {
    readonly tags: boolean
    readonly annotations: boolean
    readonly caseComments: boolean
    readonly caseMetrics: boolean
    readonly filterPresets: boolean
    readonly panels: boolean
    readonly geneLists: boolean
    readonly regionFiles: boolean
    readonly analysisGroups: boolean
    readonly auditLog: boolean
  }
  readonly cohort: {
    readonly query: boolean
    readonly summary: boolean
    readonly rebuild: boolean
    readonly carriers: boolean
    readonly geneBurden: boolean
    readonly columnMeta: boolean
  }
  readonly export: {
    readonly variants: boolean
    readonly cohort: boolean
    readonly streaming: boolean
  }
}
