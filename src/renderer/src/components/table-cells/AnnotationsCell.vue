<template>
  <div class="d-flex align-center ga-1">
    <!-- Star toggle -->
    <v-tooltip v-if="showGlobalIndicators" location="top">
      <template #activator="{ props: tooltipProps }">
        <span
          v-bind="tooltipProps"
          class="annotation-icon-wrapper"
          :class="{ 'has-global': displayGlobalStarred }"
        >
          <v-icon
            :icon="displayStarred ? 'mdi-star' : 'mdi-star-outline'"
            :color="displayStarred ? 'amber' : 'grey-lighten-1'"
            size="small"
            class="cursor-pointer"
            @click.stop="emit('star-toggle')"
          />
        </span>
      </template>
      <span v-if="displayGlobalStarred && displayStarred">Starred (case + global)</span>
      <span v-else-if="displayGlobalStarred">
        {{
          annotationScope === 'all'
            ? 'Case star (click to toggle global)'
            : 'Global star (click to add case star)'
        }}
      </span>
      <span v-else-if="displayStarred">
        {{ annotationScope === 'all' ? 'Starred globally' : 'Starred for this case' }}
      </span>
      <span v-else>Click to star</span>
    </v-tooltip>
    <v-icon
      v-else
      :icon="displayStarred ? 'mdi-star' : 'mdi-star-outline'"
      :color="displayStarred ? 'amber' : 'grey-lighten-1'"
      size="small"
      class="cursor-pointer"
      @click.stop="emit('star-toggle')"
    />

    <!-- ACMG classification (menu with quick-classify + evidence editor) -->
    <v-menu :close-on-content-click="true">
      <template #activator="{ props: menuProps }">
        <v-tooltip v-if="showGlobalIndicators" location="top">
          <template #activator="{ props: tooltipPropsAcmg }">
            <span
              v-bind="{ ...menuProps, ...tooltipPropsAcmg }"
              class="annotation-icon-wrapper"
              :class="{ 'has-global': displayGlobalAcmg }"
            >
              <v-chip
                v-if="displayAcmg"
                :color="ACMG_COLORS[displayAcmg]"
                size="x-small"
                label
                class="cursor-pointer"
              >
                {{ ACMG_ABBREV[displayAcmg] }}
              </v-chip>
              <v-icon
                v-else
                icon="mdi-clipboard-check-outline"
                size="small"
                color="grey-lighten-1"
                class="cursor-pointer"
              />
            </span>
          </template>
          <span v-if="displayGlobalAcmg && displayAcmg">
            Case: {{ displayAcmg }}<br />
            Global: {{ displayGlobalAcmg }}
          </span>
          <span v-else-if="displayGlobalAcmg"> Global: {{ displayGlobalAcmg }} </span>
          <span v-else-if="displayAcmg">{{ displayAcmg }}</span>
          <span v-else>Set ACMG classification</span>
        </v-tooltip>
        <template v-else>
          <v-chip
            v-if="displayAcmg"
            v-bind="menuProps"
            size="x-small"
            :color="ACMG_COLORS[displayAcmg]"
            label
            class="cursor-pointer"
          >
            {{ ACMG_ABBREV[displayAcmg] }}
          </v-chip>
          <v-icon
            v-else
            v-bind="menuProps"
            icon="mdi-clipboard-check-outline"
            size="small"
            color="grey-lighten-1"
            class="cursor-pointer"
          />
        </template>
      </template>
      <v-card class="pa-2" min-width="200">
        <div class="d-flex flex-wrap ga-1 mb-2">
          <v-chip
            v-for="cls in ACMG_CLASSIFICATIONS"
            :key="cls"
            :color="displayAcmg === cls ? ACMG_COLORS[cls] : undefined"
            :variant="displayAcmg === cls ? 'flat' : 'outlined'"
            size="small"
            label
            class="cursor-pointer"
            @click="emit('acmg-select', cls)"
          >
            {{ ACMG_ABBREV[cls] }}
          </v-chip>
        </div>
        <v-divider class="mb-1" />
        <v-list density="compact" class="pa-0">
          <v-list-item class="px-1" @click="emit('acmg-evidence-click')">
            <template #prepend>
              <v-icon size="small" class="mr-1">mdi-clipboard-check-outline</v-icon>
            </template>
            <v-list-item-title class="text-caption font-weight-medium">
              Evidence editor...
            </v-list-item-title>
          </v-list-item>
          <v-list-item v-if="displayAcmg" class="px-1" @click="emit('acmg-select', null)">
            <v-list-item-title class="text-caption text-medium-emphasis">
              Clear classification
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>

    <!-- Comment icon -->
    <v-tooltip v-if="showGlobalIndicators" location="top">
      <template #activator="{ props: tooltipProps }">
        <span
          v-bind="tooltipProps"
          class="annotation-icon-wrapper"
          :class="{ 'has-global': displayHasGlobalComment }"
        >
          <v-icon
            :icon="hasAnyComment ? 'mdi-comment-text' : 'mdi-comment-text-outline'"
            :color="hasAnyComment ? 'primary' : 'grey-lighten-1'"
            size="small"
            class="cursor-pointer"
            @click.stop="emit('comment-click')"
          />
        </span>
      </template>
      <span v-if="displayHasGlobalComment && displayHasComment">Has global + case comments</span>
      <span v-else-if="displayHasGlobalComment">Has global comment</span>
      <span v-else-if="displayHasComment">Has case comment</span>
      <span v-else>Add comment</span>
    </v-tooltip>
    <v-icon
      v-else
      :icon="displayHasComment ? 'mdi-comment-text' : 'mdi-comment-text-outline'"
      :color="displayHasComment ? 'primary' : 'grey-lighten-1'"
      size="small"
      class="cursor-pointer"
      @click.stop="emit('comment-click')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AcmgClassification } from '../../../../main/database/types'
