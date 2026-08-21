<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import AppHeader from '@/components/AppHeader.vue'
import DeviceSelector from '@/components/DeviceSelector.vue'
import HomeOverviewHero from '@/components/HomeOverviewHero.vue'
import HomeInstantCards from '@/components/HomeInstantCards.vue'
import WifiConnectionGuideDialog from '@/components/WifiConnectionGuideDialog.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { useDeviceSelection } from '@/features/devices/use-device-selection'

// The overview reads its data from the injected device store, which is driven by
// the member session: signing in loads the owned devices; signing out disposes
// the live listener. Both stores are injected so the view mounts in tests with
// fakes and no Firebase dependency.
const authStore = inject(AUTH_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

// The device switcher is shared with History and Stats via this composable.
const { devices, selectedDeviceId, hasMultipleDevices, selectDevice } = useDeviceSelection()

const LOADING_STATE = { status: 'loading' } as const

const state = computed(() => deviceStore?.state.value ?? LOADING_STATE)
const wifiGuideOpen = ref(false)
const wifiGuideShownInMemory = new Set<string>()

const WIFI_GUIDE_KEY_PREFIX = 'peecare:wifi-connection-guide:auto-shown:'
const WIFI_GUIDE_MARKER = '1'

function currentMemberUid(): string | null {
  const session = authStore?.state.value
  return session?.status === 'signed-in' ? session.user.uid : null
}

function wifiGuideKey(uid: string): string {
  return `${WIFI_GUIDE_KEY_PREFIX}${uid}`
}

function hasViewedWifiGuide(uid: string): boolean {
  if (wifiGuideShownInMemory.has(uid)) return true

  try {
    const wasShown = window.sessionStorage.getItem(wifiGuideKey(uid)) === WIFI_GUIDE_MARKER
    if (wasShown) wifiGuideShownInMemory.add(uid)
    return wasShown
  } catch {
    return false
  }
}

function markWifiGuideViewed(uid: string): void {
  // The in-memory marker is written first so storage failures cannot cause a
  // second automatic opening during this view's lifetime.
  wifiGuideShownInMemory.add(uid)
  try {
    window.sessionStorage.setItem(wifiGuideKey(uid), WIFI_GUIDE_MARKER)
  } catch {
    // The guide remains usable when browser storage is unavailable.
  }
}

function openWifiGuide(): void {
  const uid = currentMemberUid()
  if (uid) markWifiGuideViewed(uid)
  wifiGuideOpen.value = true
}

function closeWifiGuide(): void {
  wifiGuideOpen.value = false
}

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

watch(
  () => ({ uid: currentMemberUid(), status: state.value.status }),
  ({ uid, status }) => {
    if (!uid || status !== 'empty' || hasViewedWifiGuide(uid)) return
    markWifiGuideViewed(uid)
    wifiGuideOpen.value = true
  },
  { immediate: true },
)
</script>

<template>
  <AppHeader>
    <template #actions>
      <button
        type="button"
        class="wifi-guide-help"
        aria-label="開啟 Wi-Fi 連線說明"
        @click="openWifiGuide"
      >
        <span aria-hidden="true">?</span>
      </button>
    </template>
  </AppHeader>
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
        <HomeOverviewHero :projection="state.projection" />

        <div class="instant-section">
          <div class="instant-section__header">
            <h3 class="instant-section__title">即時卡片</h3>
            <span class="instant-section__hint">最常看資訊</span>
          </div>

          <DeviceSelector
            v-if="hasMultipleDevices"
            :devices="devices"
            :selected-device-id="selectedDeviceId"
            @select="selectDevice"
          />

          <HomeInstantCards :projection="state.projection" />
        </div>
      </template>
    </section>
  </main>

  <WifiConnectionGuideDialog :open="wifiGuideOpen" @close="closeWifiGuide" />
</template>

<style scoped>
.wifi-guide-help {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 50%;
  background: var(--color-surface, #fff);
  color: var(--color-brand-strong, #8a5a24);
  font: inherit;
  font-size: 20px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 5px 16px rgba(65, 47, 28, 0.08);
}

.wifi-guide-help:hover {
  background: var(--color-brand-soft, #f6eadc);
}

.wifi-guide-help:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-brand-strong) 38%, transparent);
  outline-offset: 3px;
}

.home-main {
  padding: 0 20px;
}

.overview {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.instant-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.instant-section__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.instant-section__title {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-ink);
}

.instant-section__hint {
  font-size: 13px;
  color: var(--color-muted);
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
