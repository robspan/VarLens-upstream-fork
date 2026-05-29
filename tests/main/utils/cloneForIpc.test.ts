import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { cloneForIpc } from '../../../src/shared/utils/cloneForIpc'

describe('cloneForIpc — Sprint A A2', () => {
  it('deep-clones plain objects', () => {
    const input = { a: 1, b: { c: 2 }, d: [3, 4] }
    const out = cloneForIpc(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(out.b).not.toBe(input.b)
    expect(out.d).not.toBe(input.d)
  })

  it('preserves Date instances (structuredClone semantics, not JSON)', () => {
    const d = new Date('2026-05-28T00:00:00Z')
    const out = cloneForIpc({ d })
    expect(out.d).toBeInstanceOf(Date)
    expect(out.d.getTime()).toBe(d.getTime())
  })

  it('preserves Map / Set (structuredClone semantics)', () => {
    const m = new Map([['k', 1]])
    const s = new Set([1, 2])
    const out = cloneForIpc({ m, s })
    expect(out.m).toBeInstanceOf(Map)
    expect(out.m.get('k')).toBe(1)
    expect(out.s).toBeInstanceOf(Set)
    expect(out.s.has(2)).toBe(true)
  })

  it('throws on non-cloneable values (functions) — loud failure for misuse', () => {
    expect(() => cloneForIpc({ fn: () => 1 } as unknown as { fn: unknown })).toThrow(
      /DataCloneError|could not be cloned/i
    )
  })

  it('throws DataCloneError on a Vue reactive proxy — locks the misuse contract', () => {
    // The whole point of switching to structuredClone is that misusing this
    // shared/main helper on renderer state (a Vue proxy) fails loudly and
    // points the caller at stripVueProxies. Lock that contract here.
    const proxy = reactive({ a: 1, b: { c: 2 } })
    expect(() => cloneForIpc(proxy)).toThrow(/DataCloneError|could not be cloned/i)
  })
})
