import { describe, it, expect } from 'vitest'
import { reactive, ref } from 'vue'
import { stripVueProxies } from '../../../src/renderer/src/utils/stripVueProxies'

describe('stripVueProxies — Sprint A A2', () => {
  it('strips reactive proxy and deep-clones', () => {
    const input = reactive({ a: 1, b: { c: 2 } })
    const out = stripVueProxies(input)
    expect(out).toEqual({ a: 1, b: { c: 2 } })
    expect(out).not.toBe(input)
    expect(out.b).not.toBe(input.b)
  })

  it('unwraps ref values transparently', () => {
    const input = reactive({ x: ref(42), y: { z: ref('hello') } })
    const out = stripVueProxies(input)
    expect(out).toEqual({ x: 42, y: { z: 'hello' } })
  })

  it('handles arrays', () => {
    const input = reactive([1, { n: 2 }, [3, 4]])
    const out = stripVueProxies(input)
    expect(out).toEqual([1, { n: 2 }, [3, 4]])
  })

  it('handles null/undefined/primitives', () => {
    expect(stripVueProxies(null)).toBe(null)
    expect(stripVueProxies(undefined)).toBe(undefined)
    expect(stripVueProxies(42)).toBe(42)
    expect(stripVueProxies('s')).toBe('s')
  })

  it('does not throw DataCloneError on Vue proxies (the cloneForIpc regression)', () => {
    const input = reactive({ filters: reactive({ nested: ref([1, 2]) }) })
    expect(() => stripVueProxies(input)).not.toThrow()
  })
})
