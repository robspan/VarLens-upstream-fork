import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()

const SHARED_RENDERER_UPLOAD_DIRS = [
  'src/renderer/src/components/import',
  'src/renderer/src/components/case-data-info'
]

const FORBIDDEN_SHARED_RENDERER_PATTERNS: Array<[label: string, pattern: RegExp]> = [
  ['web upload helper', /\buploadWebImportFiles\b/],
  ['web source picker', /\bWebImportSourcePicker\b/],
  ['deleted upload utility', /\bweb-import-upload\b/],
  ['browser upload route', /\/api\/import\/upload/],
  ['web upload refs', /web-upload:/],
  ['direct file array type', /\bFile\[\]/],
  ['direct file input', /<input\b[^>]*type=["']file["']/i],
  ['direct HTML input refs', /\bHTMLInputElement\b/],
  ['direct fetch', /\bfetch\(/]
]

function readRepoFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function listVueFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry)
    const absolute = resolve(ROOT, path)
    if (statSync(absolute).isDirectory()) return listVueFiles(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

describe('web upload boundary', () => {
  test('obsolete renderer-side browser upload modules stay deleted', () => {
    expect(
      existsSync(resolve(ROOT, 'src/renderer/src/components/import/WebImportSourcePicker.vue'))
    ).toBe(false)
    expect(existsSync(resolve(ROOT, 'src/renderer/src/utils/web-import-upload.ts'))).toBe(false)
  })

  test('shared renderer import surfaces only depend on the desktop-compatible API', () => {
    const violations: string[] = []

    for (const file of SHARED_RENDERER_UPLOAD_DIRS.flatMap(listVueFiles)) {
      const content = readRepoFile(file)
      if (
        /\bisWebRuntime\b/.test(content) &&
        file !== 'src/renderer/src/components/import/ImportWizard.vue'
      ) {
        violations.push(`${file}: contains web runtime branch`)
      }
      for (const [label, pattern] of FORBIDDEN_SHARED_RENDERER_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: contains ${label}`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  test('browser upload mechanics are isolated to the web client adapter', () => {
    const webClient = readRepoFile('src/web/client/api.ts')

    expect(webClient).toContain("document.createElement('input')")
    expect(webClient).toContain('uploadImportFile(file: File)')
    expect(webClient).toContain("httpInvoke('batch-import', 'testZipPassword'")
  })

  test('web batch import resolves upload refs at the server edge and uses JobRunner/import seams', () => {
    const uploadStaging = readRepoFile('src/web/server/routes/upload-staging.ts')
    const batchImport = readRepoFile('src/web/server/routes/batch-import.ts')

    expect(uploadStaging).toContain("const UPLOAD_REF_PREFIX = 'web-upload:'")
    expect(batchImport).toContain('resolveWebUploadRef')
    expect(batchImport).toContain('jobRunner.enqueue<WebBatchImportJobParams, BatchResult>')
    expect(batchImport).toContain("'import_batch'")
    expect(batchImport).toContain('startImport(file.storedPath')
    expect(batchImport).not.toMatch(/\bVcfStrategy\b|\bVcfMapper\b|\bimportJsonFile\b/)
  })
})
