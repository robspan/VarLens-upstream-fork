<template>
  <div class="acmg-classification-panel">
    <!-- Classification Result Banner -->
    <v-alert
      v-if="effectiveClassification"
      :color="ACMG_COLORS[effectiveClassification]"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      <div class="d-flex align-center justify-space-between">
        <div>
          <span class="font-weight-bold text-body-2">{{ effectiveClassification }}</span>
          <span class="text-caption ml-1"> ({{ classificationResult.netPoints }} pts) </span>
        </div>
        <v-tooltip location="bottom">
          <template #activator="{ props: tooltipProps }">
            <v-icon v-bind="tooltipProps" size="x-small">mdi-information-outline</v-icon>
          </template>
          <div class="text-caption">
            Pathogenic: +{{ classificationResult.pathogenicPoints }}<br />
            Benign: -{{ classificationResult.benignPoints }}<br />
            Net: {{ classificationResult.netPoints }}
          </div>
        </v-tooltip>
      </div>
      <div v-if="isOverride" class="text-caption mt-1">
        <v-icon size="x-small" color="warning">mdi-alert</v-icon>
        Override — calculated: {{ classificationResult.classification ?? 'none' }}
      </div>
    </v-alert>

    <!-- Pathogenic Criteria Grid -->
    <div class="d-flex align-center justify-space-between mb-1">
      <span class="text-caption font-weight-bold">Pathogenic criteria</span>
      <span class="text-caption text-medium-emphasis">
        {{ classificationResult.pathogenicPoints }} points
      </span>
    </div>
    <div class="criteria-grid mb-2">
      <template v-for="code in PATHOGENIC_CODES" :key="code">
        <v-tooltip location="top" :open-delay="300">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :color="
                isCodeActive(code)
                  ? STRENGTH_COLORS[getCodeStrength(code)]
                  : isCodeSuggested(code)
                    ? 'grey-lighten-1'
                    : undefined
              "
              :variant="isCodeActive(code) ? 'flat' : isCodeSuggested(code) ? 'outlined' : 'tonal'"
              size="x-small"
              density="compact"
              class="criteria-btn text-caption"
              rounded="sm"
              @click="handleCodeClick(code)"
            >
              {{ code }}
              <v-icon v-if="isCodeSuggested(code)" size="8" class="ml-1"
                >mdi-lightbulb-outline</v-icon
              >
            </v-btn>
          </template>
          <div class="tooltip-content">
            <div class="font-weight-bold">{{ code }}</div>
            <div class="text-caption">{{ CODE_DESCRIPTIONS[code] }}</div>
            <div v-if="isCodeActive(code)" class="text-caption mt-1">
              Strength: {{ getStrengthLabel(getCodeStrength(code)) }} ({{
                getStrengthPoints(getCodeStrength(code))
              }}
              pts)
            </div>
            <div v-if="isCodeSuggested(code)" class="text-caption mt-1 font-italic">
              Click to confirm suggestion
            </div>
          </div>
        </v-tooltip>
      </template>
    </div>

    <!-- Benign Criteria Grid -->
    <div class="d-flex align-center justify-space-between mb-1">
      <span class="text-caption font-weight-bold">Benign criteria</span>
      <span class="text-caption text-medium-emphasis">
        {{ classificationResult.benignPoints }} points
      </span>
    </div>
    <div class="criteria-grid mb-2">
      <template v-for="code in BENIGN_CODES" :key="code">
        <v-tooltip location="top" :open-delay="300">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :color="
                isCodeActive(code)
                  ? STRENGTH_COLORS[getCodeStrength(code)]
                  : isCodeSuggested(code)
                    ? 'grey-lighten-1'
                    : undefined
              "
              :variant="isCodeActive(code) ? 'flat' : isCodeSuggested(code) ? 'outlined' : 'tonal'"
              size="x-small"
              density="compact"
              class="criteria-btn text-caption"
              rounded="sm"
              @click="handleCodeClick(code)"
            >
              {{ code }}
              <v-icon v-if="isCodeSuggested(code)" size="8" class="ml-1"
                >mdi-lightbulb-outline</v-icon
              >
            </v-btn>
          </template>
          <div class="tooltip-content">
            <div class="font-weight-bold">{{ code }}</div>
            <div class="text-caption">{{ CODE_DESCRIPTIONS[code] }}</div>
            <div v-if="isCodeActive(code)" class="text-caption mt-1">
              Strength: {{ getStrengthLabel(getCodeStrength(code)) }} ({{
                getStrengthPoints(getCodeStrength(code))
              }}
              pts)
            </div>
            <div v-if="isCodeSuggested(code)" class="text-caption mt-1 font-italic">
              Click to confirm suggestion
            </div>
          </div>
        </v-tooltip>
      </template>
    </div>

    <!-- Strength Override for Active Codes -->
    <div v-if="activeCodes.length > 0" class="mb-2">
      <div class="text-caption font-weight-bold mb-1">Strength adjustments</div>
      <div class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="entry in activeCodes"
          :key="entry.code"
          :color="STRENGTH_COLORS[entry.strength]"
          size="small"
          label
          closable
          @click:close="() => { toggleCode(entry.code); emitChange() }"
        >
          {{ entry.code }}
          <v-menu location="bottom" :close-on-content-click="true">
            <template #activator="{ props: menuProps }">
              <v-icon v-bind="menuProps" size="x-small" class="ml-1 cursor-pointer" @click.stop
                >mdi-chevron-down</v-icon
              >
            </template>
            <v-list density="compact" nav>
              <v-list-item
                v-for="opt in STRENGTH_OPTIONS"
                :key="opt.value"
                :active="entry.strength === opt.value"
                @click="handleStrengthChange(entry.code, opt.value)"
              >
                <v-list-item-title class="text-caption">
                  {{ opt.label }} ({{ opt.points }} pts)
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </v-chip>
      </div>
    </div>

    <!-- Actions Row -->
    <div class="d-flex ga-1 mb-2">
      <v-btn
        v-if="variantData"
        variant="outlined"
        size="x-small"
        density="compact"
        prepend-icon="mdi-lightbulb-outline"
        @click="handleAutoSuggest"
      >
        Auto-suggest
      </v-btn>
      <v-menu v-if="effectiveClassification || activeCodes.length > 0" location="bottom">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            variant="outlined"
            size="x-small"
            density="compact"
            prepend-icon="mdi-pencil"
          >
            Override
          </v-btn>
        </template>
        <v-list density="compact" nav>
          <v-list-item
            v-for="cls in CLASSIFICATIONS"
            :key="cls"
            :active="isOverride && overrideClassification === cls"
            @click="handleOverride(cls)"
          >
            <template #prepend>
              <v-icon :color="ACMG_COLORS[cls]" size="small">mdi-circle</v-icon>
            </template>
            <v-list-item-title class="text-caption">{{ cls }}</v-list-item-title>
          </v-list-item>
          <v-divider v-if="isOverride" />
          <v-list-item v-if="isOverride" @click="handleOverride(null)">
            <v-list-item-title class="text-caption text-medium-emphasis">
              Clear override
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Notes -->
    <v-textarea
      v-model="notes"
      placeholder="Evidence notes..."
      variant="outlined"
      density="compact"
      rows="1"
      auto-grow
      hide-details
      class="text-caption"
      @blur="emitChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import type { AcmgClassification } from '../../../main/database/types'
