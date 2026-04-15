import { describe, expect, it } from 'vitest'
import { getAdaptiveRowScrollBehavior } from '../../../src/renderer/src/utils/adaptiveRowScroll'

describe('getAdaptiveRowScrollBehavior', () => {
  it('uses smooth scrolling for isolated keyboard moves', () => {
    expect(getAdaptiveRowScrollBehavior(null, 1000)).toBe('smooth')
    expect(getAdaptiveRowScrollBehavior(800, 1000)).toBe('smooth')
  })

  it('switches to auto scrolling for burst navigation under 150ms', () => {
    expect(getAdaptiveRowScrollBehavior(900, 1049)).toBe('auto')
  })

  it('returns to smooth scrolling at the 150ms threshold and above', () => {
    expect(getAdaptiveRowScrollBehavior(900, 1050)).toBe('smooth')
    expect(getAdaptiveRowScrollBehavior(900, 1200)).toBe('smooth')
  })
})
