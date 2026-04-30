<template>
  <v-dialog v-model="dialogOpen" max-width="720">
    <v-card>
      <v-card-title>PostgreSQL Workspace</v-card-title>

      <v-card-text>
        <v-alert
          v-if="statusMessage"
          :type="statusType"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ statusMessage }}
        </v-alert>

        <v-row>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.name"
              label="Display Name"
              density="compact"
              data-testid="postgres-name"
              :error-messages="errors.name"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.host"
              label="Host"
              density="compact"
              data-testid="postgres-host"
              :error-messages="errors.host"
            />
          </v-col>

          <v-col cols="12" sm="4">
            <v-text-field
              v-model="form.port"
              label="Port"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-port"
              :error-messages="errors.port"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="form.database"
              label="Database"
              density="compact"
              data-testid="postgres-database"
              :error-messages="errors.database"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="form.schema"
              label="Schema"
              density="compact"
              data-testid="postgres-schema"
              :error-messages="errors.schema"
            />
          </v-col>

          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.username"
              label="Username"
              density="compact"
              data-testid="postgres-username"
              :error-messages="errors.username"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.password"
              label="Password"
              density="compact"
              data-testid="postgres-password"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
              :error-messages="errors.password"
              @click:append-inner="showPassword = !showPassword"
            />
          </v-col>

          <v-col cols="12" sm="6">
            <v-select
              v-model="form.sslMode"
              label="SSL Mode"
              density="compact"
              :items="sslModeItems"
              item-title="title"
              item-value="value"
              data-testid="postgres-ssl-mode"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.poolMax"
              label="Pool Size"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-pool-size"
              :error-messages="errors.poolMax"
            />
          </v-col>

          <v-col v-if="form.sslMode === 'require-verify'" cols="12">
            <div class="d-flex align-start ga-2">
              <v-textarea
                v-model="form.caCertificatePem"
                label="CA Certificate PEM"
                density="compact"
                rows="4"
                auto-grow
                data-testid="postgres-ca-certificate"
                :error-messages="errors.caCertificatePem"
              />
              <v-btn
                icon
                variant="text"
                size="small"
                aria-label="Import CA certificate"
                @click="caFileInput?.click()"
              >
                <v-icon :icon="mdiFileUpload" />
                <v-tooltip activator="parent" location="top">Import CA certificate</v-tooltip>
              </v-btn>
              <input
                ref="caFileInput"
                type="file"
                accept=".pem,.crt,.cer,text/plain"
                class="d-none"
                @change="handleCaFileImport"
              />
            </div>
          </v-col>

          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="form.connectionTimeoutMillis"
              label="Connection Timeout"
              suffix="ms"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-connection-timeout"
              :error-messages="errors.connectionTimeoutMillis"
            />
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="form.statementTimeoutMs"
              label="Statement Timeout"
              suffix="ms"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-statement-timeout"
              :error-messages="errors.statementTimeoutMs"
            />
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="form.lockTimeoutMs"
              label="Lock Timeout"
              suffix="ms"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-lock-timeout"
              :error-messages="errors.lockTimeoutMs"
            />
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="form.idleInTransactionSessionTimeoutMs"
              label="Idle Transaction Timeout"
              suffix="ms"
              density="compact"
              inputmode="numeric"
              data-testid="postgres-idle-timeout"
              :error-messages="errors.idleInTransactionSessionTimeoutMs"
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="hide">Cancel</v-btn>
        <v-btn
          icon
          variant="text"
          :loading="testing"
          aria-label="Test connection"
          @click="handleTest"
        >
          <v-icon :icon="mdiTestTube" />
          <v-tooltip activator="parent" location="top">Test connection</v-tooltip>
        </v-btn>
        <v-btn
          icon
          variant="text"
          color="primary"
          :loading="saving"
          aria-label="Save PostgreSQL workspace"
          @click="handleSave"
        >
          <v-icon :icon="mdiContentSave" />
          <v-tooltip activator="parent" location="top">Save</v-tooltip>
        </v-btn>
        <v-btn
          icon
          variant="elevated"
          color="primary"
          :loading="connecting"
          aria-label="Connect PostgreSQL workspace"
          @click="handleConnect"
        >
          <v-icon :icon="mdiConnection" />
          <v-tooltip activator="parent" location="top">Connect</v-tooltip>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import { isIpcError } from '../../../shared/types/errors'
import {
  mdiConnection,
  mdiContentSave,
  mdiEye,
  mdiEyeOff,
  mdiFileUpload,
  mdiTestTube
} from '@mdi/js'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput,
  PostgresProfileSslMode
} from '../../../shared/types/postgres-profile'

