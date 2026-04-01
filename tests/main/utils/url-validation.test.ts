import { describe, it, expect, beforeEach } from 'vitest'
import {
  isUrlSafeForExternal,
  isDomainAllowed,
  setUserDomains,
  isValidHostname
} from '../../../src/main/utils/url-validation'

describe('isValidHostname', () => {
  it('accepts valid hostname', () => {
    expect(isValidHostname('example.com')).toBe(true)
  })

  it('accepts subdomain', () => {
    expect(isValidHostname('sub.example.com')).toBe(true)
  })

  it('rejects bare TLD', () => {
    expect(isValidHostname('com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidHostname('')).toBe(false)
  })

  it('rejects hostname with spaces', () => {
    expect(isValidHostname('example .com')).toBe(false)
  })
})

describe('isDomainAllowed', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows exact match from built-in list', () => {
    expect(isDomainAllowed('github.com')).toBe(true)
  })

  it('allows subdomain of built-in domain', () => {
    expect(isDomainAllowed('pages.github.com')).toBe(true)
  })

  it('rejects unknown domain', () => {
    expect(isDomainAllowed('evil.com')).toBe(false)
  })

  it('rejects suffix match without dot boundary', () => {
    expect(isDomainAllowed('evilgithub.com')).toBe(false)
  })

  it('allows user-configured domain', () => {
    setUserDomains(['mylab.org'])
    expect(isDomainAllowed('mylab.org')).toBe(true)
  })

  it('rejects invalid user domains', () => {
    setUserDomains(['com', 'valid.org'])
    expect(isDomainAllowed('evil.com')).toBe(false)
    expect(isDomainAllowed('valid.org')).toBe(true)
  })
})

describe('isUrlSafeForExternal', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows https URL to allowed domain', () => {
    expect(isUrlSafeForExternal('https://github.com/repo')).toBe(true)
  })

  it('rejects http URL', () => {
    expect(isUrlSafeForExternal('http://github.com/repo')).toBe(false)
  })

  it('rejects javascript: URL', () => {
    expect(isUrlSafeForExternal('javascript:alert(1)')).toBe(false)
  })

  it('rejects file: URL', () => {
    expect(isUrlSafeForExternal('file:///etc/passwd')).toBe(false)
  })

  it('rejects unknown domain over https', () => {
    expect(isUrlSafeForExternal('https://evil.com/phish')).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isUrlSafeForExternal('not a url')).toBe(false)
  })
})
