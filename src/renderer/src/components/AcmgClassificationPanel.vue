<template>
  <div class="acmg-classification-panel">
    <!-- Classification Result Banner -->
    <v-alert
      v-if="effectiveClassification"
      :color="ACMG_COLORS[effectiveClassification]"
      variant="tonal"
      density="compact"
      class="mb-3 classification-banner"
    >
      <div class="d-flex align-center justify-space-between">
        <div class="d-flex align-center ga-2">
          <v-chip
            :color="ACMG_COLORS[effectiveClassification]"
            size="small"
            label
            variant="elevated"
            class="font-weight-bold"
          >
            {{ effectiveClassification }}
          </v-chip>
          <span class="text-caption font-weight-medium">
            {{ classificationResult.netPoints }} net pts
          </span>
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

    <!-- Empty state hint -->
    <div v-else class="empty-state-hint text-caption text-medium-emphasis mb-2 pa-2">
      <v-icon size="x-small" class="mr-1">mdi-information-outline</v-icon>
      Select evidence codes below to classify this variant
    </div>

    <!-- Actions Row (moved above grids for better workflow) -->
    <div class="d-flex ga-1 mb-3">
      <v-btn
        v-if="variantData"
        variant="tonal"
        size="x-small"
        density="compact"
        color="amber-darken-2"
        prepend-icon="mdi-lightbulb-on"
        @click="handleAutoSuggest"
      >
        Auto-suggest
      </v-btn>
      <v-menu v-if="effectiveClassification || activeCodes.length > 0" location="bottom">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            variant="tonal"
            size="x-small"
            density="compact"
            color="grey-darken-1"
            prepend-icon="mdi-pencil"
          >
            Override
          </v-btn>
        </template>
        <v-list density="compact" nav>
          <v-list-item
            v-for="cls in ACMG_CLASSIFICATIONS"
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

    <!-- Pathogenic Criteria Section -->
    <div class="criteria-section criteria-section--pathogenic mb-3">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption font-weight-bold">Pathogenic criteria</span>
        <v-chip
          size="x-small"
          variant="tonal"
          :color="classificationResult.pathogenicPoints > 0 ? 'error' : 'grey'"
          label
        >
          +{{ classificationResult.pathogenicPoints }} pts
        </v-chip>
      </div>

      <!-- Grouped by strength -->
      <div v-for="group in pathogenicGroups" :key="group.label" class="mb-1">
        <div class="text-caption text-medium-emphasis mb-half strength-label">
          {{ group.label }}
          <span class="text-disabled"
            >({{ group.points }}pt{{ group.points !== 1 ? 's' : '' }})</span
          >
        </div>
        <div class="criteria-grid">
          <v-tooltip v-for="code in group.codes" :key="code" location="top" :open-delay="300">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :color="getButtonColor(code)"
                :variant="getButtonVariant(code)"
                size="x-small"
                density="compact"
                :class="[
                  'criteria-btn text-caption',
                  {
                    'criteria-btn--suggested': isCodeSuggested(code),
                    'criteria-btn--deprecated': isDeprecated(code)
                  }
                ]"
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
              <div v-if="isDeprecated(code)" class="text-caption mt-1 text-warning">
                Not recommended (ClinGen 2020)
              </div>
              <div v-if="isCodeSuggested(code)" class="text-caption mt-1 font-italic">
                Click to confirm suggestion
              </div>
            </div>
          </v-tooltip>
        </div>
      </div>
    </div>

    <!-- Benign Criteria Section -->
    <div class="criteria-section criteria-section--benign mb-3">
      <div class="d-flex align-center justify-space-between mb-1">
        <span class="text-caption font-weight-bold">Benign criteria</span>
        <v-chip
          size="x-small"
          variant="tonal"
          :color="classificationResult.benignPoints > 0 ? 'success' : 'grey'"
          label
        >
          -{{ classificationResult.benignPoints }} pts
        </v-chip>
      </div>

      <div v-for="group in benignGroups" :key="group.label" class="mb-1">
        <div class="text-caption text-medium-emphasis mb-half strength-label">
          {{ group.label }}
          <span class="text-disabled"
            >({{ group.points }}pt{{ group.points !== 1 ? 's' : '' }})</span
          >
        </div>
        <div class="criteria-grid">
          <v-tooltip v-for="code in group.codes" :key="code" location="top" :open-delay="300">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :color="getButtonColor(code)"
                :variant="getButtonVariant(code)"
                size="x-small"
                density="compact"
                :class="[
                  'criteria-btn text-caption',
                  {
                    'criteria-btn--suggested': isCodeSuggested(code),
                    'criteria-btn--deprecated': isDeprecated(code)
                  }
                ]"
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
              <div v-if="isDeprecated(code)" class="text-caption mt-1 text-warning">
                Not recommended (ClinGen 2020)
              </div>
              <div v-if="isCodeSuggested(code)" class="text-caption mt-1 font-italic">
                Click to confirm suggestion
              </div>
            </div>
          </v-tooltip>
        </div>
      </div>
    </div>

    <!-- Strength Override for Active Codes -->
    <div v-if="activeCodes.length > 0" class="mb-3">
      <div class="text-caption font-weight-bold mb-1">Active evidence</div>
      <div class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="entry in activeCodes"
          :key="entry.code"
          :color="STRENGTH_COLORS[entry.strength]"
          size="small"
          label
          closable
          @click:close="
            () => {
              toggleCode(entry.code)
              emitChange()
            }
          "
        >
          {{ entry.code }}
          <span class="ml-1 text-caption opacity-70"
            >{{ getStrengthPoints(entry.strength) }}pt</span
          >
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
import { computed, watch } from 'vue'
import type { AcmgClassification } from '../../../main/database/types'
import type { AcmgCode, EvidenceStrength, AcmgEvidenceCode } from '../utils/acmg/types'
import {
  PATHOGENIC_CODES,
  BENIGN_CODES,
  CODE_DESCRIPTIONS,
  DEFAULT_STRENGTHS,
  STRENGTH_OPTIONS,
  EVIDENCE_POINTS,
  DEPRECATED_CODES
} from '../utils/acmg/types'
import type { VariantAnnotationData } from '../utils/acmg/acmg-suggestions'
import { useAcmgEvidence } from '../composables/useAcmgEvidence'
import { ACMG_COLORS, ACMG_CLASSIFICATIONS } from '../composables/useAnnotations'

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

