<template>
  <span>{{ formattedFrequency }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatScientific } from '../../composables/useTableFormatters'

interface FrequencyCellProps {
  frequency: number | null
}

const props = defineProps<FrequencyCellProps>()

const formattedFrequency = computed(() => formatScientific(props.frequency))
</script>
