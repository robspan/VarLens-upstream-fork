import { describe, expect, test } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import { makeDeps } from './helpers/dispatcher-adapters'

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
