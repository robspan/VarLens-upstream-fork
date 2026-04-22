import { contextBridge, ipcRenderer } from 'electron'
import { createAnalysisGroupsApi } from './domains/analysis-groups'
import { createAnnotationsApi } from './domains/annotations'
import { createAuditLogApi } from './domains/audit-log'
import { createAuthApi } from './domains/auth'
import { createBatchImportApi } from './domains/batch-import'
import { createCaseCommentsApi } from './domains/case-comments'
import { createCaseMetadataApi } from './domains/case-metadata'
import { createCaseMetricsApi } from './domains/case-metrics'
import { createCasesApi } from './domains/cases'
import { createCohortApi } from './domains/cohort'
import { createDatabaseApi } from './domains/database'
import { createExportApi } from './domains/export'
import { createFilterPresetsApi } from './domains/filter-presets'
import { createGeneListsApi } from './domains/gene-lists'
import { createGeneRefApi } from './domains/gene-ref'
import { createGnomadApi } from './domains/gnomad'
import { createHpoApi } from './domains/hpo'
import { createImportApi } from './domains/import'
import { createMyvariantApi } from './domains/myvariant'
import { createPanelsApi } from './domains/panels'
import { createProteinApi } from './domains/protein'
import { createRegionFilesApi } from './domains/region-files'
import { createSpliceaiApi } from './domains/spliceai'
import { createTagsApi } from './domains/tags'
import { createTranscriptsApi } from './domains/transcripts'
import { createVariantsApi } from './domains/variants'
import { createVepApi } from './domains/vep'
import type {
  ProgressUpdate,
  VariantFilter,
  SortItem,
  BatchProgress,
  BatchResult,
  DuplicateChoice,
  CohortSearchParams,
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates,
  CaseMetadataUpdates,
  CaseSearchParams,
  LogMessage,
  TranscriptInsertRow
} from '../shared/types'
import type { CommentCategory, AnnotationChangeEvent } from '../shared/types/api'
import type { FilterPresetCreate, FilterPresetUpdate } from '../shared/types/filter-presets'
import type { ShortlistResult } from '../shared/types/shortlist'
import type { ValidatedGetShortlistParams } from '../shared/types/ipc-schemas'
import type { MainPerfSnapshot } from '../shared/types/perf'
import type { FilterPresetReorderItem } from '../shared/ipc/domains/filter-presets'
import type { WindowAPI } from '../shared/types/api'

/**
 * Preload script - exposes typed API to renderer via contextBridge.
 *
 * Channel naming convention: domain:action
 * - cases:list, cases:delete
 * - variants:query, variants:filterOptions
 * - import:selectFile, import:start, import:progress, import:cancel
 * - system:version, system:userDataPath
 * - shell:openExternal
 */

const analysisGroupsDomain = createAnalysisGroupsApi()
const annotationsDomain = createAnnotationsApi()
const auditLogDomain = createAuditLogApi()
const authDomain = createAuthApi()
const batchImportDomain = createBatchImportApi()
const caseCommentsDomain = createCaseCommentsApi()
const caseMetadataDomain = createCaseMetadataApi()
const caseMetricsDomain = createCaseMetricsApi()
const casesDomain = createCasesApi()
const cohortDomain = createCohortApi()
const databaseDomain = createDatabaseApi()
const exportDomain = createExportApi()
const filterPresetsDomain = createFilterPresetsApi()
const geneListsDomain = createGeneListsApi()
const geneRefDomain = createGeneRefApi()
const gnomadDomain = createGnomadApi()
const hpoDomain = createHpoApi()
const importDomain = createImportApi()
const myvariantDomain = createMyvariantApi()
const panelsDomain = createPanelsApi()
const proteinDomain = createProteinApi()
const regionFilesDomain = createRegionFilesApi()
const spliceaiDomain = createSpliceaiApi()
const tagsDomain = createTagsApi()
const transcriptsDomain = createTranscriptsApi()
const variantsDomain = createVariantsApi()
const vepDomain = createVepApi()

