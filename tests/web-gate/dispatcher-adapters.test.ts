import { describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import {
  buildDispatcher,
  registerDispatcher,
  type DispatcherDeps
} from '../../src/web/server/dispatcher'
import type { StorageReadTask } from '../../src/main/storage/read-executor'

function makeDeps(): {
  deps: DispatcherDeps
  execute: ReturnType<typeof vi.fn>
  writeExecute: ReturnType<typeof vi.fn>
  importSingleFile: ReturnType<typeof vi.fn>
  importMultiFile: ReturnType<typeof vi.fn>
  reply: { code: ReturnType<typeof vi.fn> }
} {
  const execute = vi.fn(async (task: StorageReadTask) => ({ task }))
  const writeExecute = vi.fn(async (task: unknown) => ({ task }))
  const importSingleFile = vi.fn(async () => ({
    caseId: 11,
    variantCount: 2,
    skipped: 0,
    errors: [],
    elapsed: 12
  }))
  const importMultiFile = vi.fn(async () => ({
    caseId: 11,
    variantCount: 2,
    skipped: 0,
    errors: [],
    files: [],
    elapsed: 12
  }))
  const isAccountsEnabled = vi.fn(async () => false)
  const createUser = vi.fn(async () => ({ id: 2, username: 'analyst' }))
  const listUsers = vi.fn(async () => [{ id: 1, username: 'admin', role: 'admin' }])
  const deactivateUser = vi.fn(async () => undefined)
  const resetPassword = vi.fn(async () => undefined)
  const publish = vi.fn()
  const deps = {
    session: {
      capabilities: { backend: 'postgres' },
      getReadExecutor: () => ({ execute }),
      getWriteExecutor: () => ({ execute: writeExecute }),
      getImportExecutor: () => ({ importSingleFile, importMultiFile, cancel: vi.fn() }),
      listCases: vi.fn(async () => [{ id: 1, name: 'Case A' }]),
      health: vi.fn()
    },
    authService: {
      isAccountsEnabled,
      createUser,
      listUsers,
      deactivateUser,
      resetPassword
    },
    events: {
      publish
    }
  } as unknown as DispatcherDeps
  return {
    deps,
    execute,
    writeExecute,
    importSingleFile,
    importMultiFile,
    reply: { code: vi.fn() }
  }
}

describe('web dispatcher adapters', () => {
  test('variants.query adapts renderer/preload args to the storage task shape', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:query'].handle(
      [
        7,
        { consequences: ['HIGH'], chr: 'chr22' },
        20,
        10,
        [{ key: 'pos', order: 'desc' }],
        true,
        true
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [
        { case_id: 7, consequences: ['HIGH'], chr: 'chr22' },
        10,
        20,
        [{ key: 'pos', order: 'desc' }],
        true,
        true
      ]
    })
  })

  test('variants.query applies desktop IPC defaults for omitted optional args', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:query'].handle([7, {}], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [{ case_id: 7 }, 50, 0, undefined, false, false]
    })
  })

  test('variants.getFilterOptions maps the preload method name to variants:filterOptions', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:getFilterOptions'].handle([7], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:filterOptions',
      params: [7]
    })
  })

  test('variants.search keeps the legacy non-number limit fallback', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce({ data: [{ id: 1, gene_symbol: 'BRCA1' }], total_count: 1 })
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['variants:search'].handle(
      [7, 'BRCA', '10'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, gene_symbol: 'BRCA1' }])
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [{ case_id: 7, gene_symbol: 'BRCA' }, 20, 0, undefined, true, false]
    })
  })

  test('variants.columnMeta preserves caseId precedence when both scopes are present', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:columnMeta'].handle(
      [{ caseId: 7, caseIds: ['ignored'], columnKey: 'cadd' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:columnMeta',
      params: [{ caseId: 7 }, 'cadd']
    })
  })

  test('variants.query rejects invalid renderer args before storage execution', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['variants:query'].handle(
      [0, {}, 0, 50],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'invalid-case-id', message: 'Invalid case ID' })
    expect(execute).not.toHaveBeenCalled()
  })

  test('transcripts.list delegates to the storage read executor', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce([{ id: 1, transcript_id: 'NM_000059.4' }])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['transcripts:list'].handle(
      [9],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, transcript_id: 'NM_000059.4' }])
    expect(execute).toHaveBeenCalledWith({ type: 'transcripts:list', params: [9] })
  })

  test('transcripts.switch maps renderer args to the storage write task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['transcripts:switch'].handle(
      [9, 'NM_000059.4'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'transcripts:switch',
      params: [9, 'NM_000059.4']
    })
  })

  test('transcripts.insertAndSwitch maps renderer args to the storage write task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const transcript = {
      transcript_id: 'NM_000059.4',
      gene_symbol: 'BRCA2',
      consequence: 'HIGH',
      cdna: 'c.1A>G',
      aa_change: 'p.M1V',
      hpo_sim_score: 0.8,
      moi: 'AD',
      is_selected: 0
    }

    await overrides['transcripts:insertAndSwitch'].handle(
      [9, transcript],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'transcripts:insertAndSwitch',
      params: [9, transcript]
    })
  })

  test('dispatcher normalizes non-2xx override payloads to SerializableError', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerDispatcher(app, deps, {
      'variants:query': {
        async handle(_args, _request, reply) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/variants/query',
      payload: { args: [0, {}] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      code: 'UNKNOWN',
      message: 'Invalid case ID',
      userMessage: 'Invalid case ID',
      details: { error: 'invalid-case-id', message: 'Invalid case ID' }
    })
    await app.close()
  })

  test('dispatcher normalizes thrown errors to SerializableError', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerDispatcher(app, deps, {
      'variants:query': {
        async handle() {
          throw new Error('database unavailable')
        }
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/variants/query',
      payload: { args: [1, {}] }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      code: 'UNKNOWN',
      message: 'database unavailable',
      userMessage: 'An unexpected error occurred. Please try again.'
    })
    await app.close()
  })

  test('panels.get returns the desktop panel-plus-genes shape', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce({ id: 5, name: 'Cancer panel' })
    execute.mockResolvedValueOnce([{ symbol: 'BRCA1', hgnc_id: 'HGNC:1100' }])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['panels:get'].handle([5], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: 5,
      name: 'Cancer panel',
      genes: [{ symbol: 'BRCA1', hgnc_id: 'HGNC:1100' }]
    })
    expect(execute).toHaveBeenNthCalledWith(1, { type: 'panels:get', params: [5] })
    expect(execute).toHaveBeenNthCalledWith(2, { type: 'panels:getGenes', params: [5] })
  })

  test('panels.update maps renderer object args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['panels:update'].handle(
      [{ id: 5, name: 'Updated panel', description: null }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'panels:update',
      params: [5, { name: 'Updated panel', description: null, version: undefined }]
    })
  })

  test('database.info returns a safe web workspace identity for renderer startup', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:info'].handle([], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      path: 'web:postgres',
      name: 'VarLens Web',
      encrypted: false
    })
  })

  test('cases.list delegates to the web storage session', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cases:list'].handle([], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, name: 'Case A' }])
    expect(deps.session.listCases).toHaveBeenCalledTimes(1)
  })

  test('cohort.getVariants maps preload method name to cohort:query', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['cohort:getVariants'].handle(
      [{ limit: 25, offset: 10, search_term: 'BRCA1', sort_order: 'desc' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:query',
      params: [{ limit: 25, offset: 10, search_term: 'BRCA1', sort_order: 'desc' }]
    })
  })

  test('cohort.getVariants rejects invalid renderer args before storage execution', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:getVariants'].handle(
      [{ limit: -1 }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({
      error: 'invalid-cohort-params',
      message: 'Invalid cohort search parameters'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('cohort read helpers map preload method names to storage task names', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['cohort:getSummary'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getColumnMeta'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getGeneBurden'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getCarriers'].handle(
      ['chr22', 12345, 'A', 'T'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:summary', params: [] })
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:columnMeta', params: [] })
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:geneBurden', params: [] })
    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:carriers',
      params: ['chr22', 12345, 'A', 'T']
    })
  })

  test('database.recentList returns an empty desktop-file list in web mode', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:recentList'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  test('database.capabilities overlays browser-only unsupported features', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:capabilities'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      backend: 'postgres',
      export: { variants: false, cohort: false, streaming: false }
    })
  })

  test('web-only unsupported cohort actions fail explicitly', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:runAssociation'].handle(
      [{}],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'cohort.runAssociation',
      message: 'cohort.runAssociation is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('reference API fixture-backed methods fail explicitly when fixtures are disabled', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['hpo:search'].handle(['BRCA'], {} as never, reply as never, deps)

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'hpo.search',
      message: 'hpo.search is not available in web mode yet.'
    })
  })

  test('annotations.upsertGlobal delegates annotation and audit to one storage task', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertGlobal'].handle(
      [
        'chr22',
        12345,
        'A',
        'T',
        {
          acmg_classification: 'VUS',
          starred: true,
          user_name: 'admin'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      task: {
        type: 'annotations:upsertGlobalWithAudit',
        params: [
          { chr: 'chr22', pos: 12345, ref: 'A', alt: 'T' },
          { acmg_classification: 'Uncertain significance', starred: true, user_name: 'admin' }
        ]
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('annotations.upsertGlobal rejects non-canonical ACMG casing like desktop IPC', async () => {
    const { deps, execute, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertGlobal'].handle(
      [
        'chr22',
        12345,
        'A',
        'T',
        {
          acmg_classification: 'PATHOGENIC'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'invalid-annotation-upsert' })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test('annotations.upsertPerCase normalizes ACMG shorthand before audited storage write', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertPerCase'].handle(
      [3, 9, { acmg_classification: 'LP', user_name: 'reviewer' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      task: {
        type: 'annotations:upsertPerCaseWithAudit',
        params: [3, 9, { acmg_classification: 'Likely pathogenic', user_name: 'reviewer' }]
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('case-metadata.createCohort maps renderer args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['case-metadata:createCohort'].handle(
      ['Rare Cases', 12],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:createCohort',
      params: [{ name: 'Rare Cases', description: null }]
    })
  })

  test('analysis-groups.create preserves web defaults for optional fields', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['analysis-groups:create'].handle(
      [{ name: 'Trio A', groupType: 'unsupported', description: 'family review' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'analysis-groups:create',
      params: ['Trio A', 'family', 'family review']
    })
  })

  test('analysis-groups.addMember maps member args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['analysis-groups:addMember'].handle(
      [
        {
          groupId: 2,
          caseId: 7,
          role: 'proband',
          affectedStatus: 'affected',
          individualId: 'P1'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'analysis-groups:addMember',
      params: [2, 7, 'proband', 'affected', 'P1']
    })
  })

  test('region-files.importBed reads BED rows before writing the import task', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const dir = await mkdtemp(join(tmpdir(), 'varlens-bed-'))

    try {
      const filePath = join(dir, 'regions.bed')
      await writeFile(filePath, 'chr1\t0\t10\tRegionA\n# ignored\nchr2\t5\t9\n')

      await overrides['region-files:importBed'].handle(
        [4, filePath],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'region-files:importBed',
        params: [
          4,
          [
            { chr: 'chr1', start: 0, end: 10, label: 'RegionA' },
            { chr: 'chr2', start: 5, end: 9 }
          ]
        ]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('region-files.importBed is disabled outside test mode unless operator enables server-path import', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'production'
    delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    try {
      const { deps, writeExecute, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['region-files:importBed'].handle(
        [4, '/tmp/regions.bed'],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
      expect(writeExecute).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('gene-lists.setGenes writes genes and returns the refreshed list', async () => {
    const { deps, execute, writeExecute, reply } = makeDeps()
    execute.mockResolvedValueOnce(['BRCA1', 'TP53'])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['gene-lists:setGenes'].handle(
      [3, ['BRCA1', 'TP53']],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'gene-lists:setGenes',
      params: [3, ['BRCA1', 'TP53']]
    })
    expect(execute).toHaveBeenCalledWith({
      type: 'gene-lists:getGenes',
      params: [3]
    })
    expect(result).toEqual(['BRCA1', 'TP53'])
  })

  test('cohort.getSummaryStatus returns a stable non-rebuild status for web Postgres', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:getSummaryStatus'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({ is_stale: false, last_rebuilt_at: 0 })
  })

  test('browser-incompatible exports fail explicitly instead of returning row streams', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['export:variants'].handle(
      [{ case_id: 7 }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'export.variants',
      message: 'export.variants is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('browser-incompatible cohort exports fail explicitly instead of returning row streams', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['export:cohort'].handle([{}], {} as never, reply as never, deps)

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'export.cohort',
      message: 'export.cohort is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('auth.isAccountsEnabled delegates to the web auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['auth:isAccountsEnabled'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toBe(false)
    expect(deps.authService.isAccountsEnabled).toHaveBeenCalledTimes(1)
  })

  test('import.start is disabled outside test mode unless operator enables server-path import', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'production'
    delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A'],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
      expect(importSingleFile).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('batch import zip extraction is disabled outside test mode unless explicitly enabled', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'production'
    delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    try {
      const { deps, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['batch-import:extractZip'].handle(
        ['/tmp/input.zip'],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('import.start routes an enabled absolute server path through shared import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A', { genomeBuild: 'hg38' }],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(result).toMatchObject({ caseId: 11, variantCount: 2 })
      expect(importSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/tmp/input.vcf',
          caseName: 'Case A',
          vcfOptions: { genomeBuild: 'hg38', selectedSample: undefined }
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('import.start publishes web progress events to the session user', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockImplementationOnce(async (params) => {
        params.onProgress?.({ phase: 'parsing', count: 5 })
        return {
          caseId: 11,
          variantCount: 2,
          skipped: 0,
          errors: [],
          elapsed: 12
        }
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A'],
        request as never,
        reply as never,
        deps
      )

      expect(deps.events.publish).toHaveBeenCalledWith(7, 'import:progress', {
        phase: 'parsing',
        count: 5
      })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('import.startMultiFile preserves object filter payloads for import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const { deps, importMultiFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['import:startMultiFile'].handle(
        [
          'Case A',
          [
            {
              filePath: '/tmp/input.vcf',
              variantType: 'snv',
              caller: 42,
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          { bedPadding: 'legacy-string' }
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(importMultiFile).toHaveBeenCalledWith(
        expect.objectContaining({
          caseName: 'Case A',
          files: [
            {
              filePath: '/tmp/input.vcf',
              variantType: 'snv',
              caller: null,
              annotationFormat: null
            }
          ],
          vcfOptions: { genomeBuild: 'hg38', selectedSample: undefined },
          filters: expect.objectContaining({ bedPadding: 'legacy-string' })
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('auth.listUsers requires an admin session and calls the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:listUsers'].handle(
      [],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, username: 'admin', role: 'admin' }])
    expect(deps.authService.listUsers).toHaveBeenCalledTimes(1)
  })

  test('auth.createUser rejects non-admin sessions at the web boundary', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 2, username: 'user', role: 'user' } } }

    const result = await overrides['auth:createUser'].handle(
      ['analyst', 'Analyst', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(403)
    expect(result).toEqual({ error: 'admin-required' })
    expect(deps.authService.createUser).not.toHaveBeenCalled()
  })

  test('auth.createUser is disabled for admins until user_id scoping ships', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:createUser'].handle(
      ['analyst', 'Analyst', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'multi-user-disabled',
      message:
        'Creating additional web users is disabled until clinical tables are scoped by user_id.'
    })
    expect(deps.authService.createUser).not.toHaveBeenCalled()
  })

  test('auth.deactivateUser rejects self-deactivation before calling the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:deactivateUser'].handle(
      ['admin'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'cannot-deactivate-self' })
    expect(deps.authService.deactivateUser).not.toHaveBeenCalled()
  })
})
