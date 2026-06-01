import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, test } from 'vitest'

import { jobRunner } from '../../src/main/services/jobs/runner'
import { buildDispatcher } from '../../src/web/server/dispatcher'
import { stageExistingFileUpload } from '../../src/web/server/routes/upload-staging'
import { makeDeps } from './helpers/dispatcher-adapters'

const ZIP_WITH_ONE_JSON_BASE64 =
  'UEsDBBQAAAgIAJRRwVwz5c4EEQAAAA8AAAARAAAAd2ViLXppcC1jYXNlLmpzb26rVkpOLE5Vsl' +
  'IqT01SquUCAFBLAQIUAxQAAAgIAJRRwVwz5c4EEQAAAA8AAAARAAAAAAAAAAAAAACkgQAAAAB3' +
  'ZWItemlwLWNhc2UuanNvblBLBQYAAAAAAQABAD8AAABAAAAAAAA='

describe('web dispatcher adapters: auth and import', () => {
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
      const request = { session: {} }

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A'],
        request as never,
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

  test('batch import zip extraction accepts web upload refs and returns web upload refs', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-zip-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const zipPath = join(tempDir, 'batch.zip')
      await writeFile(zipPath, Buffer.from(ZIP_WITH_ONE_JSON_BASE64, 'base64'))
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'batch.zip',
        sourcePath: zipPath
      })

      const { deps, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:extractZip'].handle(
        [upload.ref],
        request as never,
        reply as never,
        deps
      )) as { files: string[]; errors: string[] }

      expect(reply.code).not.toHaveBeenCalledWith(403)
      expect(result.errors).toEqual([])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toMatch(/^web-upload:/)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('batch-import.start resolves web upload refs and runs through JobRunner-backed import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-batch-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'Case B.json')
      await writeFile(sourcePath, '{}')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'Case B.json',
        sourcePath
      })
      const knownBatchJobs = new Set(jobRunner.list({ kind: 'import_batch' }).map((job) => job.id))
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockImplementationOnce(async (params) => {
        params.onProgress?.({ phase: 'parsing', count: 1, elapsed: 3, skipped: 0 })
        return {
          caseId: 12,
          variantCount: 4,
          skipped: 0,
          errors: [],
          elapsed: 15
        }
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:start'].handle(
        [[upload.ref], 'skip'],
        request as never,
        reply as never,
        deps
      )) as {
        succeeded: number
        failed: number
        skipped: number
        details: Array<{ filePath: string; fileName: string; caseName: string; status: string }>
      }

      expect(reply.code).not.toHaveBeenCalled()
      expect(importSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: upload.storedPath,
          caseName: 'Case B'
        })
      )
      expect(result).toMatchObject({
        succeeded: 1,
        failed: 0,
        skipped: 0,
        details: [
          {
            filePath: upload.ref,
            fileName: 'Case B.json',
            caseName: 'Case B',
            status: 'success',
            variantCount: 4
          }
        ]
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:progress', {
        currentIndex: 1,
        totalFiles: 1,
        currentFileName: 'Case B.json',
        overallPercent: 100,
        fileProgress: { phase: 'parsing', count: 1, elapsed: 3, skipped: 0 }
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:complete', result)

      const newBatchJobs = jobRunner
        .list({ kind: 'import_batch' })
        .filter((job) => !knownBatchJobs.has(job.id))
      expect(newBatchJobs).toHaveLength(1)
      const newBatchJob = newBatchJobs[0]
      expect(newBatchJob).toBeDefined()
      if (newBatchJob === undefined) throw new Error('expected batch job to be tracked')
      expect(newBatchJob).toMatchObject({ kind: 'import_batch', status: 'completed' })
      const params = newBatchJob.params as {
        files: Array<{ inputPath: string; storedPath: string }>
        duplicateStrategy: string
      }
      expect(params.duplicateStrategy).toBe('skip')
      const paramFile = params.files[0]
      expect(paramFile).toBeDefined()
      expect(paramFile).toMatchObject({
        inputPath: upload.ref,
        storedPath: upload.storedPath
      })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('import.start routes an enabled absolute server path through shared import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A', { genomeBuild: 'hg38' }],
        request as never,
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

  test('import.startMultiFile normalizes valid object filter payloads for import logic', async () => {
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
          { bedPadding: 10, passOnly: true, minQual: 30, minGq: null }
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
          filters: expect.objectContaining({
            bedPadding: 10,
            passOnly: true,
            minQual: 30,
            minGq: null
          })
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('import.startMultiFile rejects malformed filter payloads before import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const { deps, importMultiFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['import:startMultiFile'].handle(
        [
          'Case A',
          [
            {
              filePath: '/tmp/input.vcf',
              variantType: 'snv',
              caller: 'caller',
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          { minQual: '30', passOnly: 'true' }
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(400)
      expect(result).toEqual({
        error: 'invalid-filters',
        message: 'filters must match the import filter schema'
      })
      expect(importMultiFile).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('import.startMultiFile treats null filter payloads as absent', async () => {
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
              caller: 'caller',
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          null
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(importMultiFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: undefined
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

  test('auth.createUser is disabled for admins in single-tenant web mode', async () => {
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
      message: 'Creating additional web users is disabled for this single-tenant release.'
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

  test('auth.resetPassword rejects self-reset before calling the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:resetPassword'].handle(
      ['admin', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'cannot-reset-self' })
    expect(deps.authService.resetPassword).not.toHaveBeenCalled()
  })
})