/** Color per strength level for active code chips/buttons */
const STRENGTH_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple',
  strong: 'orange-darken-2',
  moderate: 'amber-darken-1',
  supporting: 'blue-grey',
  stand_alone: 'red-darken-2'
}

/** Muted color hints for inactive (unselected) buttons by default strength */
const INACTIVE_COLORS: Record<EvidenceStrength, string> = {
  very_strong: 'deep-purple-lighten-5',
  strong: 'orange-lighten-5',
  moderate: 'amber-lighten-5',
  supporting: 'blue-grey-lighten-5',
  stand_alone: 'red-lighten-5'
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

interface CodeGroup {
  label: string
  points: number
  codes: AcmgCode[]
}

/** Group pathogenic codes by strength category */
const pathogenicGroups = computed((): CodeGroup[] => [
  {
    label: 'Very Strong',
    points: 8,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PVS')) as unknown as AcmgCode[]
  },
  {
    label: 'Strong',
    points: 4,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PS')) as unknown as AcmgCode[]
  },
  {
    label: 'Moderate',
    points: 2,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PM')) as unknown as AcmgCode[]
  },
  {
    label: 'Supporting',
    points: 1,
    codes: PATHOGENIC_CODES.filter((c) => c.startsWith('PP')) as unknown as AcmgCode[]
  }
])

/** Group benign codes by strength category */
const benignGroups = computed((): CodeGroup[] => [
  {
    label: 'Stand-Alone',
    points: 8,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BA')) as unknown as AcmgCode[]
  },
  {
    label: 'Strong',
    points: 4,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BS')) as unknown as AcmgCode[]
  },
  {
    label: 'Supporting',
    points: 1,
    codes: BENIGN_CODES.filter((c) => c.startsWith('BP')) as unknown as AcmgCode[]
  }
])

function getCodeStrength(code: AcmgCode): EvidenceStrength {
  const all = [...pathogenicCodes.value, ...benignCodes.value]
  const entry = all.find((c) => c.code === code)
  const prefix = code.replace(/\d+$/, '')
  return entry?.strength ?? DEFAULT_STRENGTHS[prefix] ?? 'supporting'
}

function getDefaultStrength(code: string): EvidenceStrength {
  const prefix = code.replace(/\d+$/, '')
  return DEFAULT_STRENGTHS[prefix] ?? 'supporting'
}

function isDeprecated(code: AcmgCode): boolean {
  return DEPRECATED_CODES.has(code)
}

function getButtonColor(code: AcmgCode): string {
  if (isCodeActive(code)) return STRENGTH_COLORS[getCodeStrength(code)]
  if (isCodeSuggested(code)) return 'amber-darken-2'
  if (isDeprecated(code)) return 'grey-lighten-2'
  return INACTIVE_COLORS[getDefaultStrength(code)]
}

function getButtonVariant(code: AcmgCode): 'flat' | 'outlined' | 'tonal' {
  if (isCodeActive(code)) return 'flat'
  if (isCodeSuggested(code)) return 'outlined'
  return 'tonal'
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
</script>

<style scoped>
.acmg-classification-panel {
  font-size: 13px;
}

.classification-banner :deep(.v-alert__content) {
  width: 100%;
}

.empty-state-hint {
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  text-align: center;
}

.criteria-section {
  border-left: 3px solid transparent;
  padding-left: 8px;
}

.criteria-section--pathogenic {
  border-left-color: rgba(211, 47, 47, 0.3);
}

.criteria-section--benign {
  border-left-color: rgba(56, 142, 60, 0.3);
}

.strength-label {
  font-size: 10px !important;
  line-height: 1.2;
}

.mb-half {
  margin-bottom: 2px;
}

.criteria-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.criteria-btn {
  min-width: 0 !important;
  padding: 2px 8px !important;
  font-size: 11px !important;
  letter-spacing: 0 !important;
  height: 26px !important;
}

.criteria-btn--suggested {
  border-style: dashed !important;
}

.criteria-btn--deprecated {
  opacity: 0.5;
  text-decoration: line-through;
}

.tooltip-content {
  max-width: 280px;
}
</style>
