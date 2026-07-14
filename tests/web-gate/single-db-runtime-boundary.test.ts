import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

describe('single-database web runtime boundary', () => {
  test('does not ship the rejected router, topology, or annotation-sync modules', () => {
    for (const path of [
      'src/web/hosted-user-db-router.ts',
      'src/web/topology.ts',
      'src/web/sync-public-annotations.ts',
      'src/web/public-annotation-bundle-records.ts'
    ]) {
      expect(existsSync(resolve(ROOT, path)), `${path} must not be shipped`).toBe(false)
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
