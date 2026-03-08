<template>
  <div class="d-inline-flex align-center">
    <v-tooltip :location="tooltipLocation">
      <template #activator="{ props: tipProps }">
        <v-icon v-bind="tipProps" :icon="statusIcon" :color="statusColor" :size="statusSize" />
      </template>
      {{ status }}
    </v-tooltip>
    <v-tooltip v-if="sex !== 'unknown'" :location="tooltipLocation">
      <template #activator="{ props: tipProps }">
        <v-icon v-bind="tipProps" :icon="sexIcon" :color="sexColor" :size="sexSize" class="ml-1" />
      </template>
      {{ sex }}
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { STATUS_ICONS, STATUS_COLORS, SEX_ICONS, SEX_COLORS } from '../composables/useCaseMetadata'
import type { AffectedStatus, CaseSex } from '../../../shared/types/api'

const props = withDefaults(
  defineProps<{
    status: AffectedStatus
    sex: CaseSex
    statusSize?: string
    sexSize?: string
    tooltipLocation?: 'top' | 'bottom' | 'start' | 'end'
  }>(),
  {
    statusSize: 'small',
    sexSize: 'x-small',
    tooltipLocation: 'top'
  }
)

const statusIcon = computed(() => STATUS_ICONS[props.status])
const statusColor = computed(() => STATUS_COLORS[props.status])
const sexIcon = computed(() => SEX_ICONS[props.sex])
const sexColor = computed(() => SEX_COLORS[props.sex])
</script>
