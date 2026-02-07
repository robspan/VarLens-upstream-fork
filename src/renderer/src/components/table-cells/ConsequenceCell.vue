<template>
  <v-tooltip v-if="asChip && hasValue" location="top">
    <template #activator="{ props: tooltipProps }">
      <v-chip v-bind="tooltipProps" :color="chipColor" size="small" label>
        {{ displayValue }}
      </v-chip>
    </template>
    {{ consequence }}
  </v-tooltip>
  <v-tooltip v-else-if="hasValue" location="top">
    <template #activator="{ props: tooltipProps }">
      <span v-bind="tooltipProps">{{ displayValue }}</span>
    </template>
    {{ consequence }}
  </v-tooltip>
  <span v-else>--</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getImpactColor } from '../../composables/useTableColors'

interface ConsequenceCellProps {
  consequence: string | null
  impact?: string | null
  asChip?: boolean
}

const props = withDefaults(defineProps<ConsequenceCellProps>(), {
  impact: null,
  asChip: false
})

const hasValue = computed(
  () => props.consequence !== null && props.consequence !== undefined && props.consequence !== ''
)
const displayValue = computed(() => props.consequence?.replace(/_/g, ' ') ?? '--')
const chipColor = computed(() => {
  if (props.impact !== null && props.impact !== '') {
    return getImpactColor(props.impact)
  }
  return 'grey'
})
</script>