import type { AcmgCode, EvidenceStrength, AcmgEvidenceCode } from '../utils/acmg/types'
import {
  PATHOGENIC_CODES,
  BENIGN_CODES,
  CODE_DESCRIPTIONS,
  STRENGTH_OPTIONS,
  EVIDENCE_POINTS
} from '../utils/acmg/types'
import type { VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import { useAcmgEvidence } from '../composables/useAcmgEvidence'
import { ACMG_COLORS } from '../composables/useAnnotations'

const props = defineProps<{
  /** Current acmg_evidence JSON string from database */
  evidenceJson: string | null
  /** Variant annotation data for auto-suggestions */
  variantData: VariantAnnotationData | null
}>()

const emit = defineEmits<{
  /** Emitted when evidence changes. Payload: { classification, evidenceJson } */
  change: [
    payload: {
      classification: AcmgClassification | null
      evidenceJson: string
    }
  ]
}>()

const CLASSIFICATIONS: AcmgClassification[] = [
  'Pathogenic',
  'Likely Pathogenic',
  'VUS',
  'Likely Benign',
  'Benign'
]

/** Color per strength level for active code chips/buttons */
const STRENGTH_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple',
  strong: 'orange-darken-2',
  moderate: 'amber-darken-1',
  supporting: 'blue-grey',
  stand_alone: 'red-darken-2'
}

