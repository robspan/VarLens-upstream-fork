<template>
  <div>
    <!-- Active panel chips -->
    <div v-if="activePanelItems.length > 0" class="d-flex flex-wrap ga-1 mb-2">
      <v-chip
        v-for="panel in activePanelItems"
        :key="panel.id"
        size="small"
        closable
        label
        color="primary"
        variant="flat"
        @click:close="removePanel(panel.id)"
      >
        {{ panel.name }}
        <span class="text-caption ml-1">({{ panel.gene_count }})</span>
      </v-chip>
    </div>

    <!-- Add panel dropdown -->
    <v-select
      v-model="selectedPanelToAdd"
      :items="availableToAdd"
      item-title="name"
      item-value="id"
      density="compact"
      variant="outlined"
      hide-details
      placeholder="Add panel..."
      :loading="panelLoading"
      clearable
      class="mb-2"
      @update:model-value="onPanelSelected"
    >
      <!-- eslint-disable-next-line vue/no-unused-vars -->
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps" :title="undefined">
          <v-list-item-title>
            {{ (item as unknown as { raw: PanelOption }).raw.name }}
          </v-list-item-title>
          <v-list-item-subtitle>
            {{ (item as unknown as { raw: PanelOption }).raw.gene_count }} genes &middot;
            {{ (item as unknown as { raw: PanelOption }).raw.source }}
          </v-list-item-subtitle>
        </v-list-item>
      </template>
    </v-select>

    <!-- Padding control -->
    <div class="text-body-small text-medium-emphasis mb-1">Padding</div>
    <v-chip-group v-model="selectedPaddingIndex" mandatory>
      <v-chip
        v-for="opt in paddingOptions"
        :key="opt.value"
        size="small"
        label
        :color="paddingOptions[selectedPaddingIndex]?.value === opt.value ? 'primary' : undefined"
        :variant="paddingOptions[selectedPaddingIndex]?.value === opt.value ? 'flat' : 'outlined'"
      >
        {{ opt.label }}
      </v-chip>
    </v-chip-group>

    <!-- Manage panels link -->
    <v-btn
      variant="text"
      density="compact"
      size="small"
      color="primary"
      class="mt-1"
      @click="emit('openManager')"
    >
      Manage Panels
    </v-btn>
  </div>
</template>

<script setup lang="ts">
/**
 * PanelFilterSection - Panel selection UI for filter drawers
 *
 * Works with both the case-view FilterDrawer and CohortFilterDrawer
 * by accepting activePanelIds and panelPaddingBp as props with v-model.
 */
import { ref, computed, watch } from 'vue'
import { usePanelFilter, type PanelOption } from '../../composables/usePanelFilter'

const props = defineProps<{
  activePanelIds: number[]
  panelPaddingBp: number
}>()

const emit = defineEmits<{
  'update:activePanelIds': [value: number[]]
  'update:panelPaddingBp': [value: number]
  openManager: []
}>()

// Load available panels (panels are global, not per-case)
const dummyCaseId = ref(0)
const { availablePanels, loading: panelLoading } = usePanelFilter(dummyCaseId)

// Selected panel for the dropdown (transient, cleared after adding)
const selectedPanelToAdd = ref<number | null>(null)

// Padding options
const paddingOptions = [
  { label: '0', value: 0 },
  { label: '1kb', value: 1000 },
  { label: '5kb', value: 5000 },
  { label: '10kb', value: 10000 }
] as const

// Find the current padding index from prop
const selectedPaddingIndex = ref(
  Math.max(
    0,
    paddingOptions.findIndex((opt) => opt.value === props.panelPaddingBp)
  )
)

// Sync padding index -> emit
watch(selectedPaddingIndex, (idx) => {
  if (idx >= 0 && idx < paddingOptions.length) {
    emit('update:panelPaddingBp', paddingOptions[idx].value)
  }
})

// Sync prop -> index (when parent resets)
watch(
  () => props.panelPaddingBp,
  (newVal) => {
    const idx = paddingOptions.findIndex((opt) => opt.value === newVal)
    if (idx >= 0 && idx !== selectedPaddingIndex.value) {
      selectedPaddingIndex.value = idx
    }
  }
)

// Active panel items (resolved from IDs)
const activePanelItems = computed(() => {
  return props.activePanelIds
    .map((id) => availablePanels.value.find((p) => p.id === id))
    .filter((p): p is PanelOption => p !== undefined)
})

// Available panels not yet active
const availableToAdd = computed(() => {
  const activeIds = new Set(props.activePanelIds)
  return availablePanels.value.filter((p) => !activeIds.has(p.id))
})

function onPanelSelected(panelId: number | null): void {
  if (panelId != null) {
    emit('update:activePanelIds', [...props.activePanelIds, panelId])
    selectedPanelToAdd.value = null
  }
}

function removePanel(panelId: number): void {
  emit(
    'update:activePanelIds',
    props.activePanelIds.filter((id) => id !== panelId)
  )
}
</script>
