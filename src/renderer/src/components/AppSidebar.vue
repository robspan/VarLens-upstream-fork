<template>
  <div>
    <v-toolbar density="compact" color="primary" dark>
      <span class="ml-2 text-body-large font-weight-medium">
        Cases
        <span v-if="(caseCount ?? 0) > 0" class="text-body-small ml-1" style="opacity: 0.8"
          >({{ caseCount }})</span
        >
      </span>
      <v-spacer />
      <v-tooltip location="bottom">
        <template #activator="{ props: tipProps }">
          <v-btn icon size="x-small" variant="text" v-bind="tipProps">
            <v-icon size="x-small" :icon="mdiInformationOutline" />
          </v-btn>
        </template>
        <div class="text-body-small">
          <div>Ctrl+Click to multi-select cases</div>
          <div>Right-click for context menu</div>
        </div>
      </v-tooltip>
      <v-menu>
        <template #activator="{ props }">
          <v-btn icon size="small" variant="text" v-bind="props">
            <v-icon :icon="mdiPlus" />
            <v-tooltip activator="parent" location="bottom">Import variant data</v-tooltip>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item @click="$emit('import-click')">
            <template #prepend>
              <v-icon :icon="mdiFileImport" />
            </template>
            <v-list-item-title>Import File</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-files')">
            <template #prepend>
              <v-icon :icon="mdiFileMultiple" />
            </template>
            <v-list-item-title>Import Multiple Files</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-folder')">
            <template #prepend>
              <v-icon :icon="mdiFolderOpen" />
            </template>
            <v-list-item-title>Import Folder</v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('batch-import-zip')">
            <template #prepend>
              <v-icon :icon="mdiZipBox" />
            </template>
            <v-list-item-title>Import ZIP Archive</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-toolbar>

    <slot />
  </div>
</template>

<script setup lang="ts">
import { mdiFileImport, mdiFileMultiple, mdiFolderOpen, mdiInformationOutline, mdiPlus, mdiZipBox } from '@mdi/js'
defineProps<{
  caseCount?: number
}>()

defineEmits<{
  'import-click': []
  'batch-import-files': []
  'batch-import-folder': []
  'batch-import-zip': []
}>()
</script>
