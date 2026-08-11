<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'

import AppHeader from '@/components/AppHeader.vue'
import { TEST_TOOL_API_KEY } from '@/features/test-tool/test-tool-api-key'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import type {
  BatteryTestEventRequest,
  TestToolApiFailureReason,
  TestToolDevice,
  TestToolEventResult,
} from '@/features/test-tool/test-tool-api'

const UINT32_MAX = 4_294_967_295
const testToolApi = inject(TEST_TOOL_API_KEY, null)
const authStore = inject(AUTH_STORE_KEY, null)
let lifecycleGeneration = 0
let unregisterSessionTeardown: (() => void) | null = null

const loadState = ref<'loading' | 'ready' | 'error'>('loading')
const devices = ref<readonly TestToolDevice[]>([])
const selectedDeviceId = ref('')
const eventType = ref<'urination' | 'battery'>('urination')
const flushDuration = ref('')
const pumpDuration = ref('')
const batteryLevel = ref('75')
const batteryVoltage = ref('')
const sending = ref(false)
const validationError = ref<string | null>(null)
const submitError = ref<string | null>(null)
const result = ref<TestToolEventResult | null>(null)

function resetFeedback(): void {
  validationError.value = null
  submitError.value = null
  result.value = null
}

function clearProtectedState(): void {
  lifecycleGeneration += 1
  loadState.value = 'ready'
  devices.value = []
  selectedDeviceId.value = ''
  eventType.value = 'urination'
  flushDuration.value = ''
  pumpDuration.value = ''
  batteryLevel.value = ''
  batteryVoltage.value = ''
  sending.value = false
  resetFeedback()
}

async function loadDevices(): Promise<void> {
  const requestGeneration = ++lifecycleGeneration
  loadState.value = 'loading'
  devices.value = []
  selectedDeviceId.value = ''
  resetFeedback()
  if (testToolApi === null) {
    loadState.value = 'error'
    return
  }
  try {
    const response = await testToolApi.listDevices()
    if (requestGeneration !== lifecycleGeneration) return
    if (!response.ok) {
      loadState.value = 'error'
      return
    }
    devices.value = response.devices
    selectedDeviceId.value = response.devices[0]?.deviceId ?? ''
    loadState.value = 'ready'
  } catch {
    if (requestGeneration !== lifecycleGeneration) return
    loadState.value = 'error'
  }
}

function parseUint32(value: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= UINT32_MAX ? parsed : null
}

function parseVoltage(value: string): number | null | undefined {
  if (value === '') return undefined
  const parsed = parseUint32(value)
  return parsed !== null && parsed <= 20_000 ? parsed : null
}

function failureMessage(reason: TestToolApiFailureReason): string {
  if (reason === 'unauthorized') return '登入狀態已失效，請重新登入。'
  if (reason === 'test_device_not_found') return '此測試裝置目前不可用，請重新載入。'
  if (reason === 'rate_limited') return '送出過於頻繁，請稍後再試。'
  if (reason === 'sequence_exhausted') return '此裝置已無法建立新的測試序號。'
  if (reason === 'ingestion_unavailable') return '服務暫時無法接收事件，請稍後再試。'
  if (reason === 'invalid_request') return '測試資料無效，請檢查輸入。'
  return '無法送出測試事件，請稍後再試。'
}

async function send(request: BatteryTestEventRequest | {
  readonly eventType: 'urination'
  readonly flushDurationMs: number
  readonly pumpDurationMs: number
}): Promise<void> {
  if (sending.value || testToolApi === null || selectedDeviceId.value === '') return
  resetFeedback()
  sending.value = true
  const requestGeneration = lifecycleGeneration
  try {
    const response = await testToolApi.submitEvent(selectedDeviceId.value, request)
    if (requestGeneration !== lifecycleGeneration) return
    if (response.ok) result.value = response.result
    else submitError.value = failureMessage(response.reason)
  } catch {
    if (requestGeneration !== lifecycleGeneration) return
    submitError.value = '無法送出測試事件，請稍後再試。'
  } finally {
    if (requestGeneration === lifecycleGeneration) sending.value = false
  }
}

function submitUrination(): void {
  if (sending.value) return
  const flushDurationMs = parseUint32(flushDuration.value)
  const pumpDurationMs = parseUint32(pumpDuration.value)
  if (flushDurationMs === null || pumpDurationMs === null) {
    resetFeedback()
    validationError.value = '沖水與幫浦時間必須是 0 到 4294967295 的整數。'
    return
  }
  void send({ eventType: 'urination', flushDurationMs, pumpDurationMs })
}

function submitBattery(): void {
  if (sending.value) return
  const level = Number(batteryLevel.value)
  const voltage = parseVoltage(batteryVoltage.value)
  if (![0, 25, 50, 75, 100].includes(level) || voltage === null) {
    resetFeedback()
    validationError.value = '電量必須使用固定級距，電壓必須是 0 到 20000 的整數。'
    return
  }
  void send({
    eventType: 'battery',
    batteryLevelPercent: level as BatteryTestEventRequest['batteryLevelPercent'],
    ...(voltage === undefined ? {} : { batteryVoltageMv: voltage }),
  })
}

onMounted(() => {
  unregisterSessionTeardown = authStore?.registry.register(clearProtectedState) ?? null
  void loadDevices()
})
onUnmounted(() => {
  unregisterSessionTeardown?.()
  unregisterSessionTeardown = null
  clearProtectedState()
})
</script>

