/**
 * Mock API factory for renderer tests.
 *
 * Provides createMockApi() that returns a type-safe mock matching the WindowAPI structure.
 * All methods return vi.fn() mocks with sensible default values.
 */

import { vi } from 'vitest'
import type { WindowAPI } from '../../src/shared/types/api'

type MockApiDomain<T extends Record<string, unknown>> = {
  [K in keyof T]: ReturnType<typeof vi.fn>
}

/**
 * Mock API type matching WindowAPI from preload.
 * All methods are vi.fn() mocks for spy verification.
 */
export type MockApi = {
  cases: MockApiDomain<WindowAPI['cases']>
  variants: MockApiDomain<WindowAPI['variants']>
  import: MockApiDomain<WindowAPI['import']>
  system: MockApiDomain<WindowAPI['system']>
  export: MockApiDomain<WindowAPI['export']>
  shell: MockApiDomain<WindowAPI['shell']>
  database: MockApiDomain<WindowAPI['database']>
  batchImport: MockApiDomain<WindowAPI['batchImport']>
  cohort: MockApiDomain<WindowAPI['cohort']>
  annotations: MockApiDomain<WindowAPI['annotations']>
  vep: MockApiDomain<WindowAPI['vep']>
  hpo: MockApiDomain<WindowAPI['hpo']>
  myvariant: MockApiDomain<WindowAPI['myvariant']>
  spliceai: MockApiDomain<WindowAPI['spliceai']>
  caseMetadata: MockApiDomain<WindowAPI['caseMetadata']>
  tags: MockApiDomain<WindowAPI['tags']>
  presets: MockApiDomain<WindowAPI['presets']>
  panels: MockApiDomain<WindowAPI['panels']>
  geneRef: MockApiDomain<WindowAPI['geneRef']>
  protein: MockApiDomain<WindowAPI['protein']>
  gnomad: MockApiDomain<WindowAPI['gnomad']>
  logs: MockApiDomain<WindowAPI['logs']>
  caseComments: MockApiDomain<WindowAPI['caseComments']>
  caseMetrics: MockApiDomain<WindowAPI['caseMetrics']>
  transcripts: MockApiDomain<WindowAPI['transcripts']>
  geneLists: MockApiDomain<WindowAPI['geneLists']>
  regionFiles: MockApiDomain<WindowAPI['regionFiles']>
  updater: MockApiDomain<WindowAPI['updater']>
  audit: MockApiDomain<WindowAPI['audit']>
  auth: MockApiDomain<WindowAPI['auth']>
  analysisGroups: MockApiDomain<WindowAPI['analysisGroups']>
  perf: MockApiDomain<WindowAPI['perf']>
}

/**
 * Creates a fresh mock API matching WindowAPI structure.
 * All methods return vi.fn() with sensible default values.
 *
 * Usage:
 * ```typescript
 * const mockApi = createMockApi()
 * mockApi.cases.list.mockResolvedValue([])
 * window.api = mockApi
 * ```
 */
