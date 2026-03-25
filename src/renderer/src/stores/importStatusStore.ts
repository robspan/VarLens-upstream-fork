import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type ImportPhase = 'idle' | 'importing' | 'finalizing' | 'complete' | 'error' | 'cancelled'

export interface ImportFileDetail {
  filePath: string
  fileName: string
  caseName: string
  status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped'
  variantCount?: number
  error?: string
}

export const useImportStatusStore = defineStore('importStatus', () => {
  const phase = ref<ImportPhase>('idle')
  const currentFileIndex = ref(0)
  const totalFiles = ref(0)
  const currentFileName = ref('')
  const overallPercent = ref(0)
  const currentPhase = ref('')
  const variantCount = ref(0)
  const skipped = ref(0)
  const startTime = ref(0)
  const dialogOpen = ref(false)
  const details = ref<ImportFileDetail[]>([])
  const errorMessage = ref('')

  const isActive = computed(() => phase.value === 'importing' || phase.value === 'finalizing')

  const fileProgress = computed(() =>
    totalFiles.value > 0 ? `${currentFileIndex.value + 1}/${totalFiles.value}` : ''
  )

  function startImport(files: number): void {
    phase.value = 'importing'
    totalFiles.value = files
    currentFileIndex.value = 0
    overallPercent.value = 0
    variantCount.value = 0
    skipped.value = 0
    startTime.value = Date.now()
    details.value = []
    errorMessage.value = ''
  }

  function updateProgress(data: {
    fileIndex: number
    totalFiles: number
    fileName: string
    overallPercent: number
    phase: string
    variantCount: number
    skipped: number
  }): void {
    currentFileIndex.value = data.fileIndex
    totalFiles.value = data.totalFiles
    currentFileName.value = data.fileName
    overallPercent.value = data.overallPercent
    currentPhase.value = data.phase
    variantCount.value = data.variantCount
    skipped.value = data.skipped

    if (data.phase === 'finalizing') {
      phase.value = 'finalizing'
    }
  }

  function fileComplete(detail: ImportFileDetail): void {
    details.value.push(detail)
  }

  function importComplete(result: {
    succeeded: number
    failed: number
    skipped: number
    cancelled: boolean
    details: ImportFileDetail[]
  }): void {
    phase.value = result.cancelled ? 'cancelled' : 'complete'
    details.value = result.details
    overallPercent.value = 100
  }

  function importError(error: string): void {
    phase.value = 'error'
    errorMessage.value = error
  }

  function reset(): void {
    phase.value = 'idle'
    currentFileIndex.value = 0
    totalFiles.value = 0
    currentFileName.value = ''
    overallPercent.value = 0
    currentPhase.value = ''
    variantCount.value = 0
    skipped.value = 0
    startTime.value = 0
    dialogOpen.value = false
    details.value = []
    errorMessage.value = ''
  }

  return {
    phase,
    currentFileIndex,
    totalFiles,
    currentFileName,
    overallPercent,
    currentPhase,
    variantCount,
    skipped,
    startTime,
    dialogOpen,
    details,
    errorMessage,
    isActive,
    fileProgress,
    startImport,
    updateProgress,
    fileComplete,
    importComplete,
    importError,
    reset
  }
})
