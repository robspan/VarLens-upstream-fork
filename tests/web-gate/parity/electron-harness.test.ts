import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  prepareElectronApiArgs,
  stageElectronImportFile,
  unwrapIpcResultForParity
} from './electron-harness'

describe('Electron parity harness helpers', () => {
  test('unwrapIpcResultForParity throws on SerializableError envelopes', () => {
    expect(() =>
      unwrapIpcResultForParity({
        code: 'INVALID_PARAMETERS',
        message: 'file path is not allowed',
        userMessage: 'The selected file is not in an allowed location.'
      })
    ).toThrow(/INVALID_PARAMETERS.*file path is not allowed/)
  })

  test('stageElectronImportFile copies fixtures under the isolated Electron root', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-electron-harness-'))
    const source = join(root, 'source.vcf')
    writeFileSync(source, 'fixture-data', 'utf8')

    try {
      const staged = stageElectronImportFile({ isolationRoot: root }, source)
      expect(staged.startsWith(join(root, 'allowed-imports'))).toBe(true)
      expect(staged.endsWith('source.vcf')).toBe(true)
      expect(readFileSync(staged, 'utf8')).toBe('fixture-data')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('prepareElectronApiArgs stages multi-file imports and BED filters', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-electron-harness-'))
    const first = join(root, 'first.vcf')
    const second = join(root, 'second.vcf')
    const bed = join(root, 'regions.bed')
    writeFileSync(first, 'first', 'utf8')
    writeFileSync(second, 'second', 'utf8')
    writeFileSync(bed, 'bed', 'utf8')

    try {
      const prepared = prepareElectronApiArgs({ isolationRoot: root }, 'import', 'startMultiFile', [
        'case',
        [
          { filePath: first, variantType: 'snv', caller: null, annotationFormat: null },
          { filePath: second, variantType: 'sv', caller: 'manta', annotationFormat: null }
        ],
        undefined,
        { bedFile: bed, passOnly: true }
      ])
      const files = prepared[1] as Array<{ filePath: string }>
      const filters = prepared[3] as { bedFile: string; passOnly: boolean }

      expect(
        files
          .map((file) => file.filePath)
          .every((path) => path.startsWith(join(root, 'allowed-imports')))
      ).toBe(true)
      expect(filters.bedFile.startsWith(join(root, 'allowed-imports'))).toBe(true)
      expect(filters.passOnly).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
