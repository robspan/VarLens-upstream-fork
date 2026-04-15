import { describe, it, expect } from 'vitest'
import { ref, reactive, isReactive } from 'vue'
import { cloneForIpc } from '@renderer/utils/cloneForIpc'
import { cloneForIpc as sharedCloneForIpc } from '../../../src/shared/utils/cloneForIpc'

describe('cloneForIpc', () => {
  it('re-exports the shared clone helper', () => {
    expect(cloneForIpc).toBe(sharedCloneForIpc)
  })

  it('returns a plain object from a plain object', () => {
    const input = { a: 1, b: 'two' }
    const result = cloneForIpc(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input) // new object
  })

  it('strips Vue ref proxy', () => {
    const input = ref({ search: 'hello', items: [1, 2, 3] })
    const result = cloneForIpc(input.value)
    expect(result).toEqual({ search: 'hello', items: [1, 2, 3] })
    expect(isReactive(result)).toBe(false)
  })

  it('strips Vue reactive proxy', () => {
    const input = reactive({ filters: ['a', 'b'], nested: { x: 1 } })
    const result = cloneForIpc(input)
    expect(result).toEqual({ filters: ['a', 'b'], nested: { x: 1 } })
    expect(isReactive(result)).toBe(false)
    expect(isReactive(result.nested)).toBe(false)
  })

  it('strips reactive arrays nested inside a plain object', () => {
    const reactiveArr = reactive(['missense', 'nonsense'])
    const obj = { consequences: reactiveArr, count: 5 }
    const result = cloneForIpc(obj)
    expect(result.consequences).toEqual(['missense', 'nonsense'])
    expect(isReactive(result.consequences)).toBe(false)
  })

  it('handles null and undefined values', () => {
    const input = { a: null, b: undefined }
    const result = cloneForIpc(input)
    expect(result.a).toBeNull()
    // JSON.stringify strips undefined — this is expected IPC behavior
    expect(result.b).toBeUndefined()
  })

  it('handles empty objects', () => {
    expect(cloneForIpc({})).toEqual({})
  })

  it('handles arrays at top level', () => {
    const input = ref([1, 2, 3])
    const result = cloneForIpc(input.value)
    expect(result).toEqual([1, 2, 3])
    expect(isReactive(result)).toBe(false)
  })
})
