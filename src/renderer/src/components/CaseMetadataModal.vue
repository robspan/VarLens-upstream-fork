<template>
  <v-dialog v-model="open" max-width="600px">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ caseName }} - Metadata</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
      </v-card-title>

      <v-divider />

      <div class="d-flex ga-4 px-4 py-2 text-body-2 text-medium-emphasis bg-grey-lighten-4">
        <span>
          <v-icon size="x-small" class="mr-1">mdi-dna</v-icon>
          {{ variantCount.toLocaleString() }} variants
        </span>
        <span>
          <v-icon size="x-small" class="mr-1">mdi-calendar</v-icon>
          Imported {{ formatDate(createdAt) }}
        </span>
      </div>

      <v-card-text class="pa-4">
        <CaseMetadataCard :case-id="caseId" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'

defineProps<{
  caseId: number
  caseName: string
  variantCount: number
  createdAt: number
}>()

const open = ref(false)

const formatDate = (timestamp: number): string => {
  if (timestamp === 0) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))
}

const show = (): void => {
  open.value = true
}

defineExpose({ show })
</script>
