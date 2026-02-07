<template>
  <span v-if="hasLink" class="external-link genomic-coordinate" @click="handleClick">
    {{ formattedPosition }}
    <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
  </span>
  <span v-else class="genomic-coordinate">{{ formattedPosition }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatPosition } from '../../composables/useTableFormatters'

interface PositionCellProps {
  position: number
  url?: string | null
}

const props = defineProps<PositionCellProps>()
const emit = defineEmits<{
  (e: 'click', url: string, event: MouseEvent): void
}>()

const formattedPosition = computed(() => formatPosition(props.position))
const hasLink = computed(() => props.url !== null && props.url !== undefined && props.url !== '')

const handleClick = (event: MouseEvent) => {
  if (props.url !== null && props.url !== undefined && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
