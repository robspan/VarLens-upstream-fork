import { describe, it, expect, vi } from 'vitest'
import { JobRunner } from '../../../../src/main/services/jobs/JobRunner'

describe('JobRunner — Sprint A D2', () => {
  it('enqueue returns SYNCHRONOUSLY with id + kind + result (Pass-9 #9)', () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', {}, async () => 42)
    // No `await` — handle is already there.
    expect(typeof handle.id).toBe('string')
    expect(handle.kind).toBe('import_single')
    expect(handle.result).toBeInstanceOf(Promise)
  })

  it('handle.result resolves to the handler return value', async () => {
    const runner = new JobRunner()
    const handle = runner.enqueue('import_single', { x: 1 }, async (_ctx, p: { x: number }) => ({
      doubled: p.x * 2
    }))
    const r = await handle.result
    expect(r).toEqual({ doubled: 2 })
  })

  it('per-kind single-flight gate preserves the three existing error messages (Pass-7 HIGH #2)', () => {
    const runner = new JobRunner()
    // First enqueue ok
    runner.enqueue('import_single', {}, async () => new Promise(() => {})) // pending forever
    // Second enqueue rejects with the preserved message
    expect(() => runner.enqueue('import_single', {}, async () => 0)).toThrow(
      'An import is already in progress'
    )
  })

  it('cancel(jobId) aborts the signal AND invokes registered cancel callbacks (Pass-8 #9)', async () => {
    const runner = new JobRunner()
    const cancelFn = vi.fn()
    const handle = runner.enqueue('import_single', {}, async (ctx) => {
      ctx.registerCancel(cancelFn)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return ctx.signal.aborted ? 'cancelled' : 'completed'
    })
    runner.cancel(handle.id)
    const r = await handle.result
    expect(r).toBe('cancelled')
    expect(cancelFn).toHaveBeenCalled()
  })

  it('onLifecycle fires for queued → running → completed', async () => {
    const runner = new JobRunner()
    const events: string[] = []
    runner.onLifecycle((j) => events.push(j.status))
    const handle = runner.enqueue('export', {}, async () => 'ok')
    await handle.result
    expect(events).toEqual(['queued', 'running', 'completed'])
  })
})
