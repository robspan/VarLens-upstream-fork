import type { TranscriptAnnotation, TranscriptInsertRow } from '../../types/transcript'
import type { IpcResult } from '../../types/errors'

export interface TranscriptsDomainContract {
  list: (variantId: number) => Promise<IpcResult<TranscriptAnnotation[]>>
  switch: (variantId: number, transcriptId: string) => Promise<IpcResult<{ success: boolean }>>
  insertAndSwitch: (
    variantId: number,
    transcript: TranscriptInsertRow
  ) => Promise<IpcResult<{ success: boolean }>>
}
