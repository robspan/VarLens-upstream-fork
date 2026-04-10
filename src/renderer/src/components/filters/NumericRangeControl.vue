<template>
  <div class="d-flex ga-2 align-center">
    <v-text-field
      :model-value="min"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      label="Min"
      style="max-width: 120px"
      @update:model-value="updateMin"
    />
    <span class="text-disabled">…</span>
    <v-text-field
      :model-value="max"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      label="Max"
      style="max-width: 120px"
      @update:model-value="updateMax"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * NumericRangeControl — inline min/max sidebar input for extension numeric
 * columns. Emits `update:modelValue` with a `ColumnFilter` using operator
 * `>=` (min) or `<=` (max), or `undefined` when both fields are cleared.
 *
 * This is intentionally simpler than the popup NumericColumnFilter in
 * variant-table/: it only represents ONE bound at a time (the filter
 * protocol uses two separate ColumnFilter entries for an actual range).
 * The parent `ExtensionColumnFilters` dispatches min/max updates into the
 * same dotted key, so the last-written bound wins — this matches the
 * single-ColumnFilter slot per key that the backend protocol supports.
 */
import { computed } from 'vue'
import type { ColumnFilter, ColumnFilterMeta } from '../../../../shared/types/column-filters'

const props = defineProps<{
  modelValue?: ColumnFilter
  meta?: ColumnFilterMeta
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFilter | undefined]
}>()

const min = computed<number | undefined>(() => {
  if (props.modelValue?.operator === '>=' && typeof props.modelValue.value !== 'object') {
    return Number(props.modelValue.value)
  }
  return undefined
})

const max = computed<number | undefined>(() => {
  if (props.modelValue?.operator === '<=' && typeof props.modelValue.value !== 'object') {
    return Number(props.modelValue.value)
  }
  return undefined
})

function updateMin(v: string | null): void {
  if (v === null || v === '') {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', { operator: '>=', value: Number(v), includeEmpty: false })
}

function updateMax(v: string | null): void {
  if (v === null || v === '') {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', { operator: '<=', value: Number(v), includeEmpty: false })
}
</script>
