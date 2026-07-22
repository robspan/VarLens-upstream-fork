import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { isReadTaskType, isWriteTaskType } from '../../src/web/server/task-types'
import { makeDeps } from './helpers/dispatcher-adapters'

const ROOT = process.cwd()
const ANNOTATION_BUNDLE_METHOD = 'startAnnotationBundle'
const ANNOTATION_BUNDLE_CHANNEL = `import:${ANNOTATION_BUNDLE_METHOD}`
const EXECUTABLE_SOURCE_EXTENSION = /\.(?:(?:c|m)?(?:j|t)sx?|vue)$/u

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function productionSourceFiles(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return productionSourceFiles(path)
    return entry.isFile() && EXECUTABLE_SOURCE_EXTENSION.test(entry.name) ? [path] : []
  })
}

describe('single-database web runtime boundary', () => {
  test('does not ship the rejected topology or manifest modules', () => {
    for (const path of [
      'src/web/hosted-user-db-router.ts',
      'src/web/topology.ts',
      'src/web/sync-public-annotations.ts',
      'src/web/public-annotation-bundle-records.ts',
      'src/shared/annotations/annotation-bundle.ts',
      'src/shared/annotations/public-snapshot.ts'
    ]) {
      expect(existsSync(resolve(ROOT, path)), `${path} must not be shipped`).toBe(false)
    }
  })

  test('has no production caller or task route for the annotation-bundle channel', () => {
    const productionCallers = productionSourceFiles('src').filter((path) =>
      source(path).includes(ANNOTATION_BUNDLE_METHOD)
    )

    expect(productionCallers).toEqual([])
    expect(isReadTaskType(ANNOTATION_BUNDLE_CHANNEL)).toBe(false)
    expect(isWriteTaskType(ANNOTATION_BUNDLE_CHANNEL)).toBe(false)
  })

  test('assembled dispatcher rejects annotation bundles and keeps normal imports reachable', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    const { overrides } = buildDispatcher(deps)
    registerDispatcher(app, deps, overrides)

    try {
      expect(overrides).toHaveProperty('import:start')
      expect(overrides).toHaveProperty('import:startMultiFile')
      expect(overrides).not.toHaveProperty(ANNOTATION_BUNDLE_CHANNEL)

      const bundle = await app.inject({
        method: 'POST',
        url: '/api/import/startAnnotationBundle',
        payload: { args: ['web-upload:bundle/manifest.json', 'Case A'] }
      })
      const singleFile = await app.inject({
        method: 'POST',
        url: '/api/import/start',
        payload: { args: [] }
      })
      const multiFile = await app.inject({
        method: 'POST',
        url: '/api/import/startMultiFile',
        payload: { args: [] }
      })

      expect(bundle.statusCode).toBe(404)
      expect(bundle.json()).toMatchObject({
        code: 'NOT_FOUND',
        details: { domain: 'import', method: 'startAnnotationBundle' }
      })
      expect(singleFile.statusCode).toBe(400)
      expect(multiFile.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  test('builds one local-subject helper and no database provisioning or annotation sync command', () => {
    const buildConfig = source('vite.web.config.ts')
    const dockerfile = source('Dockerfile')

    expect(buildConfig).toContain("'provision-platform-user'")
    expect(buildConfig).not.toContain("'provision-user'")
    expect(buildConfig).not.toContain('sync-public-annotations')
    expect(dockerfile).toContain('out/web/provision-platform-user.cjs')
    expect(dockerfile).not.toContain('out/web/provision-user.cjs')
  })

  test('server has no active hosted topology or separate annotation database variables', () => {
    const server = source('src/web/server.ts')
    for (const rejected of [
      'VARLENS_WEB_DB_TOPOLOGY',
      'VARLENS_CONTROL_STATE_PG_URL',
      'VARLENS_PUBLIC_ANNOTATION_PG_URL',
      'HostedUserDbRouter'
    ]) {
      expect(server).not.toContain(rejected)
    }
    expect(server).toContain('getPostgresStorageConfig(process.env)')
  })
})
