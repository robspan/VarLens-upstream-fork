<template>
  <div class="d-flex align-center ga-1">
    <!-- Star toggle -->
    <v-tooltip v-if="showGlobalIndicators" location="top">
      <template #activator="{ props: tooltipProps }">
        <span
          v-bind="tooltipProps"
          class="annotation-icon-wrapper"
          :class="{ 'has-global': isGlobalStarred }"
        >
          <v-icon
            :icon="isStarred ? 'mdi-star' : 'mdi-star-outline'"
            :color="isStarred ? 'amber' : 'grey-lighten-1'"
            size="small"
            class="cursor-pointer"
            @click.stop="emit('star-toggle')"
          />
        </span>
      </template>
      <span v-if="isGlobalStarred && isStarred">Starred (case + global)</span>
      <span v-else-if="isGlobalStarred">Global star (click to add case star)</span>
      <span v-else-if="isStarred">Starred for this case</span>
      <span v-else>Click to star</span>
    </v-tooltip>
    <v-icon
      v-else
      :icon="isStarred ? 'mdi-star' : 'mdi-star-outline'"
      :color="isStarred ? 'amber' : 'grey-lighten-1'"
      size="small"
      class="cursor-pointer"
      @click.stop="emit('star-toggle')"
    />

    <!-- ACMG classification -->
    <AcmgMenu @select="(c) => emit('acmg-select', c)">
      <template #activator="{ props: menuProps }">
        <v-tooltip v-if="showGlobalIndicators" location="top">
          <template #activator="{ props: tooltipPropsAcmg }">
            <span
              v-bind="{ ...menuProps, ...tooltipPropsAcmg }"
              class="annotation-icon-wrapper"
              :class="{ 'has-global': globalAcmgClassification }"
            >
              <v-chip
                v-if="acmgClassification"
                :color="ACMG_COLORS[acmgClassification]"
                size="x-small"
                label
                class="cursor-pointer"
              >
                {{ ACMG_ABBREV[acmgClassification] }}
              </v-chip>
              <v-icon
                v-else
                icon="mdi-tag-plus-outline"
                size="small"
                color="grey-lighten-1"
                class="cursor-pointer"
              />
            </span>
          </template>
          <span v-if="globalAcmgClassification && acmgClassification">
            Case: {{ acmgClassification }}<br />
            Global: {{ globalAcmgClassification }}
          </span>
          <span v-else-if="globalAcmgClassification">
            Global: {{ globalAcmgClassification }}<br />
            (click to set case classification)
          </span>
          <span v-else-if="acmgClassification">{{ acmgClassification }}</span>
          <span v-else>Set ACMG classification</span>
        </v-tooltip>
        <template v-else>
          <v-chip
            v-if="acmgClassification"
            v-bind="menuProps"
            size="x-small"
            :color="ACMG_COLORS[acmgClassification]"
            label
            class="cursor-pointer"
          >
            {{ ACMG_ABBREV[acmgClassification] }}
          </v-chip>
          <v-icon
            v-else
            v-bind="menuProps"
            icon="mdi-tag-plus-outline"
            size="small"
            color="grey-lighten-1"
            class="cursor-pointer"
          />
        </template>
      </template>
    </AcmgMenu>

    <!-- Comment icon -->
    <v-tooltip v-if="showGlobalIndicators" location="top">
      <template #activator="{ props: tooltipProps }">
        <span
          v-bind="tooltipProps"
          class="annotation-icon-wrapper"
          :class="{ 'has-global': hasGlobalComment }"
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
      <span v-if="hasGlobalComment && hasComment">Has global + case comments</span>
      <span v-else-if="hasGlobalComment">Has global comment</span>
      <span v-else-if="hasComment">Has case comment</span>
      <span v-else>Add comment</span>
    </v-tooltip>
    <v-icon
      v-else
      :icon="hasComment ? 'mdi-comment-text' : 'mdi-comment-text-outline'"
      :color="hasComment ? 'primary' : 'grey-lighten-1'"
      size="small"
      class="cursor-pointer"
      @click.stop="emit('comment-click')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AcmgClassification } from '../../../../main/database/types'
import AcmgMenu from '../AcmgMenu.vue'
import { ACMG_COLORS, ACMG_ABBREV } from '../../composables/useAnnotations'

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
}

interface Emits {
  (e: 'star-toggle'): void
  (e: 'acmg-select', classification: AcmgClassification | null): void
  (e: 'comment-click'): void
}

const props = withDefaults(defineProps<Props>(), {
  isGlobalStarred: false,
  globalAcmgClassification: null,
  hasGlobalComment: false,
  showGlobalIndicators: true
})

const emit = defineEmits<Emits>()

// For Case Analysis tooltip logic
const hasAnyComment = computed(() => props.hasComment || props.hasGlobalComment)
</script>
