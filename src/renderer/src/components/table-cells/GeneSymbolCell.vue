<template>
  <span v-if="value && linkUrl" class="external-link gene-symbol" @click="handleClick">
    {{ value }}
    <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
  </span>
  <span v-else class="gene-symbol">{{ value ?? '--' }}</span>
</template>

<script setup lang="ts">
interface Props {
  value: string | null
  linkUrl?: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ click: [url: string, event: MouseEvent] }>()

const handleClick = (event: MouseEvent): void => {
  if (props.linkUrl !== null && props.linkUrl !== undefined && props.linkUrl !== '') {
    emit('click', props.linkUrl, event)
  }
}
</script>
