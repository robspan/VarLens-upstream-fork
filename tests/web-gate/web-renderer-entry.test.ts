import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

describe('web renderer entry HTML', () => {
  test('uses Vite base for the favicon URL so path-prefix deployments work', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/web/index.html'), 'utf8')

    expect(html).toContain('href="%BASE_URL%favicon.svg"')
    expect(html).not.toContain('href="/favicon.svg"')
  })
})
