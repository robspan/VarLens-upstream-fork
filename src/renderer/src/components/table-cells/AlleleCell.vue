<template>
  <v-tooltip v-if="isTruncated" location="top">
    <template #activator="{ props: tooltipProps }">
      <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
        {{ truncatedValue }}
      </span>
    </template>
    <span class="variant-data-mono">{{ allele }}</span>
  </v-tooltip>
  <span v-else class="variant-data-mono">{{ allele }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface AlleleCellProps {
  allele: string
  maxLength?: number
}

const props = withDefaults(defineProps<AlleleCellProps>(), {
  maxLength: 20
})

const isTruncated = computed(() => props.allele.length > props.maxLength)
const truncatedValue = computed(() => {
  if (!isTruncated.value) return props.allele
  return `${props.allele.substring(0, props.maxLength)}...`
})
</script>