type StatusType = 'success' | 'error'
type NumericField =
  | 'port'
  | 'poolMax'
  | 'connectionTimeoutMillis'
  | 'statementTimeoutMs'
  | 'lockTimeoutMs'
  | 'idleInTransactionSessionTimeoutMs'

interface FormState {
  name: string
  host: string
  port: string
  database: string
  username: string
  password: string
  schema: string
  sslMode: PostgresProfileSslMode
  caCertificatePem: string
  poolMax: string
  connectionTimeoutMillis: string
  statementTimeoutMs: string
  lockTimeoutMs: string
  idleInTransactionSessionTimeoutMs: string
}

const databaseStore = useDatabaseStore()

const dialogOpen = ref(false)
const profileId = ref<string | null>(null)
const showPassword = ref(false)
const testing = ref(false)
const saving = ref(false)
const connecting = ref(false)
const statusMessage = ref('')
const statusType = ref<StatusType>('success')
const caFileInput = ref<HTMLInputElement | null>(null)

const form = reactive<FormState>(defaultForm())
const errors = reactive<Record<keyof FormState, string>>({
  name: '',
  host: '',
  port: '',
  database: '',
  username: '',
  password: '',
  schema: '',
  sslMode: '',
  caCertificatePem: '',
  poolMax: '',
  connectionTimeoutMillis: '',
  statementTimeoutMs: '',
  lockTimeoutMs: '',
  idleInTransactionSessionTimeoutMs: ''
})

const sslModeItems: Array<{ title: string; value: PostgresProfileSslMode }> = [
  { title: 'Disable', value: 'disable' },
  { title: 'Require verify', value: 'require-verify' }
]

const isEditing = computed(() => profileId.value !== null)

const emit = defineEmits<{
  saved: [profile: PostgresConnectionProfilePublic]
  connected: []
  error: [message: string]
}>()

function defaultForm(): FormState {
  return {
    name: '',
    host: 'localhost',
    port: '5432',
    database: '',
    username: '',
    password: '',
    schema: 'public',
    sslMode: 'disable',
    caCertificatePem: '',
    poolMax: '5',
    connectionTimeoutMillis: '5000',
    statementTimeoutMs: '30000',
    lockTimeoutMs: '5000',
    idleInTransactionSessionTimeoutMs: '60000'
  }
}

function resetErrors(): void {
  for (const key of Object.keys(errors) as Array<keyof FormState>) {
    errors[key] = ''
  }
}

function resetForm(): void {
  Object.assign(form, defaultForm())
  profileId.value = null
  showPassword.value = false
  statusMessage.value = ''
  statusType.value = 'success'
  resetErrors()
}

