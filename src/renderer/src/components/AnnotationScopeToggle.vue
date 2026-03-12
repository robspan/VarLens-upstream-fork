<template>
  <v-btn-toggle
    :model-value="modelValue"
    mandatory
    density="compact"
    variant="outlined"
    divided
    class="annotation-scope-toggle"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-btn value="case" size="small">
      <v-icon start size="small">mdi-briefcase-outline</v-icon>
      Case
      <v-tooltip activator="parent" location="bottom">
        Case mode: filter and annotate for this case only
      </v-tooltip>
    </v-btn>
    <v-btn value="all" size="small">
      <v-icon start size="small">mdi-earth</v-icon>
      All
      <v-tooltip activator="parent" location="bottom">
        All mode: filter includes global annotations, actions target global
      </v-tooltip>
    </v-btn>
  </v-btn-toggle>
</template>

<script setup lang="ts">
import type { AnnotationScope } from '../../../shared/types/annotations'

defineProps<{
  modelValue: AnnotationScope
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AnnotationScope]
}>()
</script>

<style scoped>
.annotation-scope-toggle {
  height: 32px;
}
</style>
