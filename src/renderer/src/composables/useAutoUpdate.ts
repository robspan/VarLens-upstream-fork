/* eslint-disable no-undef */
import { ref, computed, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { UpdateStatus } from '../../../shared/types/api'

export interface UseAutoUpdateReturn {
  updateStatus: Ref<UpdateStatus>
  isUpdateAvailable: ComputedRef<boolean>
  isUpdateDownloaded: ComputedRef<boolean>
  isDownloading: ComputedRef<boolean>
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  const updateStatus = ref<UpdateStatus>({ state: 'idle' })
  let cleanup: (() => void) | null = null

  if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
    // Fetch initial status
    window.api.updater.getStatus().then((status) => {
      updateStatus.value = status
    })

    // Listen for status changes
    cleanup = window.api.updater.onStatusChange((status: UpdateStatus) => {
      updateStatus.value = status
    })
  }

  onUnmounted(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  const isUpdateAvailable = computed(() => updateStatus.value.state === 'available')
  const isUpdateDownloaded = computed(() => updateStatus.value.state === 'downloaded')
  const isDownloading = computed(() => updateStatus.value.state === 'downloading')

  async function checkForUpdate(): Promise<void> {
    if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
      await window.api.updater.checkForUpdate()
    }
  }

  async function downloadUpdate(): Promise<void> {
    if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
      await window.api.updater.downloadUpdate()
    }
  }

  async function installUpdate(): Promise<void> {
    if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
      await window.api.updater.installUpdate()
    }
  }

  return {
    updateStatus,
    isUpdateAvailable,
    isUpdateDownloaded,
    isDownloading,
    checkForUpdate,
    downloadUpdate,
    installUpdate
  }
}