function show(profile?: PostgresConnectionProfilePublic): void {
  resetForm()

  if (profile !== undefined) {
    profileId.value = profile.id
    Object.assign(form, {
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      database: profile.database,
      username: profile.username,
      password: '',
      schema: profile.schema,
      sslMode: profile.sslMode,
      caCertificatePem: '',
      poolMax: String(profile.poolMax),
      connectionTimeoutMillis: String(profile.connectionTimeoutMillis),
      statementTimeoutMs: String(profile.statementTimeoutMs),
      lockTimeoutMs: String(profile.lockTimeoutMs),
      idleInTransactionSessionTimeoutMs: String(profile.idleInTransactionSessionTimeoutMs)
    })
  }

  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function parseInteger(
  field: NumericField,
  label: string,
  minValue: number,
  maxValue?: number
): number | null {
  const raw = form[field].trim()
  const parsed = Number(raw)
  if (
    !Number.isInteger(parsed) ||
    parsed < minValue ||
    (maxValue !== undefined && parsed > maxValue)
  ) {
    errors[field] =
      maxValue === undefined
        ? `${label} must be ${minValue === 0 ? 'zero or a positive integer' : 'a positive integer'}`
        : `${label} must be between ${minValue} and ${maxValue}`
    return null
  }
  return parsed
}

function validate(requirePassword: true): PostgresConnectionProfileInput | null
function validate(requirePassword: false): PostgresConnectionProfileSaveInput | null
function validate(requirePassword: boolean): PostgresConnectionProfileInput | PostgresConnectionProfileSaveInput | null {
  resetErrors()
  statusMessage.value = ''

  if (!form.name.trim()) errors.name = 'Display name is required'
  if (!form.host.trim()) errors.host = 'Host is required'
  if (!form.database.trim()) errors.database = 'Database is required'
  if (!form.username.trim()) errors.username = 'Username is required'
  if (!form.schema.trim()) errors.schema = 'Schema is required'
  if ((requirePassword || !isEditing.value) && !form.password.trim()) {
    errors.password = 'Password is required'
  }
  if (
    !requirePassword &&
    isEditing.value &&
    form.password.length === 0 &&
    form.caCertificatePem.trim().length > 0
  ) {
    errors.password = 'Password is required to replace the CA certificate'
  }
  const port = parseInteger('port', 'Port', 1, 65535)
  const poolMax = parseInteger('poolMax', 'Pool size', 1, 32)
  const connectionTimeoutMillis = parseInteger('connectionTimeoutMillis', 'Connection timeout', 0)
  const statementTimeoutMs = parseInteger('statementTimeoutMs', 'Statement timeout', 0)
  const lockTimeoutMs = parseInteger('lockTimeoutMs', 'Lock timeout', 0)
  const idleInTransactionSessionTimeoutMs = parseInteger(
    'idleInTransactionSessionTimeoutMs',
    'Idle transaction timeout',
    0
  )

  if (
    Object.values(errors).some((message) => message.length > 0) ||
    port === null ||
    poolMax === null ||
    connectionTimeoutMillis === null ||
    statementTimeoutMs === null ||
    lockTimeoutMs === null ||
    idleInTransactionSessionTimeoutMs === null
  ) {
    return null
  }

  const baseInput = {
    name: form.name.trim(),
    host: form.host.trim(),
    port,
    database: form.database.trim(),
    username: form.username.trim(),
    schema: form.schema.trim(),
    sslMode: form.sslMode,
    poolMax,
    connectionTimeoutMillis,
    statementTimeoutMs,
    lockTimeoutMs,
    idleInTransactionSessionTimeoutMs
  }

  if (!requirePassword && isEditing.value && form.password.length === 0) {
    return baseInput
  }

  return {
    ...baseInput,
    secrets: {
      password: form.password,
      ...(form.sslMode === 'require-verify' && form.caCertificatePem.trim().length > 0
        ? { caCertificatePem: form.caCertificatePem.trim() }
        : {})
    }
  }
}

function showError(message: string): void {
  statusType.value = 'error'
  statusMessage.value = message
  emit('error', message)
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isIpcError(error)) return error.userMessage ?? error.message
  return String(error)
}

async function handleTest(): Promise<void> {
  const input = validate(true)
  if (input === null) return

  testing.value = true
  try {
    const result = await databaseStore.testPostgresProfile(input)
    if (result.ok) {
      statusType.value = 'success'
      statusMessage.value = result.serverVersion
        ? `Connection test succeeded (${result.serverVersion})`
        : 'Connection test succeeded'
    } else {
      showError(result.message ?? 'Connection test failed')
    }
  } catch (error) {
    showError(errorToMessage(error))
  } finally {
    testing.value = false
  }
}

async function saveProfile(): Promise<PostgresConnectionProfilePublic | null> {
  const input = validate(false)
  if (input === null) return null

  saving.value = true
  try {
    const saveInput: PostgresConnectionProfileSaveInput = {
      ...input,
      ...(profileId.value !== null ? { id: profileId.value } : {})
    }
    const savedProfile = await databaseStore.savePostgresProfile(saveInput)
    profileId.value = savedProfile.id
    form.password = ''
    statusType.value = 'success'
    statusMessage.value = 'PostgreSQL workspace saved'
    emit('saved', savedProfile)
    return savedProfile
  } catch (error) {
    showError(errorToMessage(error))
    return null
  } finally {
    saving.value = false
  }
}

async function handleSave(): Promise<void> {
  const savedProfile = await saveProfile()
  if (savedProfile !== null) hide()
}

async function handleConnect(): Promise<void> {
  connecting.value = true
  try {
    const savedProfile = await saveProfile()
    if (savedProfile === null) return

    const result = await databaseStore.openPostgresProfile(savedProfile.id)
    if (result.success) {
      form.password = ''
      emit('connected')
      hide()
    } else {
      showError(result.error ?? 'Failed to connect to PostgreSQL workspace')
    }
  } catch (error) {
    showError(errorToMessage(error))
  } finally {
    connecting.value = false
  }
}

async function handleCaFileImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return

  try {
    form.caCertificatePem = await file.text()
  } catch (error) {
    showError(errorToMessage(error))
  } finally {
    input.value = ''
  }
}

defineExpose({
  show,
  hide
})
</script>
