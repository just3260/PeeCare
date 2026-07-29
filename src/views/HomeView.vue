<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'

import AppHeader from '@/components/AppHeader.vue'
import DeviceSelector from '@/components/DeviceSelector.vue'
import DeviceStatusCards from '@/components/DeviceStatusCards.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'

// The overview reads its data from the injected device store, which is driven by
// the member session: signing in loads the owned devices; signing out disposes
// the live listener. Both stores are injected so the view mounts in tests with
// fakes and no Firebase dependency.
const authStore = inject(AUTH_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

const LOADING_STATE = { status: 'loading' } as const

const state = computed(() => deviceStore?.state.value ?? LOADING_STATE)
const devices = computed(() => deviceStore?.devices.value ?? [])
const selectedDeviceId = computed(() => deviceStore?.selectedDeviceId.value ?? null)
const hasMultipleDevices = computed(() => devices.value.length > 1)

/** Keep the device store in step with the member session. */
function syncSession(): void {
  if (!deviceStore) return
  const session = authStore?.state.value
  if (session?.status === 'signed-in') {
    void deviceStore.load(session.user.uid)
  } else if (session?.status === 'signed-out') {
    deviceStore.dispose()
  }
}

onMounted(syncSession)
watch(() => authStore?.state.value.status, syncSession)

function handleSelect(deviceId: string): void {
  deviceStore?.selectDevice(deviceId)
}
</script>

<template>
  <AppHeader />
  <main class="home-main">
    <section class="overview" aria-label="首頁總覽">
      <p
        v-if="state.status === 'loading'"
        class="overview__notice"
        data-test="overview-loading"
      >
        載入中…
      </p>

      <div v-else-if="state.status === 'empty'" class="overview__notice" data-test="overview-empty">
        <p>尚無裝置</p>
        <RouterLink
          to="/settings"
          class="overview__guidance"
          data-test="overview-settings-guidance"
        >
          前往設定綁定裝置
        </RouterLink>
      </div>

      <div v-else-if="state.status === 'error'" class="overview__notice" data-test="overview-error">
        <p>無法載入裝置資料</p>
        <button type="button" class="overview__retry" data-test="overview-retry" @click="syncSession">
          重新載入
        </button>
      </div>

      <template v-else>
        <DeviceSelector
          v-if="hasMultipleDevices"
          :devices="devices"
          :selected-device-id="selectedDeviceId"
          @select="handleSelect"
        />
        <DeviceStatusCards :projection="state.projection" />
      </template>
    </section>
  </main>
</template>

<style scoped>
.home-main {
  padding: 0 20px;
}

.overview__notice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 24px;
  border-radius: 20px;
  background-color: var(--color-surface);
  color: var(--color-muted);
  font-size: 14px;
}

.overview__retry {
  padding: 6px 14px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
}
</style>
