import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAllowedImportPath,
  isAllowedImportPath,
  __resetAllowlistForTests
} from '../../../src/main/security/import-path-allowlist'

describe('import-path-allowlist', () => {
  beforeEach(() => __resetAllowlistForTests())

  const symlinkIt = process.platform === 'win32' ? it.skip : it

  it('rejects /etc/passwd', () => {
    expect(isAllowedImportPath('/etc/passwd')).toBe(false)
  })

  it('accepts a previously-registered dialog path', () => {
    addAllowedImportPath('/some/custom/mount/file.vcf')
    expect(isAllowedImportPath('/some/custom/mount/file.vcf')).toBe(true)
  })

  it('accepts paths under app.getPath(temp) via the env-fallback', () => {
    expect(isAllowedImportPath('/tmp/inside-tmp.bed')).toBe(true)
  })

  symlinkIt('rejects an existing temp symlink that resolves outside allowed roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
    try {
      const linkPath = join(root, 'passwd-link.vcf')
      symlinkSync('/etc/passwd', linkPath)

      expect(isAllowedImportPath(linkPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  symlinkIt('accepts a dialog-registered symlink and its resolved target', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-allowlist-'))
    try {
      const linkPath = join(root, 'passwd-link.vcf')
      symlinkSync('/etc/passwd', linkPath)
      const targetPath = realpathSync.native(linkPath)

      addAllowedImportPath(linkPath)

      expect(isAllowedImportPath(linkPath)).toBe(true)
      expect(isAllowedImportPath(targetPath)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
