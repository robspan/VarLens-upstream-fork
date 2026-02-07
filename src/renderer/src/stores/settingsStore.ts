/**
 * Pinia store for user preferences / settings
 * Persisted to localStorage so choices survive across sessions.
 */

import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'varlens_user_settings_v1'

interface PersistedSettings {
  itemsPerPage: number
}

const DEFAULTS: PersistedSettings = {
  itemsPerPage: 25
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null && raw !== '') {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      return { ...DEFAULTS, ...parsed }
    }
  } catch {
    // ignore corrupt data
  }
  return { ...DEFAULTS }
}

function save(settings: PersistedSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()

  const itemsPerPage = ref(persisted.itemsPerPage)

  // Auto-persist on change
  watch(itemsPerPage, () => {
    save({ itemsPerPage: itemsPerPage.value })
  })

  return {
    itemsPerPage
  }
})
