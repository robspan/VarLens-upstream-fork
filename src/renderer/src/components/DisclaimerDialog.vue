<template>
  <v-dialog v-model="isOpen" max-width="700" persistent scrim>
    <v-card>
      <v-card-title>{{ config.title }}</v-card-title>
      <v-card-text style="max-height: 70vh; overflow-y: auto">
        <p class="mb-4">{{ config.introduction }}</p>
        <v-alert
          v-for="(limitation, index) in config.limitations"
          :key="index"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          <template #title>
            <span class="text-body-small font-weight-bold">{{ limitation.title }}</span>
          </template>
          <span class="text-body-small">{{ limitation.text }}</span>
        </v-alert>
        <p class="mt-4 text-body-small font-italic text-medium-emphasis">{{ config.footer }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="handleAcknowledge">
          {{ config.acknowledgeButtonText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import disclaimerConfig from '../config/disclaimerConfig.json'
import { useVersionGating } from '../composables/useVersionGating'

const config = disclaimerConfig
const isOpen = ref(false)

const { needsAcknowledgment, recordAcknowledgment } = useVersionGating()

const emit = defineEmits<{
  acknowledged: []
}>()

const handleAcknowledge = (): void => {
  recordAcknowledgment()
  isOpen.value = false
  emit('acknowledged')
}

const checkAndShow = (): void => {
  if (needsAcknowledgment()) {
    isOpen.value = true
  }
}

const show = (): void => {
  isOpen.value = true
}

defineExpose({ checkAndShow, show })
</script>
