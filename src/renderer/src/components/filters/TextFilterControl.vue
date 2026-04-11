<template>
  <v-text-field
    :model-value="textValue"
    density="compact"
    variant="outlined"
    hide-details
    clearable
    placeholder="Substring match"
    @update:model-value="onUpdate"
  />
</template>

<script setup lang="ts">
/**
 * TextFilterControl — inline substring-match sidebar input for extension
 * text columns. Emits `update:modelValue` with
 * `{ operator: 'like', value: string }` or `undefined` when cleared.
 *
 * The backend `translateExtensionFilter` wraps the value with `%...%` and
 * uses `LIKE ? COLLATE NOCASE`, so the user just types the substring.
 *
 * `meta` is accepted on the props contract for interface consistency with
 * the other control components, but is not consumed here (no min/max/enum).
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

const textValue = computed<string>(() => {
  if (props.modelValue?.operator === 'like' && typeof props.modelValue.value === 'string') {
    return props.modelValue.value
  }
  return ''
})

function onUpdate(v: string | null): void {
  if (v === null || v.trim() === '') {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', { operator: 'like', value: v, includeEmpty: false })
}
</script>