const {
  pathogenicCodes,
  benignCodes,
  notes,
  isOverride,
  overrideClassification,
  classificationResult,
  effectiveClassification,
  toggleCode,
  confirmSuggestion,
  setCodeStrength,
  applySuggestions,
  setOverride,
  loadState,
  serialize,
  isCodeActive,
  isCodeSuggested
} = useAcmgEvidence()

/** All confirmed active codes (pathogenic + benign) for the strength adjustment row */
const activeCodes = computed((): AcmgEvidenceCode[] => [
  ...pathogenicCodes.value.filter((c) => c.confirmed),
  ...benignCodes.value.filter((c) => c.confirmed)
])

function getCodeStrength(code: AcmgCode): EvidenceStrength {
  const all = [...pathogenicCodes.value, ...benignCodes.value]
  const entry = all.find((c) => c.code === code)
  const prefix = code.replace(/\d+$/, '')
  return (
    entry?.strength ??
    (
      {
        PVS: 'very_strong',
        PS: 'strong',
        PM: 'moderate',
        PP: 'supporting',
        BA: 'stand_alone',
        BS: 'strong',
        BP: 'supporting'
      } as Record<string, EvidenceStrength>
    )[prefix] ??
    'supporting'
  )
}

function getStrengthLabel(strength: EvidenceStrength): string {
  return STRENGTH_OPTIONS.find((o) => o.value === strength)?.label ?? strength
}

function getStrengthPoints(strength: EvidenceStrength): number {
  return EVIDENCE_POINTS[strength]
}

function handleCodeClick(code: AcmgCode): void {
  if (isCodeSuggested(code)) {
    confirmSuggestion(code)
  } else {
    toggleCode(code)
  }
  emitChange()
}

function handleStrengthChange(code: AcmgCode, strength: EvidenceStrength): void {
  setCodeStrength(code, strength)
  emitChange()
}

function handleAutoSuggest(): void {
  if (props.variantData) {
    applySuggestions(props.variantData)
    emitChange()
  }
}

function handleOverride(classification: AcmgClassification | null): void {
  if (classification === overrideClassification.value) {
    setOverride(null)
  } else {
    setOverride(classification)
  }
  emitChange()
}

function emitChange(): void {
  emit('change', {
    classification: effectiveClassification.value,
    evidenceJson: serialize()
  })
}

// Load state when evidence JSON changes
watch(
  () => props.evidenceJson,
  (json) => loadState(json),
  { immediate: true }
)

onMounted(() => {
  loadState(props.evidenceJson)
})
</script>

<style scoped>
.criteria-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 3px;
}

.criteria-btn {
  min-width: 0 !important;
  width: 100%;
  padding: 2px 6px !important;
  font-size: 11px !important;
  letter-spacing: 0 !important;
  height: 24px !important;
}

.tooltip-content {
  max-width: 280px;
}
</style>
