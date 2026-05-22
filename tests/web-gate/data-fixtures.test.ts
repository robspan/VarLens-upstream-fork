import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const manifestPath = resolve(process.cwd(), 'scripts/data-fixtures/sources.json')

interface FixtureManifest {
  schemaVersion: number
  cacheRoot: string
  fixtures: Array<{
    id: string
    enabledByDefault?: boolean
    source: {
      kind: 'local' | 'local-set' | 'remote'
      path?: string
      url?: string
      sha256?: string
      files?: Array<{ sha256?: string }>
    }
    transforms?: Array<{
      type: string
      output?: string
      outputs?: Record<string, string>
      sha256?: string
      files?: Array<{ output: string; sha256?: string }>
      outputChecksums?: Record<string, { sha256?: string }>
    }>
    expectedCoverage?: string[]
  }>
}

async function runScript(script: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  })
  return stdout
}

describe('web parity data fixture scripts', () => {
  test('manifest has typed default fixture contracts', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.cacheRoot).toBe('tests/.cache/public-data')

    const defaultFixtures = manifest.fixtures.filter((fixture) => fixture.enabledByDefault === true)
    expect(defaultFixtures.length).toBeGreaterThan(0)
    for (const fixture of defaultFixtures) {
      expect(fixture.id).toMatch(/^[a-z0-9-]+$/)
      expect(fixture.source.kind).toMatch(/^(local|local-set|remote)$/)
      if (fixture.source.kind === 'local-set') {
        expect(fixture.source.files?.length ?? 0).toBeGreaterThan(0)
        for (const file of fixture.source.files ?? []) {
          expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
        }
      } else {
        expect(fixture.source.sha256).toMatch(/^[a-f0-9]{64}$/)
      }
      expect(fixture.expectedCoverage?.length ?? 0).toBeGreaterThan(0)
      for (const transform of fixture.transforms ?? []) {
        expect(['copy', 'copy-many', 'vcf-to-varlens-json', 'zip']).toContain(transform.type)
        if (transform.type === 'copy') {
          expect(transform.output).toContain('tests/.cache/public-data/generated/')
          expect(transform.sha256).toMatch(/^[a-f0-9]{64}$/)
        } else if (transform.type === 'copy-many') {
          for (const file of transform.files ?? []) {
            expect(file.output).toContain('tests/.cache/public-data/generated/')
            expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
          }
        } else if (transform.type === 'zip') {
          expect(transform.output).toContain('tests/.cache/public-data/generated/')
          expect(transform.sha256).toMatch(/^[a-f0-9]{64}$/)
        } else if (transform.type === 'vcf-to-varlens-json') {
          expect(Object.keys(transform.outputs ?? {}).sort()).toEqual([
            'columnar',
            'object',
            'simple'
          ])
          for (const [shape, output] of Object.entries(transform.outputs ?? {})) {
            expect(output).toContain('tests/.cache/public-data/generated/')
            expect(transform.outputChecksums?.[shape]?.sha256).toMatch(/^[a-f0-9]{64}$/)
          }
        }
      }
    }

    const coverage = new Set(defaultFixtures.flatMap((fixture) => fixture.expectedCoverage ?? []))
    for (const tag of [
      'snv',
      'indel',
      'vcf-unannotated',
      'vcf-csq',
      'vcf-ann',
      'multisample',
      'trio',
      'sv',
      'cnv',
      'str',
      'bed-region-filter',
      'json-simple',
      'json-object',
      'json-columnar',
      'zip-extraction'
    ]) {
      expect(coverage.has(tag), `missing coverage tag ${tag}`).toBe(true)
    }
  })

  test('default gather/prepare/verify flow runs without network', async () => {
    const gather = await runScript('scripts/data-fixtures/download-fixtures.mjs')
    expect(gather).toContain('[data:gather] verified local source local-synthetic-vcf')

    const prepare = await runScript('scripts/data-fixtures/prepare-fixtures.mjs')
    expect(prepare).toContain('[data:prepare] local-synthetic-vcf:copy')
    expect(prepare).toContain('[data:transform] local-synthetic-vcf:to-json')

    const verify = await runScript('scripts/data-fixtures/verify-fixtures.mjs')
    expect(verify).toContain('[data:verify] local-synthetic-vcf')
  })
})
