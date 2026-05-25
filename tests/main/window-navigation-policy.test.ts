import { describe, expect, it } from 'vitest'
import { isMainWindowNavigationAllowed } from '../../src/main/window-navigation-policy'

describe('main window navigation policy', () => {
  it('allows navigation within the development renderer URL', () => {
    expect(
      isMainWindowNavigationAllowed(
        'http://localhost:5173/assets/index.js',
        'http://localhost:5173'
      )
    ).toBe(true)
  })

  it('allows file URLs for the packaged renderer', () => {
    expect(isMainWindowNavigationAllowed('file:///app/renderer/index.html', undefined)).toBe(true)
  })

  it('blocks non-file URLs when no development renderer URL is configured', () => {
    expect(isMainWindowNavigationAllowed('https://example.com', undefined)).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com', '')).toBe(false)
  })

  it('blocks external URLs outside the development renderer URL', () => {
    expect(isMainWindowNavigationAllowed('https://example.com', 'http://localhost:5173')).toBe(
      false
    )
  })
})
