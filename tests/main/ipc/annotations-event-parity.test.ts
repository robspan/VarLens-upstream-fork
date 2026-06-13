import { describe, expect, test, vi } from 'vitest'
import {
  upsertGlobalAnnotationViaSession,
  upsertPerCaseAnnotationWithEvent
} from '../../../src/main/ipc/handlers/annotations-logic'
import type { StorageSession } from '../../../src/main/storage/session'

function fakeSession(): StorageSession {
  return {
    getWriteExecutor: () => ({
      execute: vi.fn().mockResolvedValue({ ok: true })
    })
  } as unknown as StorageSession
}

describe('upsertPerCaseAnnotationWithEvent — event callback', () => {
  test('fires exactly once with kind=acmg for an acmg_classification update', async () => {
    const onChange = vi.fn()
    await upsertPerCaseAnnotationWithEvent(
      1,
      2,
      { acmg_classification: 'Pathogenic' },
      () => fakeSession(),
      onChange
    )
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ caseId: 1, variantId: 2, kind: 'acmg' })
  })

  test('fires exactly once with kind=star for a starred update', async () => {
    const onChange = vi.fn()
    await upsertPerCaseAnnotationWithEvent(1, 2, { starred: true }, () => fakeSession(), onChange)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ caseId: 1, variantId: 2, kind: 'star' })
  })

  test('fires exactly once with kind=evidence for an acmg_evidence update', async () => {
    const onChange = vi.fn()
    await upsertPerCaseAnnotationWithEvent(
      3,
      4,
      { acmg_evidence: 'PS1' },
      () => fakeSession(),
      onChange
    )
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ caseId: 3, variantId: 4, kind: 'evidence' })
  })

  test('fires exactly once with kind=comment when only per_case_comment is updated', async () => {
    const onChange = vi.fn()
    await upsertPerCaseAnnotationWithEvent(
      5,
      6,
      { per_case_comment: 'hello' },
      () => fakeSession(),
      onChange
    )
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ caseId: 5, variantId: 6, kind: 'comment' })
  })

  test('does not fire if the write executor throws', async () => {
    const onChange = vi.fn()
    const errorSession = {
      getWriteExecutor: () => ({
        execute: vi.fn().mockRejectedValue(new Error('write failed'))
      })
    }
    await expect(
      upsertPerCaseAnnotationWithEvent(1, 2, { starred: true }, () => errorSession, onChange)
    ).rejects.toThrow('write failed')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('upsertGlobalAnnotationViaSession', () => {
  test('delegates to write executor with upsertGlobalWithAudit task type', async () => {
    const executeMock = vi.fn().mockResolvedValue({ ok: true })
    const session = { getWriteExecutor: () => ({ execute: executeMock }) }
    const coords = { chr: '1', pos: 100, ref: 'A', alt: 'T' }
    const updates = { global_comment: 'test' }
    await upsertGlobalAnnotationViaSession(
      coords,
      updates,
      () => session as unknown as StorageSession
    )
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock.mock.calls[0][0]).toMatchObject({
      type: 'annotations:upsertGlobalWithAudit'
    })
  })
})
