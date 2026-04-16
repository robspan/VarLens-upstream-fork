import { ipcRenderer } from 'electron'
import type { TranscriptsDomainContract } from '../../shared/ipc/domains/transcripts'

export function createTranscriptsApi(): TranscriptsDomainContract {
  return {
    list: (variantId) => ipcRenderer.invoke('transcripts:list', variantId),
    switch: (variantId, transcriptId) =>
      ipcRenderer.invoke('transcripts:switch', variantId, transcriptId),
    insertAndSwitch: (variantId, transcript) =>
      ipcRenderer.invoke('transcripts:insertAndSwitch', variantId, transcript)
  }
}
