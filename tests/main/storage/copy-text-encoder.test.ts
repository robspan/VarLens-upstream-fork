import { describe, it, expect } from 'vitest'
import {
  encodeText,
  encodeInteger,
  encodeFloat,
  encodeBoolean,
  encodeJsonb,
  encodeBytea,
  encodeArray,
  encodeRowsToCopyText,
  EncoderInvalidValueError,
} from '../../../src/main/storage/postgres/copy-text-encoder'

describe('encodeText', () => {
  it('null → \\N', () => { expect(encodeText(null)).toBe('\\N') })
  it('undefined → \\N', () => { expect(encodeText(undefined)).toBe('\\N') })
  it('empty string → "" (empty, NOT null)', () => { expect(encodeText('')).toBe('') })
  it('plain ASCII → unchanged', () => { expect(encodeText('chr1')).toBe('chr1') })
  it('escapes backslash before other escapes', () => { expect(encodeText('a\\b')).toBe('a\\\\b') })
  it('escapes newline', () => { expect(encodeText('a\nb')).toBe('a\\nb') })
  it('escapes carriage return', () => { expect(encodeText('a\rb')).toBe('a\\rb') })
  it('escapes tab', () => { expect(encodeText('a\tb')).toBe('a\\tb') })
  it('the literal string \\N is escaped to \\\\N (still null when decoded? no — different bytes)', () => {
    expect(encodeText('\\N')).toBe('\\\\N')
  })
  it('throws EncoderInvalidValueError on U+0000', () => {
    expect(() => encodeText('a\u0000b')).toThrow(EncoderInvalidValueError)
  })
})

describe('encodeInteger', () => {
  it('null → \\N', () => { expect(encodeInteger(null)).toBe('\\N') })
  it('0 → "0"', () => { expect(encodeInteger(0)).toBe('0') })
  it('positive number → string', () => { expect(encodeInteger(42)).toBe('42') })
  it('negative number → string', () => { expect(encodeInteger(-7)).toBe('-7') })
  it('bigint → string', () => { expect(encodeInteger(9007199254740992n)).toBe('9007199254740992') })
})

describe('encodeFloat', () => {
  it('null → \\N', () => { expect(encodeFloat(null)).toBe('\\N') })
  it('0 → "0"', () => { expect(encodeFloat(0)).toBe('0') })
  it('NaN → "NaN" (Postgres float8 token)', () => { expect(encodeFloat(NaN)).toBe('NaN') })
  it('Infinity → "Infinity"', () => { expect(encodeFloat(Infinity)).toBe('Infinity') })
  it('-Infinity → "-Infinity"', () => { expect(encodeFloat(-Infinity)).toBe('-Infinity') })
})

describe('encodeBoolean', () => {
  it('null → \\N', () => { expect(encodeBoolean(null)).toBe('\\N') })
  it('true → "t"', () => { expect(encodeBoolean(true)).toBe('t') })
  it('false → "f"', () => { expect(encodeBoolean(false)).toBe('f') })
})

describe('encodeJsonb (reserved — no Phase 16 caller, but must be correct)', () => {
  it('null → \\N', () => { expect(encodeJsonb(null)).toBe('\\N') })
  it('strips U+0000 from string values', () => {
    expect(encodeJsonb({ a: 'x\u0000y' })).not.toContain('\u0000')
  })
  it('double-escapes backslashes so wire bytes survive COPY decoder', () => {
    // JSON.stringify({a: '\\'}) = '{"a":"\\\\"}' (a 6-char string)
    // After our double-escape, every \ becomes \\, then the COPY-text \-escape pass
    // produces the wire form below.
    expect(encodeJsonb({ a: '\\' })).toBe('{"a":"\\\\\\\\"}')
  })
})

describe('encodeBytea', () => {
  it('null → \\N', () => { expect(encodeBytea(null)).toBe('\\N') })
  it('Buffer → \\x<hex>', () => {
    expect(encodeBytea(Buffer.from([0xab, 0xcd]))).toBe('\\\\xabcd')
  })
})

describe('encodeArray', () => {
  it('null → \\N', () => { expect(encodeArray(null)).toBe('\\N') })
  it('empty array → "{}"', () => { expect(encodeArray([])).toBe('{}') })
  it('text array → escaped form', () => { expect(encodeArray(['a', 'b'])).toBe('{a,b}') })
})

describe('encodeRowsToCopyText (async generator)', () => {
  it('emits one tab-separated line per row, terminated by \\n', async () => {
    const cols = [
      { name: 'a', encoder: encodeText },
      { name: 'b', encoder: encodeInteger },
    ]
    const rows = [
      { a: 'hello', b: 1 },
      { a: 'world', b: null },
    ]
    let out = ''
    for await (const chunk of encodeRowsToCopyText(cols, rows)) {
      out += chunk.toString('utf8')
    }
    expect(out).toBe('hello\t1\nworld\t\\N\n')
  })
})
