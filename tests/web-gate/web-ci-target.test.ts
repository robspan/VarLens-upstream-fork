import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

describe('web CI target wiring', () => {
  test('root Makefile keeps web CI explicit and Postgres-gated', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8')

    expect(makefile).toMatch(/^web-ci: rebuild-node build-web web-gate-static web-gate-postgres/m)
    expect(makefile).toMatch(/^web-gate-postgres: build-web/m)
    expect(makefile).toContain('VARLENS_PG_URL is required for web-gate-postgres')
    expect(makefile).toMatch(/^ci: lint-check format-check typecheck rebuild-node test/m)
    expect(makefile).toMatch(/^VARLENS_WEB \?= 0/m)
    expect(makefile).not.toMatch(/wildcard web-deploy\/\.env/)
  })

  test('web publish and release workflows run web-ci before building images', () => {
    const publish = readFileSync(resolve(ROOT, '.github/workflows/publish-web.yml'), 'utf8')
    const release = readFileSync(resolve(ROOT, '.github/workflows/release-web.yml'), 'utf8')

    expect(publish).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(publish).toMatch(/build-and-push:[\s\S]*?needs: web-ci/)
    expect(release).toMatch(/web-ci:[\s\S]*?run: make web-ci/)
    expect(release).toMatch(/build-and-push:[\s\S]*?needs: \[resolve-version, web-ci\]/)
  })
})
