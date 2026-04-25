import { describe, expect, it } from 'vitest'

import { encodeCoord, hashCoord } from './coord-hash-encoding'

describe('encodeCoord — length-prefixed bytea encoding', () => {
  it('produces the documented byte layout for a small ASCII fixture', () => {
    // chr='chr1' (4 bytes), pos=12345, ref='A' (1 byte), alt='T' (1 byte)
    const out = encodeCoord('chr1', 12345, 'A', 'T')
    // length(chr) BE-uint32 + chr + pos BE-int64 + length(ref) BE-uint32 + ref + length(alt) BE-uint32 + alt
    // = 4 + 4 + 8 + 4 + 1 + 4 + 1 = 26 bytes
    expect(out.length).toBe(26)
    expect(out.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x04])) // length('chr1')
    expect(out.subarray(4, 8)).toEqual(Buffer.from('chr1', 'utf8'))
    expect(out.subarray(8, 16)).toEqual(Buffer.from([0, 0, 0, 0, 0, 0, 0x30, 0x39])) // 12345 BE
    expect(out.subarray(16, 20)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x01])) // length('A')
    expect(out.subarray(20, 21)).toEqual(Buffer.from('A', 'utf8'))
    expect(out.subarray(21, 25)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x01])) // length('T')
    expect(out.subarray(25, 26)).toEqual(Buffer.from('T', 'utf8'))
  })

  it('is injective: distinct (chr, pos, ref, alt) tuples produce distinct encodings', () => {
    // Pair that would collide with naive colon-delimited concat:
    //   '1:2:3:A:T' could be (chr='1:2', pos=3, ref='A', alt='T')
    //   or          (chr='1', pos=2, ref='3:A', alt='T')
    const a = encodeCoord('1:2', 3, 'A', 'T')
    const b = encodeCoord('1', 2, '3:A', 'T')
    expect(a.equals(b)).toBe(false)
  })

  it('handles UTF-8 multi-byte chr names correctly (length is in bytes, not characters)', () => {
    // 'chrΩ' is 5 UTF-8 bytes (chr + 2-byte Ω), not 4.
    const out = encodeCoord('chrΩ', 1, 'A', 'T')
    expect(out.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x05]))
    expect(out.subarray(4, 9)).toEqual(Buffer.from('chrΩ', 'utf8'))
  })

  it('handles 9.7 KB allele without truncation', () => {
    const longAlt = 'A'.repeat(9_705)
    const out = encodeCoord('chr6', 31311231, 'A', longAlt)
    // 4 + 4 + 8 + 4 + 1 + 4 + 9705 = 9730
    expect(out.length).toBe(9730)
    expect(out.subarray(21, 25)).toEqual(Buffer.from([0x00, 0x00, 0x25, 0xe9])) // 9705 BE
  })
})

describe('hashCoord — sha256 of the encoded bytes', () => {
  it('returns a 32-byte Buffer', () => {
    expect(hashCoord('chr1', 12345, 'A', 'T').length).toBe(32)
  })

  it('is deterministic: same inputs produce same hash', () => {
    const a = hashCoord('chr1', 12345, 'A', 'T')
    const b = hashCoord('chr1', 12345, 'A', 'T')
    expect(a.equals(b)).toBe(true)
  })

  it('distinguishes the colon-collision pair', () => {
    expect(hashCoord('1:2', 3, 'A', 'T').equals(hashCoord('1', 2, '3:A', 'T'))).toBe(false)
  })
})