import type { AnnotationScope } from '../../../../shared/types/annotations'
import { ACMG_COLORS, ACMG_ABBREV, ACMG_CLASSIFICATIONS } from '../../composables/useAnnotations'

interface Props {
  /** Current starred state (per-case for Case Analysis, global for Cohort) */
  isStarred: boolean
  /** Global starred state (Case Analysis only) */
  isGlobalStarred?: boolean
  /** Current ACMG classification (per-case for Case Analysis, global for Cohort) */
  acmgClassification: AcmgClassification | null
  /** Global ACMG classification (Case Analysis only) */
  globalAcmgClassification?: AcmgClassification | null
  /** Has comment (per-case for Case Analysis, global for Cohort) */
  hasComment: boolean
  /** Has global comment (Case Analysis only) */
  hasGlobalComment?: boolean
  /** Show global indicator rings (true for Case Analysis, false for Cohort) */
  showGlobalIndicators?: boolean
  /** Annotation scope: controls display priority and action routing */
  annotationScope?: AnnotationScope
}

interface Emits {
  (e: 'star-toggle'): void
  (e: 'acmg-select', classification: AcmgClassification | null): void
  (e: 'acmg-evidence-click'): void
  (e: 'comment-click'): void
}

const props = withDefaults(defineProps<Props>(), {
  isGlobalStarred: false,
  globalAcmgClassification: null,
  hasGlobalComment: false,
  showGlobalIndicators: true,
  annotationScope: 'case'
})

const emit = defineEmits<Emits>()

// Display swap: in "all" mode, global becomes primary, per-case becomes ring indicator
const displayStarred = computed(() =>
  props.annotationScope === 'all' ? props.isGlobalStarred : props.isStarred
)
const displayGlobalStarred = computed(() =>
  props.annotationScope === 'all' ? props.isStarred : props.isGlobalStarred
)
const displayAcmg = computed(() =>
  props.annotationScope === 'all' ? props.globalAcmgClassification : props.acmgClassification
)
const displayGlobalAcmg = computed(() =>
  props.annotationScope === 'all' ? props.acmgClassification : props.globalAcmgClassification
)
const displayHasComment = computed(() =>
  props.annotationScope === 'all' ? props.hasGlobalComment : props.hasComment
)
const displayHasGlobalComment = computed(() =>
  props.annotationScope === 'all' ? props.hasComment : props.hasGlobalComment
)

// For Case Analysis tooltip logic
const hasAnyComment = computed(() => displayHasComment.value || displayHasGlobalComment.value)
</script>
