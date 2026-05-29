<template>
  <div>
    <div class="text-caption text-medium-emphasis mb-3">Choose import source</div>
    <div class="d-flex flex-wrap ga-3">
      <v-card
        v-for="source in sources"
        :key="source.mode"
        variant="outlined"
        class="import-source-card flex-grow-1"
        min-width="130"
        role="button"
        tabindex="0"
        @click="openPicker(source.mode)"
        @keydown.enter="openPicker(source.mode)"
      >
        <v-card-text class="d-flex flex-column align-center text-center pa-3">
          <v-icon :icon="source.icon" size="24" color="primary" class="mb-1" />
          <div class="text-body-2 font-weight-medium">{{ source.title }}</div>
          <div class="text-caption text-medium-emphasis">{{ source.subtitle }}</div>
        </v-card-text>
      </v-card>
    </div>
    <input
      ref="inputRef"
      type="file"
      class="web-file-input"
      :accept="inputAccept"
      :multiple="inputMultiple"
      @change="handleChange"
    />
    <v-progress-linear
      v-if="uploadPending"
      indeterminate
      color="primary"
      class="mt-4"
      aria-label="Uploading selected files"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

export type WebImportMode = 'single' | 'files' | 'folder' | 'zip'

interface WebImportSource {
  mode: WebImportMode
  icon: string
  title: string
  subtitle: string
}

defineProps<{
  sources: WebImportSource[]
  uploadPending: boolean
}>()

const emit = defineEmits<{
  'files-selected': [payload: { mode: WebImportMode; files: File[] }]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const activeMode = ref<WebImportMode>('single')

const inputAccept = computed(() =>
  activeMode.value === 'zip' ? '.zip' : '.vcf,.vcf.gz,.json,.json.gz,.gz'
)
const inputMultiple = computed(() => activeMode.value === 'files' || activeMode.value === 'folder')

function openPicker(mode: WebImportMode): void {
  activeMode.value = mode
  const input = inputRef.value
  if (input === null) return
  if (mode === 'folder') {
    input.setAttribute('webkitdirectory', '')
  } else {
    input.removeAttribute('webkitdirectory')
  }
  input.click()
}

function handleChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  emit('files-selected', { mode: activeMode.value, files })
}
</script>

<style scoped>
.import-source-card {
  cursor: pointer;
  transition: all 0.15s ease;
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.import-source-card:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}

.web-file-input {
  display: none;
}
</style>
