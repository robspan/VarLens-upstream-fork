<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1000"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-toolbar density="compact" color="transparent" class="px-2">
        <v-text-field
          v-model="searchQuery"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          placeholder="Search panels..."
          :prepend-inner-icon="mdiMagnify"
          class="mr-3"
          style="max-width: 320px"
        />
        <v-spacer />
        <v-btn color="primary" variant="flat" density="compact" @click="openCreate">
          New Panel
        </v-btn>
        <v-btn :icon="mdiClose" variant="text" size="small" class="ml-1" @click="close" />
      </v-toolbar>

      <v-card-text class="pa-0">
        <v-table hover density="compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Source</th>
              <th>Genes</th>
              <th>Created</th>
              <th style="width: 140px">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredPanels.length === 0">
              <td colspan="6" class="text-center text-medium-emphasis py-6">
                {{
                  panels.length === 0
                    ? 'No panels yet. Create one to get started.'
                    : 'No panels match your search.'
                }}
              </td>
            </tr>
            <tr v-for="panel in filteredPanels" :key="panel.id">
              <td>
                <span class="font-weight-bold">{{ panel.name }}</span>
                <div v-if="panel.description" class="text-caption text-medium-emphasis">
                  {{ panel.description }}
                </div>
              </td>
              <td>{{ panel.version ?? '-' }}</td>
              <td>
                <v-chip size="x-small" label :color="sourceColor(panel.source)">
                  {{ panel.source }}
                </v-chip>
              </td>
              <td>{{ panel.gene_count }}</td>
              <td>{{ formatDate(panel.created_at) }}</td>
              <td>
                <div class="d-flex ga-1">
                  <v-btn
                    size="x-small"
                    variant="text"
                    :icon="mdiPencil"
                    @click="openEdit(panel.id)"
                  />
                  <v-btn
                    size="x-small"
                    variant="text"
                    :icon="mdiContentCopy"
                    @click="duplicate(panel)"
                  />
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="error"
                    :icon="mdiDelete"
                    @click="confirmDelete(panel)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- Panel editor sub-dialog -->
    <PanelEditorDialog v-model="editorOpen" :edit-panel-id="editingPanelId" @saved="onPanelSaved" />

    <!-- Delete confirmation sub-dialog -->
    <v-dialog v-model="deleteDialogOpen" max-width="400">
      <v-card>
        <v-card-title>Delete Panel</v-card-title>
        <v-card-text>
          Are you sure you want to delete
          <strong>{{ deletingPanel?.name }}</strong
          >? This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialogOpen = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import PanelEditorDialog from './PanelEditorDialog.vue'
import { usePanelManager } from '../../composables/usePanelManager'
import type { PanelListItem } from '../../composables/usePanelManager'
import { mdiClose, mdiContentCopy, mdiDelete, mdiMagnify, mdiPencil } from '@mdi/js'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  panelsChanged: []
}>()

const { panels, loadPanels, duplicatePanel, deletePanel } = usePanelManager()

const searchQuery = ref('')
const editorOpen = ref(false)
const editingPanelId = ref<number | null>(null)
const deleteDialogOpen = ref(false)
const deletingPanel = ref<PanelListItem | null>(null)

// Load panels when dialog opens
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      loadPanels()
    }
  }
)

const filteredPanels = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return panels.value
  return panels.value.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.description?.toLowerCase().includes(query) ?? false) ||
      p.source.toLowerCase().includes(query)
  )
})

function sourceColor(source: string): string {
  const colors: Record<string, string> = {
    manual: 'primary',
    panelapp_uk: 'success',
    panelapp_aus: 'purple',
    stringdb: 'orange',
    bed_import: 'grey'
  }
  return colors[source] ?? 'grey'
}

function formatDate(dateStr: string | number): string {
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return String(dateStr)
  }
}

function openCreate(): void {
  editingPanelId.value = null
  editorOpen.value = true
}

function openEdit(id: number): void {
  editingPanelId.value = id
  editorOpen.value = true
}

async function duplicate(panel: PanelListItem): Promise<void> {
  await duplicatePanel(panel.id, panel.name + ' (copy)')
  emit('panelsChanged')
}

function confirmDelete(panel: PanelListItem): void {
  deletingPanel.value = panel
  deleteDialogOpen.value = true
}

async function doDelete(): Promise<void> {
  if (!deletingPanel.value) return
  await deletePanel(deletingPanel.value.id)
  deleteDialogOpen.value = false
  deletingPanel.value = null
  emit('panelsChanged')
}

function onPanelSaved(): void {
  loadPanels()
  emit('panelsChanged')
}

function close(): void {
  emit('update:modelValue', false)
}
</script>
