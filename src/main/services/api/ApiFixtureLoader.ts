import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const API_FIXTURE_DIR_ENV = 'VARLENS_API_FIXTURES_DIR'
const API_FIXTURE_ALLOW_ENV = 'VARLENS_ALLOW_API_FIXTURES'

export function apiFixturesEnabled(): boolean {
  const root = process.env[API_FIXTURE_DIR_ENV]
  return process.env[API_FIXTURE_ALLOW_ENV] === '1' && root !== undefined && root.trim() !== ''
}

export function readApiFixture(relativePath: string): unknown | null {
  if (!apiFixturesEnabled()) return null
  const root = process.env[API_FIXTURE_DIR_ENV]
  if (root === undefined || root.trim() === '') return null

  const rootPath = resolve(root)
  const path = resolve(rootPath, relativePath)
  const pathFromRoot = relative(rootPath, path)
  if (
    pathFromRoot === '' ||
    pathFromRoot.startsWith('..') ||
    isAbsolute(pathFromRoot) ||
    relativePath.includes('\0')
  ) {
    throw new Error('API fixture path escapes fixture root')
  }
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function apiFixturePath(parts: string[]): string {
  return parts.join('/')
}