<template>
  <AppHeader />
  <main class="test-tool" data-test="test-tool-view" aria-labelledby="test-tool-title">
    <header class="test-tool__header">
      <p class="test-tool__eyebrow">Development beta</p>
      <h1 id="test-tool-title">測試事件工具</h1>
      <p>只會列出伺服器確認可用的測試裝置。</p>
    </header>

    <section class="test-tool__panel" aria-live="polite">
      <p v-if="loadState === 'loading'" data-test="test-tool-loading">正在載入測試裝置…</p>
      <div v-else-if="loadState === 'error'" data-test="test-tool-load-error">
        <p>無法載入測試裝置，請稍後再試。</p>
        <button type="button" data-test="test-tool-retry" @click="loadDevices">重新載入</button>
      </div>
      <p v-else-if="devices.length === 0" data-test="test-tool-empty">
        目前沒有可用的測試裝置。
      </p>

      <div v-else data-test="test-tool-form">
        <label class="test-tool__label" for="test-device">測試裝置</label>
        <select
          id="test-device"
          v-model="selectedDeviceId"
          data-test="test-device-select"
          :disabled="sending"
          @change="resetFeedback"
        >
          <option
            v-for="device in devices"
            :key="device.deviceId"
            :value="device.deviceId"
            data-test="test-device-option"
          >
            {{ device.displayName }}（{{ device.deviceId }}）
          </option>
        </select>

        <fieldset class="test-tool__types" :disabled="sending">
          <legend>事件類型</legend>
          <label>
            <input
              v-model="eventType"
              data-test="event-type-urination"
              type="radio"
              value="urination"
              @change="resetFeedback"
            >
            排尿
          </label>
          <label>
            <input
              v-model="eventType"
              data-test="event-type-battery"
              type="radio"
              value="battery"
              @change="resetFeedback"
            >
            電量
          </label>
        </fieldset>

        <form
          v-if="eventType === 'urination'"
          data-test="urination-form"
          class="test-tool__fields"
          @submit.prevent="submitUrination"
        >
          <label for="flush-duration">沖水時間（毫秒）</label>
          <input
            id="flush-duration"
            v-model="flushDuration"
            data-test="flush-duration"
            name="flushDurationMs"
            type="number"
            inputmode="numeric"
            min="0"
            :max="UINT32_MAX"
            step="1"
            required
            :disabled="sending"
            @input="resetFeedback"
            @keydown.enter.prevent="submitUrination"
          >
          <label for="pump-duration">幫浦時間（毫秒）</label>
          <input
            id="pump-duration"
            v-model="pumpDuration"
            data-test="pump-duration"
            name="pumpDurationMs"
            type="number"
            inputmode="numeric"
            min="0"
            :max="UINT32_MAX"
            step="1"
            required
            :disabled="sending"
            @input="resetFeedback"
            @keydown.enter.prevent="submitUrination"
          >
          <button type="submit" data-test="urination-submit" :disabled="sending">
            {{ sending ? '送出中…' : '送出排尿事件' }}
          </button>
        </form>

        <form
          v-else
          data-test="battery-form"
          class="test-tool__fields"
          @submit.prevent="submitBattery"
        >
          <label for="battery-level">電量</label>
          <select
            id="battery-level"
            v-model="batteryLevel"
            data-test="battery-level"
            :disabled="sending"
            @change="resetFeedback"
          >
            <option v-for="level in [0, 25, 50, 75, 100]" :key="level" :value="String(level)">
              {{ level }}%
            </option>
          </select>
          <label for="battery-voltage">電壓（mV，選填）</label>
          <input
            id="battery-voltage"
            v-model="batteryVoltage"
            data-test="battery-voltage"
            name="batteryVoltageMv"
            type="number"
            inputmode="numeric"
            min="0"
            max="20000"
            step="1"
            :disabled="sending"
            @input="resetFeedback"
            @keydown.enter.prevent="submitBattery"
          >
          <button type="submit" data-test="battery-submit" :disabled="sending">
            {{ sending ? '送出中…' : '送出電量事件' }}
          </button>
        </form>

        <p
          v-if="validationError"
          data-test="test-tool-validation-error"
          class="test-tool__error"
          role="alert"
        >
          {{ validationError }}
        </p>
        <p v-if="sending" data-test="test-tool-sending" role="status">正在送出測試事件…</p>
        <p
          v-if="submitError"
          data-test="test-tool-submit-error"
          class="test-tool__error"
          role="alert"
        >
          {{ submitError }}
        </p>
        <section v-if="result" data-test="test-tool-success" class="test-tool__success" aria-live="polite">
          <h2>事件已處理</h2>
          <p>結果：{{ result.status }}</p>
          <p>序號 {{ result.sequence }}</p>
          <p class="test-tool__event-id">{{ result.eventId }}</p>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.test-tool {
  display: grid;
  gap: 16px;
  padding: 0 20px 32px;
}

.test-tool__header,
.test-tool__panel {
  padding: 20px;
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.test-tool__header {
  display: grid;
  gap: 6px;
}

.test-tool__eyebrow {
  color: var(--color-brand);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.test-tool__panel,
.test-tool__fields {
  display: grid;
  gap: 12px;
}

.test-tool__label,
.test-tool__fields label,
.test-tool__types legend {
  font-weight: 700;
}

.test-tool select,
.test-tool input,
.test-tool button {
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-ink);
  font: inherit;
}

.test-tool button {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: white;
  font-weight: 700;
}

.test-tool button:disabled,
.test-tool input:disabled,
.test-tool select:disabled {
  opacity: 0.65;
}

.test-tool__types {
  display: flex;
  gap: 16px;
  margin: 16px 0 0;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.test-tool__types label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.test-tool__types input {
  min-height: auto;
}

.test-tool__error {
  color: #a12828;
}

.test-tool__success {
  display: grid;
  gap: 4px;
  padding: 14px;
  border-radius: 12px;
  background: var(--color-brand-soft);
}

.test-tool__event-id {
  overflow-wrap: anywhere;
  color: var(--color-muted);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
</style>
