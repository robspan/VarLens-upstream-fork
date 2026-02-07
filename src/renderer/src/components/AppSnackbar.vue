<template>
  <v-snackbar v-model="snackbar" :color="color" :timeout="timeout" location="bottom right">
    {{ message }}
    <template #actions>
      <v-btn v-if="actionText" variant="text" @click="handleAction">{{ actionText }}</v-btn>
      <v-btn variant="text" @click="snackbar = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const snackbar = ref(false)
const message = ref('')
const color = ref<'success' | 'error'>('success')
const timeout = ref(3000)
const actionText = ref<string | null>(null)
const actionCallback = ref<(() => void) | null>(null)

interface ShowOptions {
  action?: {
    text: string
    callback: () => void
  }
  timeout?: number
}

const show = (msg: string, type: 'success' | 'error' = 'success', options?: ShowOptions): void => {
  message.value = msg
  color.value = type
  timeout.value = options?.timeout ?? (type === 'error' ? -1 : 3000)
  actionText.value = options?.action?.text ?? null
  actionCallback.value = options?.action?.callback ?? null
  snackbar.value = true
}

const handleAction = (): void => {
  if (actionCallback.value) {
    actionCallback.value()
  }
}

defineExpose({ show })
</script>
