<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppHeader from '@/components/AppHeader.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY } from '@/features/auth/auth-provider'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { SIGN_IN_PATH } from '@/features/auth/return-route'

// Read-only build identity for the about section. Bumped alongside releases;
// intentionally a plain constant so the client bundle never imports package.json.
const APP_VERSION = '0.0.0'

const router = useRouter()
const authStore = inject(AUTH_STORE_KEY, null)
const authProvider = inject(AUTH_PROVIDER_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

const devices = computed(() => deviceStore?.devices.value ?? [])
const state = computed(() => deviceStore?.state.value ?? { status: 'empty' })
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
        <li v-for="device in devices" :key="device.deviceId" class="settings-devices-list__item">
          {{ device.deviceId }}
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
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-ink);
  font-size: 18px;
  font-weight: 700;
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
