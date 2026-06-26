import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

describe('ImportSourceSelector accessibility contract', () => {
  test('button-like source cards activate with Enter and Space', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/import/ImportSourceSelector.vue'),
      'utf8'
    )

    expect(source).toContain('role="button"')
    expect(source).toContain('@keydown="handleSourceKeydown($event, src.mode)"')
    expect(source).toContain("event.key !== 'Enter' && event.key !== ' '")
    expect(source).toContain('event.preventDefault()')
  })
})
