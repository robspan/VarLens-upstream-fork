<template>
  <div class="text-caption text-medium-emphasis mb-3">Choose import source</div>
  <div class="d-flex flex-wrap ga-3">
    <v-card
      v-for="src in sources"
      :key="src.mode"
      variant="outlined"
      class="import-source-card flex-grow-1"
      :class="{ 'import-source-card--disabled': pending }"
      min-width="130"
      role="button"
      :tabindex="pending ? -1 : 0"
      :aria-disabled="pending"
      @click="select(src.mode)"
      @keydown.enter="select(src.mode)"
    >
      <v-card-text class="d-flex flex-column align-center text-center pa-3">
        <v-icon :icon="src.icon" size="24" color="primary" class="mb-1" />
        <div class="text-body-2 font-weight-medium">{{ src.title }}</div>
        <div class="text-caption text-medium-emphasis">{{ src.subtitle }}</div>
      </v-card-text>
    </v-card>
  </div>
  <v-progress-linear
    v-if="pending"
    indeterminate
    color="primary"
    class="mt-4"
    aria-label="Preparing selected import source"
  />
</template>

<script setup lang="ts">
export type ImportSourceMode = 'single' | 'files' | 'folder' | 'zip'

export interface ImportSourceOption {
  mode: ImportSourceMode
  icon: string
  title: string
  subtitle: string
}

const props = defineProps<{
  sources: ImportSourceOption[]
  pending: boolean
}>()

const emit = defineEmits<{
  select: [mode: ImportSourceMode]
}>()

function select(mode: ImportSourceMode): void {
  if (!props.pending) emit('select', mode)
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

.import-source-card--disabled {
  cursor: wait;
  opacity: 0.65;
  pointer-events: none;
}
</style>
