<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { DEVICE_CLAIM_STORE_KEY } from '@/features/device-claim/device-claim-store-key'
import {
  normalizeManualDeviceId,
  parseDeviceConnectQuery,
} from '@/features/device-claim/device-id-input'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'

const injectedStore = inject(DEVICE_CLAIM_STORE_KEY)
if (injectedStore === undefined) throw new Error('Device Claim store is not available.')
const store = injectedStore
const authStore = inject(AUTH_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

const route = useRoute()
const router = useRouter()
const manualDeviceId = ref('')
const selectedDeviceId = ref<string | null>(null)
const inputError = ref<string | null>(null)

function applyRouteSelection(): void {
  const querySelection = parseDeviceConnectQuery(route.query)
  manualDeviceId.value = ''
  selectedDeviceId.value =
    querySelection.status === 'selected' ? querySelection.deviceId : null
  inputError.value =
    querySelection.status === 'rejected'
      ? querySelection.reason === 'duplicate'
        ? '連結只能包含一個裝置 ID，請改用手動輸入。'
        : '連結中的裝置 ID 無效，請改用手動輸入。'
      : null
}

applyRouteSelection()
watch(() => route.fullPath, applyRouteSelection)

let integratedClaimedSessionId: string | null = null
let componentActive = true
watch(
  () => store.state.value,
  async (state, _previousState, onCleanup) => {
    if (state.status !== 'claimed' || integratedClaimedSessionId === state.sessionId) return
    const authState = authStore?.state.value
    if (authState?.status !== 'signed-in' || deviceStore === null) return

    let active = true
    onCleanup(() => { active = false })
    integratedClaimedSessionId = state.sessionId
    const claimedSessionId = state.sessionId
    const memberUid = authState.user.uid
    try {
      await deviceStore.load(memberUid)
      const currentState = store.state.value
      const currentAuthState = authStore?.state.value
      if (
        !active ||
        !componentActive ||
        currentState.status !== 'claimed' ||
        currentState.sessionId !== claimedSessionId ||
        currentAuthState?.status !== 'signed-in' ||
        currentAuthState.user.uid !== memberUid ||
        route.path !== '/connect'
      ) {
        return
      }
      await router.push('/')
    } catch {
      if (!active) return
      integratedClaimedSessionId = null
      inputError.value = '裝置已加入帳號，但目前無法重新載入裝置清單，請稍後再試。'
    }
  },
  { flush: 'post' },
)

function selectManualDevice(): void {
  inputError.value = null
  const normalized = normalizeManualDeviceId(manualDeviceId.value)
  if (normalized === null) {
    selectedDeviceId.value = null
    inputError.value = '裝置 ID 必須是 12 碼英文字母 A–F 或數字。'
    return
  }
  manualDeviceId.value = normalized
  selectedDeviceId.value = normalized
}

async function createFor(deviceId: string): Promise<void> {
  inputError.value = null
  try {
    await store.createSession(deviceId)
  } catch {
    inputError.value = '目前無法建立連接流程，請稍後再試。'
  }
}

function confirmSelectedDevice(): void {
  if (selectedDeviceId.value === null || store.state.value.status === 'creating') return
  void createFor(selectedDeviceId.value)
}

function reissuePairCode(): void {
  const state = store.state.value
  if (state.status !== 'pending' || state.pairCode !== null) return
  selectedDeviceId.value = state.deviceId
  void createFor(state.deviceId)
}

function restart(): void {
  const state = store.state.value
  if ('deviceId' in state) selectedDeviceId.value = state.deviceId
  store.restart()
}

onMounted(() => {
  void store.restoreSession().catch(() => {
    inputError.value = '目前無法恢復連接進度，請重新開始。'
  })
})

onUnmounted(() => {
  componentActive = false
  store.dispose()
})
</script>

<template>
  <main class="device-connect">
    <header class="device-connect__header">
      <p class="device-connect__eyebrow">連接裝置</p>
      <h1>新增 PeeCare 裝置</h1>
      <p>確認裝置 ID 後，我們會產生一次性的配對碼。</p>
    </header>

    <p v-if="inputError" class="device-connect__alert" role="alert">{{ inputError }}</p>

    <section v-if="store.state.value.status === 'pending'" class="device-connect__card">
      <p class="device-connect__label">裝置 ID</p>
      <strong data-test="selected-device-id">{{ store.state.value.deviceId }}</strong>

      <div
        v-if="store.state.value.pairCode !== null"
        class="device-connect__code"
        data-test="pair-code"
        role="status"
        aria-live="polite"
      >
        <span>一次性配對碼</span>
        <strong>{{ store.state.value.pairCode }}</strong>
        <p>請在裝置設定頁輸入此配對碼。重新整理後不會再次顯示。</p>
      </div>

      <div v-else class="device-connect__reissue" role="status">
        <p>為保護一次性配對碼，重新整理後需要明確產生新碼。</p>
        <button data-test="reissue-code" type="button" @click="reissuePairCode">
          重新產生配對碼
        </button>
      </div>
    </section>

    <section
      v-else-if="store.state.value.status === 'creating'"
      class="device-connect__card"
      role="status"
      aria-live="polite"
    >
      正在建立連接流程…
    </section>

    <section
      v-else-if="store.state.value.status === 'claimed'"
      class="device-connect__card"
      role="status"
    >
      <h2>裝置已加入帳號</h2>
      <p>{{ store.state.value.deviceId }}</p>
    </section>

    <section
      v-else-if="store.state.value.status === 'terminal'"
      class="device-connect__card"
    >
      <p role="alert">這次連接流程已結束，請重新開始。</p>
      <button type="button" @click="restart">重新開始</button>
    </section>

    <section v-else class="device-connect__card" aria-labelledby="device-id-heading">
      <h2 id="device-id-heading">輸入裝置 ID</h2>
      <form data-test="select-device-form" @submit.prevent="selectManualDevice">
        <label for="device-id">裝置 ID（12 碼）</label>
        <input
          id="device-id"
          v-model="manualDeviceId"
          name="deviceId"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="characters"
          maxlength="16"
          aria-describedby="device-id-help"
        />
        <p id="device-id-help">可輸入數字與英文字母 A–F。</p>
        <button type="submit">選擇這個裝置</button>
      </form>

      <div v-if="selectedDeviceId" class="device-connect__confirmation">
        <p class="device-connect__label">請確認裝置 ID</p>
        <strong data-test="selected-device-id">{{ selectedDeviceId }}</strong>
        <p>確認後才會建立一次性的連接流程。</p>
        <button data-test="confirm-device" type="button" @click="confirmSelectedDevice">
          確認並產生配對碼
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.device-connect {
  width: min(100%, 480px);
  margin: 0 auto;
  padding: 32px 20px 48px;
  color: var(--color-text);
}

.device-connect__header {
  margin-bottom: 24px;
}

.device-connect__header h1,
.device-connect__card h2,
.device-connect__header p,
.device-connect__card p {
  margin-top: 0;
}

.device-connect__eyebrow,
.device-connect__label {
  color: var(--color-brand);
  font-size: 14px;
  font-weight: 600;
}

.device-connect__card,
.device-connect__alert {
  padding: 20px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  background: var(--color-surface, #fff);
}

.device-connect__alert {
  color: var(--color-danger, #a2271c);
}

.device-connect form,
.device-connect__confirmation,
.device-connect__code,
.device-connect__reissue {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.device-connect__confirmation,
.device-connect__code,
.device-connect__reissue {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border, #d0d0d0);
}

.device-connect input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 10px;
  font: inherit;
  text-transform: uppercase;
}

.device-connect button {
  min-height: 44px;
  padding: 10px 16px;
  border: 0;
  border-radius: 12px;
  background: var(--color-brand);
  color: var(--color-on-brand, #fff);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.device-connect strong {
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}

.device-connect__code strong {
  font-size: 32px;
}
</style>
