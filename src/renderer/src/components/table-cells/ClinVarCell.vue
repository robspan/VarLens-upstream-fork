<template>
  <v-tooltip v-if="hasValue && hasLink" location="top">
    <template #activator="{ props: tooltipProps }">
      <span v-bind="tooltipProps" class="external-link" @click="handleClick">
        <v-chip :color="chipColor" size="small" label>
          {{ displayValue }}
        </v-chip>
        <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
      </span>
    </template>
    {{ significance }}
  </v-tooltip>
  <v-tooltip v-else-if="hasValue" location="top">
    <template #activator="{ props: tooltipProps }">
      <v-chip v-bind="tooltipProps" :color="chipColor" size="small" label>
        {{ displayValue }}
      </v-chip>
    </template>
    {{ significance }}
  </v-tooltip>
  <span v-else class="text-grey">--</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getClinVarColor } from '../../composables/useTableColors'

interface ClinVarCellProps {
  significance: string | null
  url?: string | null
}

const props = defineProps<ClinVarCellProps>()
const emit = defineEmits<{
  (e: 'click', url: string, event: MouseEvent): void
}>()

const hasValue = computed(
  () => props.significance !== null && props.significance !== undefined && props.significance !== ''
)
const hasLink = computed(() => props.url !== null && props.url !== undefined && props.url !== '')
const chipColor = computed(() => getClinVarColor(props.significance))
const displayValue = computed(() => props.significance?.replace(/_/g, ' ') ?? '--')

const handleClick = (event: MouseEvent) => {
  if (props.url !== null && props.url !== undefined && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
