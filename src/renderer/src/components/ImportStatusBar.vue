<template>
  <v-sheet
    v-if="importStore.isActive"
    color="grey-lighten-3"
    class="import-status-bar d-flex align-center px-3 py-1"
    elevation="1"
  >
    <v-progress-linear
      :model-value="importStore.overallPercent"
      :indeterminate="importStore.phase === 'finalizing'"
      color="primary"
      height="4"
      rounded
      class="mr-3 flex-grow-1"
      style="max-width: 200px"
    />

    <span class="text-caption text-truncate mr-2" style="max-width: 200px">
      {{ importStore.currentFileName }}
    </span>

    <span class="text-caption text-medium-emphasis mr-2">
      {{ importStore.variantCount.toLocaleString() }} variants
    </span>

    <span class="text-caption text-medium-emphasis mr-2">
      {{ formattedElapsed }}
    </span>

    <v-spacer />

    <v-btn size="x-small" variant="text" @click="$emit('expand')"> Expand </v-btn>

    <v-btn size="x-small" variant="text" color="error" @click="$emit('cancel')"> Cancel </v-btn>
  </v-sheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useImportStatusStore } from '../stores/importStatusStore'

const importStore = useImportStatusStore()

defineEmits<{
  expand: []
  cancel: []
}>()

const formattedElapsed = computed(() => {
  const ms = importStore.elapsedMs
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
})
</script>

<style scoped>
.import-status-bar {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  height: 36px;
  min-height: 36px;
}
</style>
