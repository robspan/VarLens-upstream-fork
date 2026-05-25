import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAllowedImportPath,
  isAllowedImportPath,
  __resetAllowlistForTests
} from '../../../src/main/security/import-path-allowlist'

describe('import-path-allowlist', () => {
  beforeEach(() => __resetAllowlistForTests())

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
})
