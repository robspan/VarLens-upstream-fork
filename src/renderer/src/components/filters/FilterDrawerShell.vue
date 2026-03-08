<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="300"
    @update:model-value="emit('update:open', $event)"
  >
    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-body-large font-weight-medium"> All Filters </v-toolbar-title>
        <v-chip
          v-if="activeFilterCount > 0"
          size="small"
          color="primary"
          variant="flat"
          class="mr-2"
        >
          {{ activeFilterCount }}
        </v-chip>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-divider />

      <!-- Scrollable filter groups -->
      <div class="flex-grow-1 overflow-y-auto">
        <slot />
      </div>

      <!-- Footer -->
      <v-divider />
      <div class="pa-3 d-flex justify-space-between">
        <v-btn
          variant="text"
          size="small"
          color="error"
          :disabled="activeFilterCount === 0"
          @click="emit('clear-all')"
        >
          <v-icon start>mdi-filter-off</v-icon>
          Clear All
        </v-btn>
        <v-btn variant="text" size="small" @click="emit('update:open', false)"> Done </v-btn>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean
  activeFilterCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'clear-all': []
}>()
</script>
