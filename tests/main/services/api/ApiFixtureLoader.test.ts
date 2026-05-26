import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { apiFixturePath, readApiFixture } from '../../../../src/main/services/api/ApiFixtureLoader'

const ORIGINAL_ALLOW = process.env.VARLENS_ALLOW_API_FIXTURES
const ORIGINAL_DIR = process.env.VARLENS_API_FIXTURES_DIR

function restoreEnv(): void {
  if (ORIGINAL_ALLOW === undefined) delete process.env.VARLENS_ALLOW_API_FIXTURES
  else process.env.VARLENS_ALLOW_API_FIXTURES = ORIGINAL_ALLOW

  if (ORIGINAL_DIR === undefined) delete process.env.VARLENS_API_FIXTURES_DIR
  else process.env.VARLENS_API_FIXTURES_DIR = ORIGINAL_DIR
}

describe('ApiFixtureLoader', () => {
  let fixtureRoot: string | undefined

  afterEach(() => {
    restoreEnv()
    if (fixtureRoot !== undefined) {
      rmSync(fixtureRoot, { recursive: true, force: true })
      fixtureRoot = undefined
    }
  })

  it('reads fixture JSON from inside the configured root', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'varlens-api-fixtures-'))
    process.env.VARLENS_ALLOW_API_FIXTURES = '1'
    process.env.VARLENS_API_FIXTURES_DIR = fixtureRoot
    writeFileSync(join(fixtureRoot, 'fixture.json'), '{"ok":true}\n', 'utf8')

    expect(readApiFixture('fixture.json')).toEqual({ ok: true })
  })

  it('rejects traversal outside the configured fixture root', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'varlens-api-fixtures-'))
    process.env.VARLENS_ALLOW_API_FIXTURES = '1'
    process.env.VARLENS_API_FIXTURES_DIR = fixtureRoot

    expect(() => readApiFixture('../outside.json')).toThrow(/fixture root/i)
  })

  it('joins path parts without granting traversal exceptions', () => {
    expect(apiFixturePath(['hpo', 'search-brca1.json'])).toBe('hpo/search-brca1.json')
  })
})
