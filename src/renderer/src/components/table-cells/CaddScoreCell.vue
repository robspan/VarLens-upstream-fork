<template>
  <v-chip v-if="showAsChip && hasValue" :color="chipColor" size="small" label>
    {{ formattedScore }}
  </v-chip>
  <span v-else-if="hasValue">{{ formattedScore }}</span>
  <span v-else>--</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatCaddScore } from '../../composables/useTableFormatters'
import { getCaddColor } from '../../composables/useTableColors'

interface CaddScoreCellProps {
  score: number | null
  asChip?: boolean
}

const props = withDefaults(defineProps<CaddScoreCellProps>(), {
  asChip: false
})

const hasValue = computed(() => props.score !== null)
const formattedScore = computed(() => formatCaddScore(props.score))
const chipColor = computed(() => getCaddColor(props.score))
const showAsChip = computed(() => props.asChip && hasValue.value)
</script>
