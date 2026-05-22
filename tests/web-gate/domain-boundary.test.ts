import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

const ROOT = process.cwd()

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]).filter(Boolean))]
}

function dispatcherDomains(text: string): string[] {
  return uniqueMatches(text, /['"]([a-z][a-z0-9-]*):[A-Za-z][A-Za-z0-9]*['"]/gu).filter(
    (domain) => domain !== 'node'
  )
}

describe('web domain file boundaries', () => {
  test('runtime route override files own at most one dispatcher domain', () => {
    const routesDir = resolve(ROOT, 'src/web/server/routes')
    const excluded = new Set([
      'common.ts',
      'openapi-paths.ts',
      'openapi-reference-paths.ts',
      'openapi-utils.ts',
      'page-gate.ts',
      'server-path-import.ts',
      'static.ts',
      'types.ts'
    ])

    for (const file of readdirSync(routesDir)) {
      const path = join(routesDir, file)
      if (!file.endsWith('.ts') || excluded.has(file) || statSync(path).isDirectory()) continue

      const domains = dispatcherDomains(readText(path))
      expect(domains, relative(ROOT, path)).toHaveLength(domains.length > 0 ? 1 : 0)
    }
  })

  test('OpenAPI domain builders document one concrete API domain per file', () => {
    const dirs = [
      resolve(ROOT, 'src/web/server/routes/openapi-paths'),
      resolve(ROOT, 'src/web/server/routes/openapi-reference-paths')
    ]
    const excluded = new Set(['operation.ts'])

    for (const file of dirs.flatMap(listFiles)) {
      if (!file.endsWith('.ts') || excluded.has(basename(file))) continue

      const domains = uniqueMatches(readText(file), /['"]\/api\/([^/'"]+)\//gu)
      expect(domains, relative(ROOT, file)).toHaveLength(domains.length > 0 ? 1 : 0)
    }
  })

  test('shared API schema files expose one invoke-body domain per file', () => {
    const schemasDir = resolve(ROOT, 'src/shared/api/schemas')

    for (const file of readdirSync(schemasDir)) {
      const path = join(schemasDir, file)
      if (!file.endsWith('.ts') || statSync(path).isDirectory()) continue

      const schemaExports = uniqueMatches(
        readText(path),
        /export const ([A-Za-z]+)InvokeBodySchemas/gu
      )
      expect(schemaExports, relative(ROOT, path)).toHaveLength(schemaExports.length > 0 ? 1 : 0)
    }
  })

  test('shared API schemas do not keep cross-domain umbrella modules', () => {
    const schemasDir = resolve(ROOT, 'src/shared/api/schemas')
    const forbiddenUmbrellas = ['assets.ts', 'reference.ts']
    const present = forbiddenUmbrellas.filter((file) => existsSync(join(schemasDir, file)))

    expect(present).toEqual([])
  })
})
