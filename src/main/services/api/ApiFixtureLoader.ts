import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_FIXTURE_DIR_ENV = 'VARLENS_API_FIXTURES_DIR'

export function readApiFixture(relativePath: string): unknown | null {
  const root = process.env[API_FIXTURE_DIR_ENV]
  if (root === undefined || root.trim() === '') return null

  const path = resolve(root, relativePath)
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function apiFixturePath(parts: string[]): string {
  return parts.join('/')
}
