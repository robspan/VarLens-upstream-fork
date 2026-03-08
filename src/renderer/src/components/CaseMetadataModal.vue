<template>
  <v-dialog v-model="open" max-width="700px" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ caseName }}</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
      </v-card-title>

      <v-divider />

      <div class="d-flex ga-4 px-4 py-2 text-body-medium text-medium-emphasis bg-grey-lighten-4">
        <span>
          <v-icon size="x-small" class="mr-1">mdi-dna</v-icon>
          {{ variantCount.toLocaleString() }} variants
        </span>
        <span>
          <v-icon size="x-small" class="mr-1">mdi-calendar</v-icon>
          Imported {{ formatDate(createdAt) }}
        </span>
      </div>

      <v-tabs v-model="activeTab" bg-color="secondary" density="compact">
        <v-tab value="overview">
          <v-icon start size="small">mdi-information-outline</v-icon>
          Overview
        </v-tab>
        <v-tab value="comments">
          <v-icon start size="small">mdi-comment-text-outline</v-icon>
          Comments
          <v-badge
            v-if="commentCount > 0"
            :content="commentCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
        <v-tab value="metrics">
          <v-icon start size="small">mdi-chart-box-outline</v-icon>
          Metrics
          <v-badge
            v-if="metricCount > 0"
            :content="metricCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
      </v-tabs>

      <v-card-text class="pa-4" style="min-height: 300px; max-height: 500px; overflow-y: auto">
        <v-tabs-window v-model="activeTab">
          <v-tabs-window-item value="overview">
            <CaseMetadataCard :case-id="caseId" />
          </v-tabs-window-item>

          <v-tabs-window-item value="comments">
            <CaseCommentsTab :case-id="caseId" />
          </v-tabs-window-item>

          <v-tabs-window-item value="metrics">
            <CaseMetricsTab :case-id="caseId" />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'
import CaseCommentsTab from './CaseCommentsTab.vue'
import CaseMetricsTab from './CaseMetricsTab.vue'
import { useCaseComments } from '../composables/useCaseComments'
import { useCaseMetrics } from '../composables/useCaseMetrics'

const props = defineProps<{
  caseId: number
  caseName: string
  variantCount: number
  createdAt: number
}>()

const open = ref(false)
const activeTab = ref('overview')

const { getComments } = useCaseComments()
const { getMetrics } = useCaseMetrics()

const commentCount = computed(() => getComments(props.caseId).length)
const metricCount = computed(() => getMetrics(props.caseId).length)

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
