<template>
  <v-dialog v-model="isOpen" max-width="800" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-chart-box-outline</v-icon>
        Database Overview
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="isOpen = false" />
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate class="mb-4" />

        <template v-else-if="overview">
          <!-- At a Glance: 4 tonal stat cards -->
          <div class="text-title-small mb-2">
            <v-icon size="small" class="mr-1">mdi-chart-bar</v-icon>
            At a Glance
          </div>
          <v-row dense class="mb-2">
            <v-col cols="3">
              <v-card variant="tonal" class="text-center pa-3">
                <v-icon size="24" class="mb-1">mdi-account-group</v-icon>
                <div class="text-title-large">
                  {{ overview.summary.total_cases.toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">Total Cases</div>
              </v-card>
            </v-col>
            <v-col cols="3">
              <v-card variant="tonal" class="text-center pa-3">
                <v-icon size="24" class="mb-1">mdi-dna</v-icon>
                <div class="text-title-large">
                  {{ overview.summary.total_variants.toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">Total Variants</div>
              </v-card>
            </v-col>
            <v-col cols="3">
              <v-card variant="tonal" class="text-center pa-3">
                <v-icon size="24" class="mb-1">mdi-fingerprint</v-icon>
                <div class="text-title-large">
                  {{ overview.summary.unique_variants.toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">Unique Variants</div>
              </v-card>
            </v-col>
            <v-col cols="3">
              <v-card variant="tonal" class="text-center pa-3">
                <v-icon size="24" class="mb-1">mdi-set-none</v-icon>
                <div class="text-title-large">
                  {{ overview.summary.genes_with_variants.toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">Genes with Variants</div>
              </v-card>
            </v-col>
          </v-row>

          <!-- Annotation stat cards: Starred + ACMG -->
          <v-row dense class="mb-4 annotation-stats-row">
            <v-col cols="6" class="d-flex">
              <v-card
                variant="tonal"
                class="text-center pa-3 d-flex flex-column align-center justify-center flex-grow-1"
              >
                <v-icon size="24" class="mb-1">mdi-star</v-icon>
                <div class="text-title-large">
                  {{ (overview.summary.starred_variants ?? 0).toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">Starred Variants</div>
              </v-card>
            </v-col>
            <v-col cols="6" class="d-flex">
              <v-card variant="tonal" class="text-center pa-3 flex-grow-1">
                <v-icon size="24" class="mb-1">mdi-tag-check</v-icon>
                <div class="text-title-large">
                  {{ totalAcmgClassified.toLocaleString() }}
                </div>
                <div class="text-body-small text-medium-emphasis">ACMG Classified</div>
                <div
                  v-if="totalAcmgClassified > 0"
                  class="mt-1 d-flex justify-center ga-1 flex-wrap"
                >
                  <v-chip
                    v-if="overview.summary.acmg_counts.pathogenic > 0"
                    size="x-small"
                    variant="tonal"
                    color="error"
                  >
                    P: {{ overview.summary.acmg_counts.pathogenic }}
                  </v-chip>
                  <v-chip
                    v-if="overview.summary.acmg_counts.likely_pathogenic > 0"
                    size="x-small"
                    variant="tonal"
                    color="deep-orange"
                  >
                    LP: {{ overview.summary.acmg_counts.likely_pathogenic }}
                  </v-chip>
                  <v-chip
                    v-if="overview.summary.acmg_counts.vus > 0"
                    size="x-small"
                    variant="tonal"
                    color="amber"
                  >
                    VUS: {{ overview.summary.acmg_counts.vus }}
                  </v-chip>
                  <v-chip
                    v-if="overview.summary.acmg_counts.likely_benign > 0"
                    size="x-small"
                    variant="tonal"
                    color="light-green"
                  >
                    LB: {{ overview.summary.acmg_counts.likely_benign }}
                  </v-chip>
                  <v-chip
                    v-if="overview.summary.acmg_counts.benign > 0"
                    size="x-small"
                    variant="tonal"
                    color="success"
                  >
                    B: {{ overview.summary.acmg_counts.benign }}
                  </v-chip>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <!-- Cohort Groups Section -->
          <div class="mb-4">
            <div
              class="text-title-small mb-2 d-flex align-center cursor-pointer"
              @click="cohortGroupsExpanded = !cohortGroupsExpanded"
            >
              <v-icon size="small" class="mr-1">
                {{ cohortGroupsExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
              </v-icon>
              <v-icon size="small" class="mr-1">mdi-account-multiple</v-icon>
              Cohort Groups ({{ overview.cohortGroups.length }})
            </div>

            <v-expand-transition>
              <div v-show="cohortGroupsExpanded">
                <v-list v-if="overview.cohortGroups.length > 0" density="compact">
                  <v-list-item v-for="group in overview.cohortGroups" :key="group.id">
                    <v-list-item-title>{{ group.name }}</v-list-item-title>
                    <v-list-item-subtitle v-if="group.description">
                      {{ group.description }}
                    </v-list-item-subtitle>

                    <template #append>
                      <v-chip
                        size="x-small"
                        variant="tonal"
                        :color="group.member_count === 0 ? 'warning' : 'primary'"
                      >
                        <v-icon
                          v-if="group.member_count === 0"
                          size="x-small"
                          start
                          icon="mdi-alert-circle-outline"
                        />
                        {{ group.member_count }}
                        {{ group.member_count === 1 ? 'member' : 'members' }}
                      </v-chip>
                      <v-btn
                        icon="mdi-pencil"
                        size="x-small"
                        variant="text"
                        class="ml-1"
                        @click.stop="startEditCohort(group)"
                      />
                      <v-btn
                        icon="mdi-delete"
                        size="x-small"
                        variant="text"
                        color="error"
                        class="ml-1"
                        @click.stop="confirmDeleteCohort(group)"
                      />
                    </template>
                  </v-list-item>
                </v-list>

                <!-- Inline edit form -->
                <v-expand-transition>
                  <v-card v-if="editingCohort !== null" variant="outlined" class="mt-2 mx-2">
                    <v-card-text>
                      <div class="text-title-small mb-3">Edit "{{ editingCohort.name }}"</div>
                      <v-text-field
                        v-model="cohortEditForm.name"
                        label="Group Name"
                        variant="outlined"
                        density="compact"
                        :error-messages="cohortNameError"
                        class="mb-3"
                        maxlength="100"
                        counter
                      />
                      <v-text-field
                        v-model="cohortEditForm.description"
                        label="Description (optional)"
                        variant="outlined"
                        density="compact"
                        class="mb-3"
                        maxlength="500"
                        counter
                      />
                      <div class="d-flex ga-2">
                        <v-btn
                          color="primary"
                          variant="flat"
                          size="small"
                          :loading="cohortSaving"
                          :disabled="!isCohortFormValid"
                          @click="saveCohortEdit"
                        >
                          Save
                        </v-btn>
                        <v-btn variant="outlined" size="small" @click="cancelCohortEdit">
                          Cancel
                        </v-btn>
                      </div>
                    </v-card-text>
                  </v-card>
                </v-expand-transition>

                <div
                  v-if="overview.cohortGroups.length === 0"
                  class="text-medium-emphasis text-body-medium py-4"
                >
                  No cohort groups defined.
                </div>
              </div>
            </v-expand-transition>
          </div>

          <!-- Delete Cohort Confirmation Dialog -->
          <v-dialog v-model="cohortDeleteDialog" max-width="400">
            <v-card>
              <v-card-title>Delete Cohort Group?</v-card-title>
              <v-card-text>
                <p>
                  Are you sure you want to delete
                  <strong>{{ cohortToDelete?.name }}</strong
                  >?
                </p>
                <p
                  v-if="cohortToDelete && cohortToDelete.member_count > 0"
                  class="text-warning mt-2"
                >
                  <v-icon icon="mdi-alert" size="small" class="mr-1" />
                  This group has {{ cohortToDelete.member_count }}
                  {{ cohortToDelete.member_count === 1 ? 'case' : 'cases' }} assigned. Deleting it
                  will unlink all cases from this group.
                </p>
                <p
                  v-else-if="cohortToDelete && cohortToDelete.member_count === 0"
                  class="text-medium-emphasis mt-2"
                >
                  This group has no members.
                </p>
                <p class="text-medium-emphasis mt-2">This action cannot be undone.</p>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn variant="text" @click="cohortDeleteDialog = false">Cancel</v-btn>
                <v-btn
                  color="error"
                  variant="flat"
                  :loading="cohortDeleting"
                  @click="executeDeleteCohort"
                >
                  Delete
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>

          <!-- Tags Section -->
          <div class="mb-4">
            <div
              class="text-title-small mb-2 d-flex align-center cursor-pointer"
              @click="tagsExpanded = !tagsExpanded"
            >
              <v-icon size="small" class="mr-1">
                {{ tagsExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
              </v-icon>
              <v-icon size="small" class="mr-1">mdi-tag-multiple</v-icon>
              Tags ({{ overview.tags.length }})
            </div>

            <v-expand-transition>
              <div v-show="tagsExpanded">
                <v-list v-if="overview.tags.length > 0" density="compact">
                  <v-list-item v-for="tag in overview.tags" :key="tag.id">
                    <template #prepend>
                      <div
                        class="tag-color-indicator mr-3"
                        :style="{ backgroundColor: tag.color }"
                      />
                    </template>

                    <v-list-item-title>{{ tag.name }}</v-list-item-title>

                    <template #append>
                      <v-chip size="x-small" variant="tonal">
                        {{ tag.usage_count }} {{ tag.usage_count === 1 ? 'use' : 'uses' }}
                      </v-chip>
                      <v-btn
                        icon="mdi-pencil"
                        size="x-small"
                        variant="text"
                        class="ml-1"
                        @click.stop="startEditTag(tag)"
                      />
                      <v-btn
                        icon="mdi-delete"
                        size="x-small"
                        variant="text"
                        color="error"
                        class="ml-1"
                        @click.stop="confirmDeleteTag(tag)"
                      />
                    </template>
                  </v-list-item>
                </v-list>

                <!-- Inline tag edit form -->
                <v-expand-transition>
                  <v-card v-if="editingTag !== null" variant="outlined" class="mt-2 mx-2">
                    <v-card-text>
                      <div class="text-title-small mb-3">Edit "{{ editingTag.name }}"</div>
                      <v-text-field
                        v-model="tagEditForm.name"
                        label="Tag Name"
                        variant="outlined"
                        density="compact"
                        :error-messages="tagNameError"
                        class="mb-3"
                        maxlength="100"
                        counter
                      />
                      <v-text-field
                        v-model="tagEditForm.color"
                        label="Color (hex)"
                        variant="outlined"
                        density="compact"
                        class="mb-3"
                        maxlength="7"
                        placeholder="#000000"
                      >
                        <template #prepend-inner>
                          <div
                            class="tag-color-indicator"
                            :style="{ backgroundColor: tagEditForm.color }"
                          />
                        </template>
                      </v-text-field>
                      <div class="d-flex ga-2">
                        <v-btn
                          color="primary"
                          variant="flat"
                          size="small"
                          :loading="tagSaving"
                          :disabled="!isTagFormValid"
                          @click="saveTagEdit"
                        >
                          Save
                        </v-btn>
                        <v-btn variant="outlined" size="small" @click="cancelTagEdit">
                          Cancel
                        </v-btn>
                      </div>
                    </v-card-text>
                  </v-card>
                </v-expand-transition>

                <div
                  v-if="overview.tags.length === 0"
                  class="text-medium-emphasis text-body-medium py-4"
                >
                  No tags defined.
                </div>
              </div>
            </v-expand-transition>
          </div>

          <!-- Delete Tag Confirmation Dialog -->
          <v-dialog v-model="tagDeleteDialog" max-width="400">
            <v-card>
              <v-card-title>Delete Tag?</v-card-title>
              <v-card-text>
                <p>
                  Are you sure you want to delete
                  <strong>{{ tagToDelete?.name }}</strong
                  >?
                </p>
                <p v-if="tagToDelete && tagToDelete.usage_count > 0" class="text-warning mt-2">
                  <v-icon icon="mdi-alert" size="small" class="mr-1" />
                  This tag is assigned to {{ tagToDelete.usage_count }}
                  {{ tagToDelete.usage_count === 1 ? 'variant' : 'variants' }}. Deleting it will
                  remove all assignments.
                </p>
                <p
                  v-else-if="tagToDelete && tagToDelete.usage_count === 0"
                  class="text-medium-emphasis mt-2"
                >
                  This tag is not assigned to any variants.
                </p>
                <p class="text-medium-emphasis mt-2">This action cannot be undone.</p>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn variant="text" @click="tagDeleteDialog = false">Cancel</v-btn>
                <v-btn
                  color="error"
                  variant="flat"
                  :loading="tagDeleting"
                  @click="executeDeleteTag"
                >
                  Delete
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>

          <!-- Phenotypes Section -->
          <div class="mb-4">
            <div
              class="text-title-small mb-2 d-flex align-center cursor-pointer"
              @click="phenotypesExpanded = !phenotypesExpanded"
            >
              <v-icon size="small" class="mr-1">
                {{ phenotypesExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
              </v-icon>
              <v-icon size="small" class="mr-1">mdi-human</v-icon>
              Top Phenotypes ({{ overview.topPhenotypes.length }})
            </div>

            <v-expand-transition>
              <div v-show="phenotypesExpanded">
                <v-data-table
                  v-if="overview.topPhenotypes.length > 0"
                  :headers="phenotypeHeaders"
                  :items="overview.topPhenotypes"
                  density="compact"
                  :items-per-page="10"
                >
                  <template #[`item.case_count`]="{ item }">
                    <span class="text-right d-block">
                      {{ item.case_count.toLocaleString() }}
                    </span>
                  </template>
                </v-data-table>
                <div v-else class="text-medium-emphasis text-body-medium py-4">
                  No phenotypes assigned to any case.
                </div>
              </div>
            </v-expand-transition>
          </div>
        </template>

        <!-- Error / empty fallback -->
        <div v-else-if="error" class="text-error text-body-medium py-4">
          <v-icon size="small" class="mr-1">mdi-alert-circle</v-icon>
          {{ error }}
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type {
  DatabaseOverview,
  OverviewCohortGroup,
  OverviewTag
} from '../../../shared/types/database-overview'

const isOpen = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const overview = ref<DatabaseOverview | null>(null)

// Section expand/collapse state
const cohortGroupsExpanded = ref(true)
const tagsExpanded = ref(true)
const phenotypesExpanded = ref(true)

// Cohort edit state
const editingCohort = ref<OverviewCohortGroup | null>(null)
const cohortEditForm = ref({ name: '', description: '' })
const cohortSaving = ref(false)

// Cohort delete state
const cohortDeleteDialog = ref(false)
const cohortToDelete = ref<OverviewCohortGroup | null>(null)
const cohortDeleting = ref(false)

// Tag edit state
const editingTag = ref<OverviewTag | null>(null)
const tagEditForm = ref({ name: '', color: '' })
const tagSaving = ref(false)

// Tag delete state
const tagDeleteDialog = ref(false)
const tagToDelete = ref<OverviewTag | null>(null)
const tagDeleting = ref(false)

// Computed: total ACMG classified
const totalAcmgClassified = computed(() => {
  if (!overview.value?.summary.acmg_counts) return 0
  const c = overview.value.summary.acmg_counts
  return c.pathogenic + c.likely_pathogenic + c.vus + c.likely_benign + c.benign
})

// Cohort name validation
const cohortNameError = computed(() => {
  if (editingCohort.value !== null && cohortEditForm.value.name.trim() === '') {
    return 'Group name is required'
  }
  const trimmedName = cohortEditForm.value.name.trim().toLowerCase()
  if (overview.value && editingCohort.value) {
    const duplicate = overview.value.cohortGroups.find(
      (g) => g.name.toLowerCase() === trimmedName && g.id !== editingCohort.value!.id
    )
    if (duplicate) {
      return 'A group with this name already exists'
    }
  }
  return ''
})

const isCohortFormValid = computed(() => {
  return cohortEditForm.value.name.trim() !== '' && cohortNameError.value === ''
})

// Tag name validation
const tagNameError = computed(() => {
  if (editingTag.value !== null && tagEditForm.value.name.trim() === '') {
    return 'Tag name is required'
  }
  const trimmedName = tagEditForm.value.name.trim().toLowerCase()
  if (overview.value && editingTag.value) {
    const duplicate = overview.value.tags.find(
      (t) => t.name.toLowerCase() === trimmedName && t.id !== editingTag.value!.id
    )
    if (duplicate) {
      return 'A tag with this name already exists'
    }
  }
  return ''
})

const isTagFormValid = computed(() => {
  return tagEditForm.value.name.trim() !== '' && tagNameError.value === ''
})

// Table headers for Phenotypes
const phenotypeHeaders = [
  { title: 'HPO ID', key: 'hpo_id', sortable: true },
  { title: 'Label', key: 'hpo_label', sortable: true },
  { title: 'Case Count', key: 'case_count', sortable: true, align: 'end' as const }
]

/** Start editing a cohort group */
function startEditCohort(group: OverviewCohortGroup): void {
  editingCohort.value = group
  cohortEditForm.value = {
    name: group.name,
    description: group.description ?? ''
  }
}

/** Cancel cohort editing */
function cancelCohortEdit(): void {
  editingCohort.value = null
  cohortEditForm.value = { name: '', description: '' }
}

/** Save cohort edit */
async function saveCohortEdit(): Promise<void> {
  if (!isCohortFormValid.value || editingCohort.value === null) return

  cohortSaving.value = true
  try {
    // eslint-disable-next-line no-undef
    await window.api.caseMetadata.updateCohort(editingCohort.value.id, {
      name: cohortEditForm.value.name.trim(),
      description: cohortEditForm.value.description.trim() || null
    })
    cancelCohortEdit()
    await loadOverview()
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to update cohort group:', err)
  } finally {
    cohortSaving.value = false
  }
}

/** Open delete confirmation for a cohort group */
function confirmDeleteCohort(group: OverviewCohortGroup): void {
  cohortToDelete.value = group
  cohortDeleteDialog.value = true
}

/** Execute cohort group deletion */
async function executeDeleteCohort(): Promise<void> {
  if (cohortToDelete.value === null) return

  cohortDeleting.value = true
  try {
    // eslint-disable-next-line no-undef
    await window.api.caseMetadata.deleteCohort(cohortToDelete.value.id)

    // If we're editing the deleted group, close the edit form
    if (editingCohort.value?.id === cohortToDelete.value.id) {
      cancelCohortEdit()
    }

    await loadOverview()
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to delete cohort group:', err)
  } finally {
    cohortDeleting.value = false
    cohortDeleteDialog.value = false
    cohortToDelete.value = null
  }
}

/** Start editing a tag */
function startEditTag(tag: OverviewTag): void {
  editingTag.value = tag
  tagEditForm.value = {
    name: tag.name,
    color: tag.color
  }
}

/** Cancel tag editing */
function cancelTagEdit(): void {
  editingTag.value = null
  tagEditForm.value = { name: '', color: '' }
}

/** Save tag edit */
async function saveTagEdit(): Promise<void> {
  if (!isTagFormValid.value || editingTag.value === null) return

  tagSaving.value = true
  try {
    // eslint-disable-next-line no-undef
    await window.api.tags.update(editingTag.value.id, {
      name: tagEditForm.value.name.trim(),
      color: tagEditForm.value.color.trim()
    })
    cancelTagEdit()
    await loadOverview()
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to update tag:', err)
  } finally {
    tagSaving.value = false
  }
}

/** Open delete confirmation for a tag */
function confirmDeleteTag(tag: OverviewTag): void {
  tagToDelete.value = tag
  tagDeleteDialog.value = true
}

/** Execute tag deletion */
async function executeDeleteTag(): Promise<void> {
  if (tagToDelete.value === null) return

  tagDeleting.value = true
  try {
    // eslint-disable-next-line no-undef
    await window.api.tags.delete(tagToDelete.value.id)

    // If we're editing the deleted tag, close the edit form
    if (editingTag.value?.id === tagToDelete.value.id) {
      cancelTagEdit()
    }

    await loadOverview()
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to delete tag:', err)
  } finally {
    tagDeleting.value = false
    tagDeleteDialog.value = false
    tagToDelete.value = null
  }
}

/** Load overview data from the database IPC endpoint */
async function loadOverview(): Promise<void> {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  loading.value = true
  error.value = null
  try {
    // eslint-disable-next-line no-undef
    const data = await window.api.database.getOverview()
    // Normalize: ensure new annotation fields have safe defaults
    if (data.summary.starred_variants === undefined) {
      data.summary.starred_variants = 0
    }
    if (data.summary.acmg_counts === undefined) {
      data.summary.acmg_counts = {
        pathogenic: 0,
        likely_pathogenic: 0,
        vus: 0,
        likely_benign: 0,
        benign: 0
      }
    }
    overview.value = data
  } catch (err) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load database overview:', err)
    error.value = 'Failed to load database overview.'
  } finally {
    loading.value = false
  }
}

// Load data when dialog opens
watch(isOpen, async (open) => {
  if (open) {
    await loadOverview()
  }
})

const show = (): void => {
  isOpen.value = true
}

defineExpose({ show })
</script>

<style scoped>
.tag-color-indicator {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
