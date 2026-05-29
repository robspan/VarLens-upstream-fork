<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>Import BED Region File</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          @click="$emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="regionFileName"
          label="Region file name"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-text-field
          v-model="regionFileDescription"
          label="Description (optional)"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-btn
          variant="outlined"
          color="primary"
          :prepend-icon="mdiFileUploadOutline"
          :loading="importingRegion"
          @click="selectBedFile"
        >
          {{ selectedBedPath ? 'Change file...' : 'Select BED file...' }}
        </v-btn>
        <input
          v-if="isWebMode"
          ref="webBedInputRef"
          type="file"
          class="web-file-input"
          accept=".bed,.bed.gz,.gz"
          @change="handleWebBedFileSelected"
        />
        <div v-if="selectedBedPath" class="text-body-2 mt-2">
          {{ selectedBedBasename }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!regionFileName.trim() || !selectedBedPath"
          :loading="importingRegion"
          @click="importRegionFile"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { mdiClose, mdiFileUploadOutline } from '@mdi/js'
import { logService } from '../../services/LogService'
import { isWebRuntime } from '../../utils/runtime-mode'
import { uploadWebImportFiles } from '../../utils/web-import-upload'

interface RegionFileItem {
  id: number
  name: string
  region_count: number
  total_bases: number
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: [payload: { regionFileId: number; regionFiles: RegionFileItem[] }]
}>()

const regionFileName = ref('')
const regionFileDescription = ref('')
const selectedBedPath = ref('')
const selectedBedLabel = ref('')
const importingRegion = ref(false)
const webBedInputRef = ref<HTMLInputElement | null>(null)
const isWebMode = isWebRuntime()

const selectedBedBasename = computed(() => {
  if (selectedBedLabel.value) return selectedBedLabel.value
  if (!selectedBedPath.value) return ''
  const parts = selectedBedPath.value.split(/[/\\]/)
  return parts[parts.length - 1]
})

const { api } = useApiService()

// Reset state when dialog opens
watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    regionFileName.value = ''
    regionFileDescription.value = ''
    selectedBedPath.value = ''
    selectedBedLabel.value = ''
  }
)

async function selectBedFile(): Promise<void> {
  if (!api) return
  if (isWebMode) {
    webBedInputRef.value?.click()
    return
  }

  try {
    const result = await api.import.selectFile()
    if (typeof result === 'string') {
      applySelectedBedFile(result)
    }
  } catch (e) {
    logService.warn(
      'Failed to select BED file: ' + (e instanceof Error ? e.message : String(e)),
      'region-import'
    )
  }
}

async function handleWebBedFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importingRegion.value = true
  try {
    const [upload] = await uploadWebImportFiles([file])
    applySelectedBedFile(upload.ref, upload.fileName)
  } catch (e) {
    logService.warn(
      'Failed to upload BED file: ' + (e instanceof Error ? e.message : String(e)),
      'region-import'
    )
  } finally {
    importingRegion.value = false
  }
}

function applySelectedBedFile(path: string, label?: string): void {
  selectedBedPath.value = path
  selectedBedLabel.value = label ?? ''
  if (regionFileName.value.trim() !== '') return

  const parts = path.split(/[/\\]/)
  const displayName = label ?? parts[parts.length - 1] ?? path
  regionFileName.value = displayName.replace(/\.bed(?:\.gz)?$/i, '')
}

async function importRegionFile(): Promise<void> {
  const name = regionFileName.value.trim()
  if (name === '' || !selectedBedPath.value || !api) return
  importingRegion.value = true
  try {
    const regionFilesApi = api.regionFiles
    const created = await regionFilesApi.create(name, regionFileDescription.value.trim() || null)
    await regionFilesApi.importBed(created.id, selectedBedPath.value)

    const updatedFiles = await regionFilesApi.list()
    emit('imported', { regionFileId: created.id, regionFiles: updatedFiles })
    emit('update:modelValue', false)
  } catch (e) {
    logService.error(
      'Failed to import region file: ' + (e instanceof Error ? e.message : String(e)),
      'region-import'
    )
  } finally {
    importingRegion.value = false
  }
}
</script>

<style scoped>
.web-file-input {
  display: none;
}
</style>
