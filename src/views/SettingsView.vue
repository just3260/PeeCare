<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppHeader from '@/components/AppHeader.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY } from '@/features/auth/auth-provider'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { SIGN_IN_PATH } from '@/features/auth/return-route'
import { resolveDeviceDisplayName } from '@/features/devices/device-display-name'
import { normalizeCustomNameDraft, type OwnedDevice } from '@/features/devices/owned-device-model'
import type { RenameDeviceFailureReason } from '@/features/devices/member-device-api'

// Read-only build identity for the about section. Bumped alongside releases;
// intentionally a plain constant so the client bundle never imports package.json.
const APP_VERSION = '0.0.0'

const router = useRouter()
const authStore = inject(AUTH_STORE_KEY, null)
const authProvider = inject(AUTH_PROVIDER_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

const devices = computed(() => deviceStore?.devices.value ?? [])
const state = computed(() => deviceStore?.state.value ?? { status: 'empty' })
const editingDeviceId = ref<string | null>(null)
const draftName = ref('')
const editorError = ref<string | null>(null)
const nameInput = ref<HTMLInputElement[]>([])
const locallySaving = ref(false)
const saving = computed(
  () => locallySaving.value || deviceStore?.renameState?.value.status === 'saving',
)
const email = computed(() => {
  const session = authStore?.state.value
  return session?.status === 'signed-in' ? session.user.email : null
})

// Keep the device overview loaded for the signed-in member, mirroring the home
// overview wiring so the settings device list reflects the same data source.
function syncSession(): void {
  const session = authStore?.state.value
  if (session?.status === 'signed-in') void deviceStore?.load(session.user.uid)
}

onMounted(syncSession)
watch(() => authStore?.state.value.status, syncSession)

function beginEditing(device: OwnedDevice): void {
  if (editingDeviceId.value !== null || saving.value) return
  editingDeviceId.value = device.deviceId
  draftName.value = resolveDeviceDisplayName(device)
  editorError.value = null
  void nextTick(() => {
    const input = nameInput.value[0]
    input?.focus()
    input?.select()
  })
}

function cancelEditing(): void {
  if (saving.value) return
  editingDeviceId.value = null
  draftName.value = ''
  editorError.value = null
}

function failureMessage(reason: RenameDeviceFailureReason): string {
  if (reason === 'unauthorized') return '登入狀態已失效，請重新登入。'
  if (reason === 'device_not_found') return '找不到此裝置，請重新載入。'
  if (reason === 'persistence_unavailable') return '暫時無法儲存，請稍後再試。'
  return '無法儲存裝置名稱，請稍後再試。'
}

async function saveName(): Promise<void> {
  const deviceId = editingDeviceId.value
  if (deviceId === null || saving.value) return

  const validation = normalizeCustomNameDraft(draftName.value)
  if (!validation.valid) {
    editorError.value = '名稱最多 30 個字，且不能包含換行或控制字元。'
    return
  }
  if (!deviceStore?.renameDevice) {
    editorError.value = '無法儲存裝置名稱，請稍後再試。'
    return
  }

  editorError.value = null
  locallySaving.value = true
  try {
    const result = await deviceStore.renameDevice(deviceId, validation.value)
    if (result.ok) {
      editingDeviceId.value = null
      draftName.value = ''
      return
    }
    editorError.value = failureMessage(result.reason)
  } catch {
    editorError.value = '無法儲存裝置名稱，請稍後再試。'
  } finally {
    locallySaving.value = false
  }
}

// Reuse the existing session-termination flow: end the Firebase session through
// the injected provider, then return to the public sign-in route. No new logout
// data flow is introduced here — this is only the UI entry point.
async function handleSignOut(): Promise<void> {
  await authProvider?.signOut()
  await router.push(SIGN_IN_PATH)
}
</script>

<template>
  <AppHeader />
  <main class="settings-main" aria-label="設定">
    <section class="settings-section" aria-label="裝置管理" data-test="settings-devices">
      <h2 class="settings-section__title">裝置管理</h2>
      <p v-if="state.status === 'loading'" class="settings-notice" data-test="devices-loading">載入中…</p>
      <p v-else-if="state.status === 'error'" class="settings-notice" data-test="devices-error">無法載入裝置資料</p>
      <p v-else-if="devices.length === 0" class="settings-notice" data-test="devices-empty">尚無綁定裝置</p>
      <ul v-else class="settings-devices-list" data-test="devices-list">
        <li
          v-for="device in devices"
          :key="device.deviceId"
          class="settings-devices-list__item"
          :data-device-id="device.deviceId"
        >
          <div class="settings-device__identity">
            <span class="settings-device__name" data-test="device-name">
              {{ resolveDeviceDisplayName(device) }}
            </span>
            <span class="settings-device__serial" data-test="device-serial">
              裝置序號：{{ device.deviceId }}
            </span>
          </div>

          <div v-if="editingDeviceId === device.deviceId" class="settings-device__editor">
            <label class="settings-device__label" :for="`device-name-${device.deviceId}`">
              裝置名稱
            </label>
            <input
              :id="`device-name-${device.deviceId}`"
              ref="nameInput"
              v-model="draftName"
              class="settings-device__input"
              data-test="device-name-input"
              type="text"
              maxlength="60"
              :disabled="saving"
              :aria-describedby="editorError ? `device-name-error-${device.deviceId}` : undefined"
              @keydown.enter.prevent="saveName"
              @keydown.esc.prevent="cancelEditing"
            >
            <p
              v-if="editorError"
              :id="`device-name-error-${device.deviceId}`"
              class="settings-device__error"
              data-test="device-name-error"
              role="alert"
            >
              {{ editorError }}
            </p>
            <div class="settings-device__actions">
              <button
                type="button"
                data-test="device-save"
                :disabled="saving"
                @click="saveName"
              >
                {{ saving ? '儲存中…' : '儲存' }}
              </button>
              <button
                type="button"
                data-test="device-cancel"
                :disabled="saving"
                @click="cancelEditing"
              >
                取消
              </button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="settings-device__edit"
            data-test="device-edit"
            :disabled="editingDeviceId !== null || saving"
            :aria-label="`編輯 ${resolveDeviceDisplayName(device)} 的裝置名稱`"
            @click="beginEditing(device)"
          >
            編輯名稱
          </button>
        </li>
      </ul>
    </section>

    <section class="settings-section" aria-label="帳號" data-test="settings-account">
      <h2 class="settings-section__title">帳號</h2>
      <p class="settings-account__email" data-test="account-email">{{ email ?? '未登入' }}</p>
      <button
        type="button"
        class="settings-account__sign-out"
        data-test="settings-sign-out"
        @click="handleSignOut"
      >
        登出
      </button>
    </section>

    <section class="settings-section" aria-label="通知偏好" data-test="settings-notifications">
      <h2 class="settings-section__title">通知偏好</h2>
      <p class="settings-notice">通知偏好設定即將推出。</p>
    </section>

    <section class="settings-section" aria-label="關於" data-test="settings-about">
      <h2 class="settings-section__title">關於</h2>
      <p class="settings-notice">PeeCare 版本 {{ APP_VERSION }}</p>
    </section>
  </main>
</template>

<style scoped>
.settings-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 20px;
}

.settings-section {
  padding: 20px;
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.settings-section__title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-ink);
}

.settings-notice {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
}

.settings-devices-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings-devices-list__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-ink);
}

.settings-device__identity,
.settings-device__editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-device__name {
  font-size: 18px;
  font-weight: 700;
}

.settings-device__serial,
.settings-device__label {
  color: var(--color-muted);
  font-size: 12px;
}

.settings-device__editor {
  grid-column: 1 / -1;
}

.settings-device__input {
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-ink);
  font: inherit;
}

.settings-device__actions {
  display: flex;
  gap: 8px;
}

.settings-device__edit,
.settings-device__actions button {
  padding: 7px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
}

.settings-device__edit:disabled,
.settings-device__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-device__error {
  margin: 0;
  color: #a33;
  font-size: 13px;
}

.settings-account__email {
  margin: 0 0 16px;
  color: var(--color-ink);
  font-size: 16px;
  font-weight: 600;
}

.settings-account__sign-out {
  padding: 8px 18px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
}
</style>
