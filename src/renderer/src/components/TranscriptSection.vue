<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { TranscriptAnnotation } from '../../../shared/types/transcript'
import { useTranscripts } from '../composables/useTranscripts'

const props = defineProps<{
  variantId: number | null
}>()

const emit = defineEmits<{
  'transcript-switched': []
}>()

const variantIdRef = toRef(props, 'variantId')
const { transcripts, loading, switchTranscript } = useTranscripts(variantIdRef)

const hasTranscripts = computed(() => transcripts.value.length > 0)

const headers = [
  { title: 'Transcript', key: 'transcript_id', sortable: false },
  { title: 'Gene', key: 'gene_symbol', sortable: false },
  { title: 'Consequence', key: 'consequence', sortable: false },
  { title: 'cDNA', key: 'cdna', sortable: false },
  { title: 'Protein', key: 'aa_change', sortable: false },
  { title: 'Status', key: 'status', sortable: false, width: '180px' }
]

function consequenceColor(consequence: string | null): string {
  if (consequence === null) return 'grey'
  if (consequence === 'HIGH') return 'error'
  if (consequence === 'MODERATE') return 'warning'
  if (consequence === 'LOW') return 'info'
  return 'grey'
}

async function handleSwitch(transcript: TranscriptAnnotation): Promise<void> {
  const success = await switchTranscript(transcript.transcript_id)
  if (success) {
    emit('transcript-switched')
  }
}
</script>

<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-title class="d-flex align-center text-subtitle-1 py-2 px-4">
      Transcripts
      <v-chip v-if="hasTranscripts" size="x-small" class="ml-2" color="secondary">
        {{ transcripts.length }}
      </v-chip>
    </v-card-title>

    <v-divider />

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <div v-if="!loading && !hasTranscripts" class="pa-4 text-body-2 text-medium-emphasis">
      No transcript annotations available for this variant.
    </div>

    <v-data-table
      v-if="hasTranscripts && !loading"
      :headers="headers"
      :items="transcripts"
      density="compact"
      :items-per-page="-1"
      hide-default-footer
      class="transcript-table"
    >
      <template #[`item.consequence`]="{ value }">
        <v-chip v-if="value" :color="consequenceColor(value)" size="x-small" label>
          {{ value }}
        </v-chip>
        <span v-else class="text-medium-emphasis">-</span>
      </template>

      <template #[`item.cdna`]="{ value }">
        <span class="text-body-2">{{ value ?? '-' }}</span>
      </template>

      <template #[`item.aa_change`]="{ value }">
        <span class="text-body-2">{{ value ?? '-' }}</span>
      </template>

      <template #[`item.status`]="{ item }">
        <div class="d-flex ga-1 align-center">
          <v-chip v-if="item.is_selected" size="x-small" color="primary" label> Selected </v-chip>
          <v-chip v-if="item.is_mane_select" size="x-small" color="teal" label> MANE </v-chip>
          <v-chip v-if="item.is_canonical" size="x-small" color="grey" label> Canonical </v-chip>
          <v-btn
            v-if="!item.is_selected"
            size="x-small"
            variant="text"
            color="primary"
            @click="handleSwitch(item)"
          >
            Use
          </v-btn>
        </div>
      </template>
    </v-data-table>
  </v-card>
</template>

<style scoped>
.transcript-table :deep(th) {
  font-size: 0.75rem !important;
}
</style>
