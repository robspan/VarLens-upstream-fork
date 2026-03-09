<template>
  <v-card variant="outlined" class="mb-2">
    <v-card-title class="text-subtitle-1 pb-1">{{ label }}</v-card-title>
    <v-card-text class="pt-1">
      <!-- Saved cohort group quick-pick -->
      <v-select
        v-model="selectedCohort"
        label="Load from cohort group"
        :items="cohortGroups"
        item-title="name"
        item-value="id"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="mb-2"
        @update:model-value="handleCohortSelect"
      />

      <v-row dense>
        <v-col cols="6">
          <v-select
            v-model="statusFilter"
            label="Affected status"
            :items="['Any', 'Affected', 'Unaffected']"
            density="compact"
            variant="outlined"
            hide-details
            @update:model-value="applyFilters"
          />
        </v-col>
        <v-col cols="6">
          <v-select
            v-model="sexFilter"
            label="Sex"
            :items="['Any', 'Male', 'Female']"
            density="compact"
            variant="outlined"
            hide-details
            @update:model-value="applyFilters"
          />
        </v-col>
      </v-row>

      <!-- Case list with checkboxes -->
      <div v-if="filteredCases.length > 0" class="mt-2">
        <div class="d-flex align-center mb-1">
          <v-checkbox
            :model-value="allSelected"
            :indeterminate="someSelected && !allSelected"
            density="compact"
            hide-details
            label="Select all"
            class="mt-0"
            @update:model-value="toggleAll"
          />
          <v-spacer />
          <v-chip size="small" color="primary" variant="tonal">
            {{ selectedIds.length }} / {{ filteredCases.length }} cases
          </v-chip>
        </div>
        <div style="max-height: 200px; overflow-y: auto" class="bg-grey-lighten-3 rounded pa-1">
          <v-checkbox
            v-for="c in filteredCases"
            :key="c.id"
            :model-value="selectedIds.includes(c.id)"
            :label="`${c.name} ${c.status ? '(' + c.status + ')' : ''}`"
            density="compact"
            hide-details
            class="mt-0"
            @update:model-value="toggleCase(c.id, $event as boolean)"
          />
        </div>
      </div>
      <v-alert v-else-if="!loading" type="info" variant="tonal" density="compact" class="mt-2">
        No cases match the current filters
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

const props = defineProps<{
  modelValue: number[]
  label: string
  allCases: CaseInfo[]
  cohortGroups: CohortGroup[]
}>()

const emit = defineEmits<{
  'update:modelValue': [ids: number[]]
}>()

const selectedCohort = ref<number | null>(null)
const statusFilter = ref('Any')
const sexFilter = ref('Any')
const loading = ref(false)

const selectedIds = computed(() => props.modelValue)

const filteredCases = computed(() => {
  return props.allCases.filter((c) => {
    if (statusFilter.value !== 'Any') {
      const expected = statusFilter.value.toLowerCase()
      if (c.status !== expected) return false
    }
    if (sexFilter.value !== 'Any') {
      const expected = sexFilter.value.toLowerCase()
      if (c.sex !== expected) return false
    }
    if (selectedCohort.value !== null) {
      if (!c.cohortIds.includes(selectedCohort.value)) return false
    }
    return true
  })
})

const allSelected = computed(
  () =>
    filteredCases.value.length > 0 &&
    filteredCases.value.every((c) => selectedIds.value.includes(c.id))
)
const someSelected = computed(() =>
  filteredCases.value.some((c) => selectedIds.value.includes(c.id))
)

function toggleCase(id: number, selected: boolean): void {
  const current = [...selectedIds.value]
  if (selected) {
    if (!current.includes(id)) current.push(id)
  } else {
    const idx = current.indexOf(id)
    if (idx >= 0) current.splice(idx, 1)
  }
  emit('update:modelValue', current)
}

function toggleAll(selectAll: unknown): void {
  if (selectAll !== null && selectAll !== undefined && selectAll !== false) {
    const ids = new Set(selectedIds.value)
    for (const c of filteredCases.value) ids.add(c.id)
    emit('update:modelValue', [...ids])
  } else {
    const filteredIds = new Set(filteredCases.value.map((c) => c.id))
    emit(
      'update:modelValue',
      selectedIds.value.filter((id) => !filteredIds.has(id))
    )
  }
}

function handleCohortSelect(): void {
  applyFilters()
}

function applyFilters(): void {
  // Auto-select all matching cases when filters change
  const ids = filteredCases.value.map((c) => c.id)
  emit('update:modelValue', ids)
}
</script>
