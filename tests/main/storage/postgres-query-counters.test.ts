import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  wrapPoolForCounters,
  getCounters,
  resetCounters
} from '../../../src/main/storage/postgres/query-counters'

describe('wrapPoolForCounters — Sprint A PR-2 B3', () => {
  beforeEach(() => resetCounters())

  it('counts named pool.query calls under their effective name', async () => {
    const inner = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn()
    } as unknown as Pool
    const wrapped = wrapPoolForCounters(inner)

    await wrapped.query({ name: 'foo:bar:v1@public_abc123', text: 'SELECT 1', values: [] })
    await wrapped.query({ name: 'foo:bar:v1@public_abc123', text: 'SELECT 1', values: [] })

    const counters = getCounters()
    expect(counters.named['foo:bar:v1@public_abc123']).toBe(2)
    expect(counters.unnamed).toBe(0)
  })

  it('counts unnamed string-form pool.query calls', async () => {
    const inner = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn()
    } as unknown as Pool
    const wrapped = wrapPoolForCounters(inner)

    await wrapped.query('SELECT 1', [])
    await wrapped.query('SELECT 2')

    const counters = getCounters()
    expect(counters.unnamed).toBe(2)
    expect(Object.keys(counters.named).length).toBe(0)
  })

  it('proxies pool.connect() and wraps client.query the same way', async () => {
    const innerClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn()
    } as unknown as PoolClient
    const inner = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(innerClient)
    } as unknown as Pool

    const wrapped = wrapPoolForCounters(inner)
    const client = await wrapped.connect()
    await client.query({ name: 'baz:qux:v1@public_abc123', text: 'SELECT 1', values: [] })
    await client.query('SELECT 2')

    const counters = getCounters()
    expect(counters.named['baz:qux:v1@public_abc123']).toBe(1)
    expect(counters.unnamed).toBe(1)
  })

  it('resetCounters clears state', () => {
    resetCounters()
    const c = getCounters()
    expect(c.unnamed).toBe(0)
    expect(Object.keys(c.named).length).toBe(0)
  })
})
