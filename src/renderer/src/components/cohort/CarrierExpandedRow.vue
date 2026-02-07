<template>
  <tr>
    <td :colspan="colspan" class="pa-0">
      <v-table density="compact" class="nested-carriers-table bg-grey-lighten-3">
        <thead>
          <tr>
            <th class="text-left">Case</th>
            <th class="text-left">Zygosity</th>
            <th class="text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="carrier in carriers" :key="carrier.case_id">
            <td>{{ carrier.case_name }}</td>
            <td>
              <v-chip
                size="x-small"
                :color="isHomozygous(carrier.gt_num) ? 'error' : 'warning'"
                label
              >
                {{ formatZygosity(carrier.gt_num) }}
              </v-chip>
            </td>
            <td>
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-open-in-app"
                @click="emit('navigate-to-case', carrier.case_id)"
              >
                View in Case
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </td>
  </tr>
</template>

<script setup lang="ts">
import type { CohortCarrier } from '../../../../shared/types/cohort'

interface Props {
  carriers: CohortCarrier[]
  colspan: number
}

interface Emits {
  (e: 'navigate-to-case', caseId: number): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

// Zygosity helper functions
const isHomozygous = (gt: string): boolean => {
  return gt.includes('1/1') || gt.includes('1|1')
}

const formatZygosity = (gt: string): string => {
  return isHomozygous(gt) ? 'hom' : 'het'
}
</script>

<style scoped>
.nested-carriers-table {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
