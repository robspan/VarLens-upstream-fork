<template>
  <span v-if="url" class="external-link" @click="handleClick">
    {{ label }}
    <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
  </span>
  <span v-else class="text-medium-emphasis">--</span>
</template>

<script setup lang="ts">
interface Props {
  url: string | null
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: 'View'
})

const emit = defineEmits<{ click: [url: string, event: MouseEvent] }>()

const handleClick = (event: MouseEvent): void => {
  if (props.url !== null && props.url !== '') {
    emit('click', props.url, event)
  }
}
</script>