const api: WindowAPI = {
  cases: {
    list: () => casesDomain.list(),
    query: (params: CaseSearchParams) => casesDomain.query(params),
    delete: (id: number) => casesDomain.delete(id),
    deleteAll: () => casesDomain.deleteAll(),
    deleteBatch: (ids: number[]) => casesDomain.deleteBatch(ids),
    availableBuilds: () => casesDomain.availableBuilds()
  },

  variants: {
    query: (
      caseId: number,
      filters: Omit<VariantFilter, 'case_id'>,
      offset?: number,
      limit?: number,
      sortBy?: SortItem[],
      skipCount?: boolean,
      includeUnfilteredCount?: boolean
    ) =>
      variantsDomain.query(
        caseId,
        filters,
        offset,
        limit,
        sortBy,
        skipCount,
        includeUnfilteredCount
      ),

    getFilterOptions: (caseId: number) => variantsDomain.getFilterOptions(caseId),

    search: (caseId: number, query: string, limit?: number) =>
      variantsDomain.search(caseId, query, limit ?? 20),

    /** Get gene symbols for autocomplete (optimized LIKE query - faster than FTS5) */
    geneSymbols: (caseId: number, query: string, limit?: number) =>
      variantsDomain.geneSymbols(caseId, query, limit ?? 50),

    /** Get variant type counts per case for tab badges (snv/indel/sv/cnv/str) */
    typeCounts: (caseId: number) => variantsDomain.typeCounts(caseId),

    /**
     * Get per-column metadata for a single column (single-case or cohort scope).
     * Used by the filter UI to lazy-load column metadata on demand.
     * Payload must provide either caseId (single case) or caseIds (cohort).
     */
    columnMeta: (payload: { caseId?: number; caseIds?: number[]; columnKey: string }) =>
      variantsDomain.columnMeta(payload),

    /**
     * Get distinct variant types present for a single case or cohort.
     * Used by the renderer to auto-hide variant-type tabs with no data.
     * Payload must provide either caseId (single case) or caseIds (cohort).
     */
    typesPresent: (payload: { caseId?: number; caseIds?: number[] }) =>
      variantsDomain.typesPresent(payload),

    /**
     * Run the unified shortlist pipeline for a case. Wave 3 wrapper
     * around `variants:shortlist`. Accepts either a preset id or an
     * inline `adHocConfig` (discriminated union) and resolves to the
     * ranked `ShortlistResult` envelope.
     */
    shortlist: (params: ValidatedGetShortlistParams): Promise<ShortlistResult> =>
      ipcRenderer.invoke('variants:shortlist', params),

    /**
     * Subscribe to `variants:annotationChanged` broadcasts emitted by the
     * main process after a successful `annotations:upsertPerCase` write.
     * Returns an unsubscribe function; call it on component unmount to
     * avoid a growing listener list.
     *
     * Consumers (e.g. Wave 4 `useShortlistQuery`) use this to refetch
     * dependent views when the same-case star / ACMG state changes.
     *
     * Phase 1 limitation: global annotation upserts do NOT emit this event.
     */
    onAnnotationChanged: (callback: (ev: AnnotationChangeEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, ev: AnnotationChangeEvent): void => {
        callback(ev)
      }
      ipcRenderer.on('variants:annotationChanged', handler)
      return () => {
        ipcRenderer.removeListener('variants:annotationChanged', handler)
      }
    }
  },

  import: {
    selectFile: () => importDomain.selectFile(),
    selectFiles: () => importDomain.selectFiles(),
    selectBedFile: () => importDomain.selectBedFile(),

    start: (
      filePath: string,
      caseName: string,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string }
    ) => importDomain.start(filePath, caseName, vcfOptions),

    startMultiFile: (
      caseName: string,
      files: Array<{
        filePath: string
        variantType: string
        caller: string | null
        annotationFormat: string | null
      }>,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string },
      filters?: {
        bedFile?: string | null
        bedPadding?: number
        passOnly?: boolean
        minQual?: number | null
        minGq?: number | null
        minDp?: number | null
      }
    ) => importDomain.startMultiFile(caseName, files, vcfOptions, filters),

    vcfPreview: (filePath: string) => importDomain.vcfPreview(filePath),
    vcfMultiPreview: (filePaths: string[]) => importDomain.vcfMultiPreview(filePaths),

    /**
     * Register progress listener. Returns cleanup function.
     * IMPORTANT: Call the returned function on component unmount to prevent memory leaks.
     */
    onProgress: (callback: (progress: ProgressUpdate) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ProgressUpdate) => {
        callback(progress)
      }
      ipcRenderer.on('import:progress', handler)

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('import:progress', handler)
      }
    },

    cancel: () => importDomain.cancel()
  } as WindowAPI['import'],

  system: {
    getVersion: () => ipcRenderer.invoke('system:version'),
    getUserDataPath: () => ipcRenderer.invoke('system:userDataPath'),
    getCpuCount: (): Promise<number> => ipcRenderer.invoke('system:getCpuCount'),
    setWorkerThreads: (count: number): Promise<void> =>
      ipcRenderer.invoke('system:setWorkerThreads', count),
    getWorkerThreads: (): Promise<number> => ipcRenderer.invoke('system:getWorkerThreads'),
    getLogFilePath: (): Promise<string> => ipcRenderer.invoke('system:logFilePath')
  },

  export: {
    variants: (caseId: number, filters: Omit<VariantFilter, 'case_id'>, caseName: string) =>
      exportDomain.variants(caseId, filters, caseName),
    cohort: (params: CohortSearchParams) => exportDomain.cohort(params)
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    updateDomains: (domains: string[]) => ipcRenderer.invoke('shell:updateUserDomains', domains),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
  },

  database: {
    selectFile: () => databaseDomain.selectFile(),
    selectSaveLocation: (defaultName: string) => databaseDomain.selectSaveLocation(defaultName),
    open: (path: string, password?: string) => databaseDomain.open(path, password),
    create: (path: string, password?: string) => databaseDomain.create(path, password),
    rekey: (newPassword: string) => databaseDomain.rekey(newPassword),
    info: () => databaseDomain.info(),
    recentList: () => databaseDomain.recentList(),
    getOverview: () => databaseDomain.getOverview(),
    removeRecent: (path: string) => databaseDomain.removeRecent(path),
    deleteFile: (path: string) => databaseDomain.deleteFile(path),
    showInFolder: (path: string) => databaseDomain.showInFolder(path)
  } as WindowAPI['database'],

  batchImport: {
    selectFiles: () => batchImportDomain.selectFiles(),
    selectFolder: () => batchImportDomain.selectFolder(),
    checkDuplicates: (filePaths: string[], stripText?: string) =>
      batchImportDomain.checkDuplicates(filePaths, stripText),
    start: (filePaths: string[], duplicateStrategy: DuplicateChoice, stripText?: string) =>
      batchImportDomain.start(filePaths, duplicateStrategy, stripText),
    cancel: () => batchImportDomain.cancel(),

    selectZip: () => batchImportDomain.selectZip(),
    testZipPassword: (zipPath: string, password: string) =>
      batchImportDomain.testZipPassword(zipPath, password),
    extractZip: (zipPath: string, password?: string) =>
      batchImportDomain.extractZip(zipPath, password),
    cleanupZipTemp: () => batchImportDomain.cleanupZipTemp(),

    onProgress: (callback: (progress: BatchProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: BatchProgress) => {
        callback(progress)
      }
      ipcRenderer.on('batch-import:progress', handler)
      return () => {
        ipcRenderer.removeListener('batch-import:progress', handler)
      }
    },

    onComplete: (callback: (result: BatchResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: BatchResult) => {
        callback(result)
      }
      ipcRenderer.on('batch-import:complete', handler)
      return () => {
        ipcRenderer.removeListener('batch-import:complete', handler)
      }
    }
  } as WindowAPI['batchImport'],

  cohort: {
    getVariants: (params: CohortSearchParams) => cohortDomain.getVariants(params),
    getColumnMeta: () => cohortDomain.getColumnMeta(),
    getSummary: () => cohortDomain.getSummary(),
    getCarriers: (chr: string, pos: number, ref: string, alt: string) =>
      cohortDomain.getCarriers(chr, pos, ref, alt),
    getGeneBurden: () => cohortDomain.getGeneBurden(),
    runAssociation: (config: unknown) => cohortDomain.runAssociation(config),
    cancelAssociation: () => cohortDomain.cancelAssociation(),
    onAssociationProgress: (
      callback: (progress: { completed: number; total: number }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { completed: number; total: number }
      ): void => {
        callback(progress)
      }
      ipcRenderer.on('cohort:geneBurdenProgress', handler)
      return () => {
        ipcRenderer.removeListener('cohort:geneBurdenProgress', handler)
      }
    },
    getSummaryStatus: () => cohortDomain.getSummaryStatus(),
    rebuildSummary: () => cohortDomain.rebuildSummary(),
    onSummaryRebuilt: (
      callback: (status: {
        is_stale: boolean
        phase?: string
        phase_index?: number
        phase_total?: number
        label?: string
      }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: {
          is_stale: boolean
          phase?: string
          phase_index?: number
          phase_total?: number
          label?: string
        }
      ): void => {
        callback(status)
      }
      ipcRenderer.on('cohort:summaryRebuilt', handler)
      return () => {
        ipcRenderer.removeListener('cohort:summaryRebuilt', handler)
      }
    }
  } as WindowAPI['cohort'],

  annotations: {
    getGlobal: (chr: string, pos: number, ref: string, alt: string) =>
      annotationsDomain.getGlobal(chr, pos, ref, alt),

    upsertGlobal: (
      chr: string,
      pos: number,
      ref: string,
      alt: string,
      updates: GlobalAnnotationUpdates
    ) => annotationsDomain.upsertGlobal(chr, pos, ref, alt, updates),

    deleteGlobal: (chr: string, pos: number, ref: string, alt: string) =>
      annotationsDomain.deleteGlobal(chr, pos, ref, alt),

    getPerCase: (caseId: number, variantId: number) =>
      annotationsDomain.getPerCase(caseId, variantId),

    upsertPerCase: (caseId: number, variantId: number, updates: PerCaseAnnotationUpdates) =>
      annotationsDomain.upsertPerCase(caseId, variantId, updates),

    deletePerCase: (caseId: number, variantId: number) =>
      annotationsDomain.deletePerCase(caseId, variantId),

    getForVariant: (caseId: number, chr: string, pos: number, ref: string, alt: string) =>
      annotationsDomain.getForVariant(caseId, chr, pos, ref, alt),

    batchGet: (
      caseId: number | null,
      variantKeys: Array<{ chr: string; pos: number; ref: string; alt: string }>
    ) => annotationsDomain.batchGet(caseId, variantKeys)
  },

  vep: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      vepDomain.fetch(chr, pos, ref, alt),
    cancel: () => vepDomain.cancel(),
    clearCache: () => vepDomain.clearCache(),
    getCacheStats: () => vepDomain.getCacheStats()
  },

  hpo: {
    search: (query: string, maxResults?: number) => hpoDomain.search(query, maxResults),
    clearCache: () => hpoDomain.clearCache()
  },

  myvariant: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      myvariantDomain.fetch(chr, pos, ref, alt),
    clearCache: () => myvariantDomain.clearCache()
  },

  spliceai: {
    fetch: (chr: string, pos: number, ref: string, alt: string) =>
      spliceaiDomain.fetch(chr, pos, ref, alt),
    clearCache: () => spliceaiDomain.clearCache()
  },

  caseMetadata: {
    get: (caseId: number) => caseMetadataDomain.get(caseId),

    upsert: (caseId: number, updates: CaseMetadataUpdates) =>
      caseMetadataDomain.upsert(caseId, updates),

    getFullMetadata: (caseId: number) => caseMetadataDomain.getFullMetadata(caseId),

    // Cohort groups
    listCohorts: () => caseMetadataDomain.listCohorts(),

    createCohort: (name: string, description?: string | null) =>
      caseMetadataDomain.createCohort(name, description),

    updateCohort: (cohortId: number, updates: { name?: string; description?: string | null }) =>
      caseMetadataDomain.updateCohort(cohortId, updates),

    deleteCohort: (cohortId: number) => caseMetadataDomain.deleteCohort(cohortId),

    getCohortByName: (name: string) => caseMetadataDomain.getCohortByName(name),

    // Case-cohort links
    getCaseCohorts: (caseId: number) => caseMetadataDomain.getCaseCohorts(caseId),

    assignCohort: (caseId: number, cohortId: number) =>
      caseMetadataDomain.assignCohort(caseId, cohortId),

    removeCohort: (caseId: number, cohortId: number) =>
      caseMetadataDomain.removeCohort(caseId, cohortId),

    setCohorts: (caseId: number, cohortIds: number[]) =>
      caseMetadataDomain.setCohorts(caseId, cohortIds),

    // HPO terms
    getHpoTerms: (caseId: number) => caseMetadataDomain.getHpoTerms(caseId),

    assignHpoTerm: (caseId: number, hpoId: string, hpoLabel: string) =>
      caseMetadataDomain.assignHpoTerm(caseId, hpoId, hpoLabel),

    removeHpoTerm: (caseId: number, hpoId: string) =>
      caseMetadataDomain.removeHpoTerm(caseId, hpoId),

    // Data info (import provenance, platform, pre-filtering)
    getDataInfo: (caseId: number) => caseMetadataDomain.getDataInfo(caseId),

    upsertDataInfo: (
      caseId: number,
      updates: {
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
    ) => caseMetadataDomain.upsertDataInfo(caseId, updates),

    // External IDs (user-defined key-value cross-references)
    listExternalIds: (caseId: number) => caseMetadataDomain.listExternalIds(caseId),

    upsertExternalId: (caseId: number, idType: string, idValue: string) =>
      caseMetadataDomain.upsertExternalId(caseId, idType, idValue),

    deleteExternalId: (caseId: number, idType: string) =>
      caseMetadataDomain.deleteExternalId(caseId, idType),

    distinctHpoTerms: () => caseMetadataDomain.distinctHpoTerms(),
    distinctPlatforms: () => caseMetadataDomain.distinctPlatforms(),
    distinctExternalIdTypes: () => caseMetadataDomain.distinctExternalIdTypes()
  } as WindowAPI['caseMetadata'],

  caseComments: {
    list: (caseId: number) => caseCommentsDomain.list(caseId),

    create: (caseId: number, category: CommentCategory, content: string) =>
      caseCommentsDomain.create(caseId, category, content),

    update: (commentId: number, content: string) => caseCommentsDomain.update(commentId, content),

    delete: (commentId: number) => caseCommentsDomain.delete(commentId)
  },

  caseMetrics: {
    listDefinitions: () => caseMetricsDomain.listDefinitions(),

    createDefinition: (
      name: string,
      valueType: 'numeric' | 'text' | 'date',
      unit: string,
      category: string
    ) => caseMetricsDomain.createDefinition(name, valueType, unit, category),

    listForCase: (caseId: number) => caseMetricsDomain.listForCase(caseId),

    upsert: (
      caseId: number,
      metricId: number,
      value: {
        numeric_value?: number | null
        text_value?: string | null
        date_value?: string | null
      }
    ) => caseMetricsDomain.upsert(caseId, metricId, value),

    delete: (caseId: number, metricId: number) => caseMetricsDomain.delete(caseId, metricId)
  },

  transcripts: {
    list: (variantId: number) => transcriptsDomain.list(variantId),
    switch: (variantId: number, transcriptId: string) =>
      transcriptsDomain.switch(variantId, transcriptId),
    insertAndSwitch: (variantId: number, transcript: TranscriptInsertRow) =>
      transcriptsDomain.insertAndSwitch(variantId, transcript)
  } as WindowAPI['transcripts'],

  tags: {
    // Tag CRUD
    list: () => tagsDomain.list(),

    create: (name: string, color: string) => tagsDomain.create(name, color),

    update: (id: number, updates: { name?: string; color?: string }) =>
      tagsDomain.update(id, updates),

    delete: (id: number) => tagsDomain.delete(id),

    getUsageCount: (tagId: number) => tagsDomain.getUsageCount(tagId),

    // Variant tag assignments
    getVariantTags: (caseId: number, variantId: number) =>
      tagsDomain.getVariantTags(caseId, variantId),

    assignVariantTag: (caseId: number, variantId: number, tagId: number) =>
      tagsDomain.assignVariantTag(caseId, variantId, tagId),

    removeVariantTag: (caseId: number, variantId: number, tagId: number) =>
      tagsDomain.removeVariantTag(caseId, variantId, tagId),

    setVariantTags: (caseId: number, variantId: number, tagIds: number[]) =>
      tagsDomain.setVariantTags(caseId, variantId, tagIds)
  },

  logs: {
    /**
     * Register log message listener. Returns cleanup function.
     * IMPORTANT: Call the returned function on component unmount to prevent memory leaks.
     */
    onMessage: (callback: (log: LogMessage) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, log: LogMessage) => {
        callback(log)
      }
      ipcRenderer.on('logs:message', handler)

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('logs:message', handler)
      }
    }
  },

  audit: {
    getByEntity: (entityKey: string) => auditLogDomain.getByEntity(entityKey),
    query: (params: Record<string, unknown>) => auditLogDomain.query(params)
  } as WindowAPI['audit'],

  geneLists: {
    list: () => geneListsDomain.list(),
    create: (name: string, description?: string | null) =>
      geneListsDomain.create(name, description),
    delete: (id: number) => geneListsDomain.delete(id),
    getGenes: (listId: number) => geneListsDomain.getGenes(listId),
    setGenes: (listId: number, genes: string[]) => geneListsDomain.setGenes(listId, genes)
  },

  regionFiles: {
    list: () => regionFilesDomain.list(),
    create: (name: string, description: string | null) =>
      regionFilesDomain.create(name, description),
    delete: (id: number) => regionFilesDomain.delete(id),
    importBed: (fileId: number, filePath: string) => regionFilesDomain.importBed(fileId, filePath)
  } as WindowAPI['regionFiles'],

  panels: {
    list: () => panelsDomain.list(),
    get: (id: number) => panelsDomain.get(id),
    create: (params: {
      name: string
      description?: string | null
      version?: string | null
      source?: string
      sourceId?: string | null
      sourceMetadata?: Record<string, unknown> | null
    }) => panelsDomain.create(params),
    update: (params: {
      id: number
      name?: string
      description?: string | null
      version?: string | null
    }) => panelsDomain.update(params),
    delete: (id: number) => panelsDomain.delete(id),
    duplicate: (id: number, newName: string) => panelsDomain.duplicate(id, newName),
    setGenes: (panelId: number, genes: Array<{ hgncId: string; symbol: string }>) =>
      panelsDomain.setGenes(panelId, genes),
    getGenes: (panelId: number) => panelsDomain.getGenes(panelId),
    activate: (caseId: number, panelId: number, paddingBp?: number) =>
      panelsDomain.activate(caseId, panelId, paddingBp),
    deactivate: (caseId: number, panelId: number) => panelsDomain.deactivate(caseId, panelId),
    activeForCase: (caseId: number) => panelsDomain.activeForCase(caseId),
    validateSymbols: (symbols: string[]) => panelsDomain.validateSymbols(symbols),
    autocomplete: (query: string, limit?: number) => panelsDomain.autocomplete(query, limit),
    searchPanelApp: (keyword: string, region: 'uk' | 'aus' | 'both') =>
      panelsDomain.searchPanelApp(keyword, region),
    importPanelApp: (params: {
      panelId: number
      region: 'uk' | 'aus'
      confidenceThreshold: 'green' | 'green_amber' | 'all'
      name?: string
    }) => panelsDomain.importPanelApp(params),
    generateStringDb: (params: {
      seedGenes: string[]
      requiredScore: number
      networkType: 'physical' | 'functional'
      name?: string
    }) => panelsDomain.generateStringDb(params),
    exportBed: (panelId: number, assembly: string, paddingBp: number) =>
      panelsDomain.exportBed(panelId, assembly, paddingBp)
  },

  geneRef: {
    info: () => geneRefDomain.info(),
    assemblies: () => geneRefDomain.assemblies(),
    checkUpdates: () => geneRefDomain.checkUpdates(),
    update: () => geneRefDomain.update()
  },

  updater: {
    checkForUpdate: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:status'),
    onStatusChange: (
      callback: (status: import('../shared/types/api').UpdateStatus) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: import('../shared/types/api').UpdateStatus
      ): void => {
        callback(status)
      }
      ipcRenderer.on('updater:status', handler)
      return () => {
        ipcRenderer.removeListener('updater:status', handler)
      }
    }
  },

  auth: {
    login: (username: string, password: string) => authDomain.login(username, password),
    logout: () => authDomain.logout(),
    currentUser: () => authDomain.currentUser(),
    isAccountsEnabled: () => authDomain.isAccountsEnabled(),
    createUser: (username: string, displayName: string, tempPassword: string) =>
      authDomain.createUser(username, displayName, tempPassword),
    listUsers: () => authDomain.listUsers(),
    deactivateUser: (username: string) => authDomain.deactivateUser(username),
    resetPassword: (username: string, newPassword: string) =>
      authDomain.resetPassword(username, newPassword),
    changePassword: (oldPassword: string, newPassword: string) =>
      authDomain.changePassword(oldPassword, newPassword)
  } as WindowAPI['auth'],

  analysisGroups: {
    list: () => analysisGroupsDomain.list(),
    get: (id: number) => analysisGroupsDomain.get(id),
    create: (params: { name: string; groupType?: string; description?: string }) =>
      analysisGroupsDomain.create(params),
    update: (id: number, params: { name?: string; description?: string }) =>
      analysisGroupsDomain.update(id, params),
    delete: (id: number) => analysisGroupsDomain.delete(id),
    addMember: (params: {
      groupId: number
      caseId: number
      role: string
      affectedStatus?: string
      individualId?: string
    }) => analysisGroupsDomain.addMember(params),
    removeMember: (groupId: number, caseId: number) =>
      analysisGroupsDomain.removeMember(groupId, caseId),
    getForCase: (caseId: number) => analysisGroupsDomain.getForCase(caseId)
  } as WindowAPI['analysisGroups'],

  protein: {
    getMapping: (geneSymbol: string) => proteinDomain.getMapping(geneSymbol),
    getDomains: (uniprotAccession: string) => proteinDomain.getDomains(uniprotAccession),
    getStructure: (uniprotAccession: string) => proteinDomain.getStructure(uniprotAccession),
    getGeneStructure: (geneSymbol: string) => proteinDomain.getGeneStructure(geneSymbol)
  },

  gnomad: {
    getVariants: (geneSymbol: string, dataset?: string) =>
      gnomadDomain.getVariants(geneSymbol, dataset),
    getClinVarVariants: (geneSymbol: string, dataset?: string) =>
      gnomadDomain.getClinVarVariants(geneSymbol, dataset)
  },

  perf: {
    reportInteractive: () => ipcRenderer.send('perf:interactive'),
    getSnapshot: async () => {
      const [mainSnapshot, rendererSnapshot] = await Promise.all([
        ipcRenderer.invoke('perf:mainSnapshot') as Promise<MainPerfSnapshot>,
        requestRendererPerfSnapshot('get')
      ])

      return {
        capturedAt: new Date().toISOString(),
        main: mainSnapshot,
        renderer: rendererSnapshot
      }
    },
    resetSnapshot: async () => {
      await requestRendererPerfSnapshot('reset')
    },
    isEnabled: () => process.env.VARLENS_PERF_MODE === '1'
  } as WindowAPI['perf'],

  presets: {
    list: () => filterPresetsDomain.list(),
    create: (params: FilterPresetCreate) => filterPresetsDomain.create(params),
    update: (id: number, updates: FilterPresetUpdate) => filterPresetsDomain.update(id, updates),
    delete: (id: number) => filterPresetsDomain.delete(id),
    reorder: (items: FilterPresetReorderItem[]) => filterPresetsDomain.reorder(items)
  } as WindowAPI['presets']
}

type RendererPerfRequestAction = 'get' | 'reset'

function requestRendererPerfSnapshot(action: RendererPerfRequestAction): Promise<unknown> {
  return new Promise((resolve) => {
    const requestId = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const handleResponse = (event: Event) => {
      const customEvent = event as CustomEvent<{ id: string; payload: unknown }>
      if (customEvent.detail?.id !== requestId) return
      window.removeEventListener('varlens:perf-response', handleResponse as EventListener)
      resolve(customEvent.detail.payload)
    }

    window.addEventListener('varlens:perf-response', handleResponse as EventListener)
    window.dispatchEvent(
      new CustomEvent('varlens:perf-request', {
        detail: {
          id: requestId,
          action
        }
      })
    )
  })
}

// Expose to renderer via contextBridge (secure)
if (process.contextIsolated === true) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    // Console is the only option in preload context (no access to mainLogger/Electron main process)
    console.error('Failed to expose API via contextBridge:', error)
  }
} else {
  // Fallback for non-isolated context (development/testing)
  // @ts-expect-error - window.api defined in global declaration
  window.api = api
}
