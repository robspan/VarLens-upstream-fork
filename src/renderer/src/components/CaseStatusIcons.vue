<template>
  <div class="d-inline-flex align-center">
    <v-tooltip :location="tooltipLocation">
      <template #activator="{ props: tipProps }">
        <v-icon
          v-bind="tipProps"
          :icon="statusIcon"
          :color="onToolbar ? resolvedStatusColor : statusColor"
          :size="statusSize"
        />
      </template>
      {{ status }}
    </v-tooltip>
    <v-tooltip v-if="onToolbar || sex !== 'unknown'" :location="tooltipLocation">
      <template #activator="{ props: tipProps }">
        <v-icon
          v-bind="tipProps"
          :icon="sexIcon"
          :color="onToolbar ? resolvedSexColor : sexColor"
          :size="sexSize"
          class="ml-1"
        />
      </template>
      {{ sex }}
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_ICONS, STATUS_COLORS, SEX_ICONS, SEX_COLORS } from '../composables/useCaseMetadata'
import type { AffectedStatus, CaseSex } from '../../../shared/types/api'

const TOOLBAR_COLOR_MAP: Record<string, string> = {
  'grey-darken-1': 'white',
  blue: 'light-blue-lighten-3',
  pink: 'pink-lighten-3',
  purple: 'purple-lighten-3',
  error: 'red-lighten-3',
  success: 'green-lighten-3'
}

const props = withDefaults(
  defineProps<{
    status: AffectedStatus
    sex: CaseSex
    statusSize?: string
    sexSize?: string
    tooltipLocation?: 'top' | 'bottom' | 'start' | 'end'
    onToolbar?: boolean
  }>(),
  {
    statusSize: 'small',
    sexSize: 'x-small',
    tooltipLocation: 'top',
    onToolbar: false
  }
)

const statusIcon = computed(() => STATUS_ICONS[props.status])
const statusColor = computed(() => STATUS_COLORS[props.status])
const sexIcon = computed(() => SEX_ICONS[props.sex])
const sexColor = computed(() => SEX_COLORS[props.sex])

const resolvedStatusColor = computed(
  () => TOOLBAR_COLOR_MAP[statusColor.value] ?? statusColor.value
)
const resolvedSexColor = computed(() => TOOLBAR_COLOR_MAP[sexColor.value] ?? sexColor.value)
</script>
