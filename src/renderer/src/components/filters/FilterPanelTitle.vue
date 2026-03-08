<template>
  <v-expansion-panel-title>
    <div class="d-flex align-center">
      <v-icon size="small" class="mr-2">{{ icon }}</v-icon>
      <span class="text-title-small font-weight-medium">{{ label }}</span>
      <v-chip v-if="active" size="x-small" color="primary" class="ml-2" label> Active </v-chip>
    </div>
  </v-expansion-panel-title>
</template>

<script setup lang="ts">
defineProps<{
  icon: string
  label: string
  active: boolean
}>()
</script>