export function createMockApi(): MockApi {
  return {
    cases: {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(0),
      deleteBatch: vi.fn().mockResolvedValue(0)
    },

    variants: {
      query: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getFilterOptions: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue([]),
      geneSymbols: vi.fn().mockResolvedValue([])
    },

    import: {
      selectFile: vi.fn().mockResolvedValue(null),
      start: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
      cancel: vi.fn().mockResolvedValue(undefined)
    },

    system: {
      getVersion: vi.fn().mockResolvedValue('0.0.0-test'),
      getUserDataPath: vi.fn().mockResolvedValue('/tmp/test')
    },

    export: {
      variants: vi.fn().mockResolvedValue({ success: true }),
      cohort: vi.fn().mockResolvedValue({ success: true })
    },

    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      updateDomains: vi.fn().mockResolvedValue(undefined),
      showItemInFolder: vi.fn().mockResolvedValue(undefined)
    },

    database: {
      selectFile: vi.fn().mockResolvedValue(null),
      selectSaveLocation: vi.fn().mockResolvedValue(null),
      open: vi.fn().mockResolvedValue({ success: true }),
      create: vi.fn().mockResolvedValue({ success: true }),
      rekey: vi.fn().mockResolvedValue({ success: true }),
      info: vi.fn().mockResolvedValue({ path: '/tmp/test.db', encrypted: false }),
      recentList: vi.fn().mockResolvedValue([])
    },

    batchImport: {
      selectFiles: vi.fn().mockResolvedValue([]),
      selectFolder: vi.fn().mockResolvedValue(null),
      checkDuplicates: vi.fn().mockResolvedValue({ duplicates: [], unique: [] }),
      start: vi.fn().mockResolvedValue({ success: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      selectZip: vi.fn().mockResolvedValue(null),
      testZipPassword: vi.fn().mockResolvedValue({ valid: true }),
      extractZip: vi.fn().mockResolvedValue([]),
      cleanupZipTemp: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn(() => vi.fn()), // Returns cleanup function
      onComplete: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    cohort: {
      getVariants: vi.fn().mockResolvedValue({ data: [], total_count: 0 }),
      getSummary: vi.fn().mockResolvedValue({ totalCases: 0, totalVariants: 0 }),
      getCarriers: vi.fn().mockResolvedValue([]),
      getGeneBurden: vi.fn().mockResolvedValue([]),
      runAssociation: vi.fn().mockResolvedValue({ results: [], warnings: [] }),
      cancelAssociation: vi.fn().mockResolvedValue(undefined),
      onAssociationProgress: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    annotations: {
      getGlobal: vi.fn().mockResolvedValue(null),
      upsertGlobal: vi.fn().mockResolvedValue(undefined),
      deleteGlobal: vi.fn().mockResolvedValue(undefined),
      getPerCase: vi.fn().mockResolvedValue(null),
      upsertPerCase: vi.fn().mockResolvedValue(undefined),
      deletePerCase: vi.fn().mockResolvedValue(undefined),
      getForVariant: vi.fn().mockResolvedValue({ global: null, perCase: null }),
      batchGet: vi.fn().mockResolvedValue({})
    },

    vep: {
      fetch: vi.fn().mockResolvedValue(null),
      cancel: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      getCacheStats: vi.fn().mockResolvedValue({ count: 0, size: 0 })
    },

    hpo: {
      search: vi.fn().mockResolvedValue([]),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    myvariant: {
      fetch: vi.fn().mockResolvedValue(null),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    spliceai: {
      fetch: vi.fn().mockResolvedValue(null),
      clearCache: vi.fn().mockResolvedValue(undefined)
    },

    caseMetadata: {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      getFullMetadata: vi.fn().mockResolvedValue(null),
      listCohorts: vi.fn().mockResolvedValue([]),
      createCohort: vi.fn().mockResolvedValue({ id: 1 }),
      deleteCohort: vi.fn().mockResolvedValue(undefined),
      getCohortByName: vi.fn().mockResolvedValue(null),
      getCaseCohorts: vi.fn().mockResolvedValue([]),
      assignCohort: vi.fn().mockResolvedValue(undefined),
      removeCohort: vi.fn().mockResolvedValue(undefined),
      setCohorts: vi.fn().mockResolvedValue(undefined),
      getHpoTerms: vi.fn().mockResolvedValue([]),
      assignHpoTerm: vi.fn().mockResolvedValue(undefined),
      removeHpoTerm: vi.fn().mockResolvedValue(undefined)
    },

    tags: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getUsageCount: vi.fn().mockResolvedValue(0),
      getVariantTags: vi.fn().mockResolvedValue([]),
      assignVariantTag: vi.fn().mockResolvedValue(undefined),
      removeVariantTag: vi.fn().mockResolvedValue(undefined),
      setVariantTags: vi.fn().mockResolvedValue(undefined)
    },

    presets: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      reorder: vi.fn().mockResolvedValue(undefined)
    },

    panels: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue({ success: true }),
      duplicate: vi.fn().mockResolvedValue({ id: 2 }),
      setGenes: vi.fn().mockResolvedValue(undefined),
      getGenes: vi.fn().mockResolvedValue([]),
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      activeForCase: vi.fn().mockResolvedValue([]),
      validateSymbols: vi.fn().mockResolvedValue([]),
      autocomplete: vi.fn().mockResolvedValue([]),
      exportBed: vi.fn().mockResolvedValue({ success: true })
    },

    geneRef: {
      info: vi.fn().mockResolvedValue({
        geneCount: 44983,
        aliasCount: 100000,
        coordinateCount: 80000,
        assemblies: ['GRCh37', 'GRCh38'],
        builtAt: Math.floor(Date.now() / 1000)
      }),
      assemblies: vi.fn().mockResolvedValue([]),
      checkUpdates: vi
        .fn()
        .mockResolvedValue({ currentBuiltAt: 0, daysSinceBuilt: 0, needsUpdate: false }),
      update: vi.fn().mockResolvedValue({ success: true, message: 'Updated' })
    },

    protein: {
      getMapping: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getDomains: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getStructure: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getGeneStructure: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' })
    },

    gnomad: {
      getVariants: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' }),
      getClinVarVariants: vi.fn().mockResolvedValue({ success: false, error: 'Not mocked' })
    },

    logs: {
      onMessage: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    caseComments: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },

    caseMetrics: {
      listDefinitions: vi.fn().mockResolvedValue([]),
      createDefinition: vi.fn().mockResolvedValue({ id: 1 }),
      listForCase: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },

    transcripts: {
      list: vi.fn().mockResolvedValue([]),
      switch: vi.fn().mockResolvedValue(undefined),
      insertAndSwitch: vi.fn().mockResolvedValue(undefined)
    },

    geneLists: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      delete: vi.fn().mockResolvedValue(undefined),
      getGenes: vi.fn().mockResolvedValue([]),
      setGenes: vi.fn().mockResolvedValue(undefined)
    },

    regionFiles: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      delete: vi.fn().mockResolvedValue(undefined),
      importBed: vi.fn().mockResolvedValue({ success: true })
    },

    updater: {
      checkForUpdate: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      onStatusChange: vi.fn(() => vi.fn()) // Returns cleanup function
    },

    audit: {
      getByEntity: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([])
    },

    auth: {
      login: vi.fn().mockResolvedValue({ success: true }),
      logout: vi.fn().mockResolvedValue(undefined),
      currentUser: vi.fn().mockResolvedValue(null),
      isAccountsEnabled: vi.fn().mockResolvedValue(false),
      createUser: vi.fn().mockResolvedValue(undefined),
      listUsers: vi.fn().mockResolvedValue([]),
      deactivateUser: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
      changePassword: vi.fn().mockResolvedValue(undefined)
    },

    analysisGroups: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      addMember: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      getForCase: vi.fn().mockResolvedValue([])
    },

    perf: {
      reportInteractive: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue({
        capturedAt: new Date().toISOString(),
        main: { elapsedMs: 0, milestones: {} },
        renderer: {
          traces: [],
          longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 }
        }
      }),
      resetSnapshot: vi.fn().mockResolvedValue(undefined),
      isEnabled: vi.fn().mockReturnValue(false)
    }
  }
}
