import { createApp } from 'vue'

import App from './App.vue'
import router, { registerAuthGuard } from './router'
import { createAuthStore } from '@/features/auth/auth-store'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY, createFirebaseAuthProvider } from '@/features/auth/auth-provider'
import {
  createDeviceOverviewStore,
  createFirestoreDeviceSource,
} from '@/features/devices/device-overview-store'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { createMemberDeviceApi } from '@/features/devices/member-device-api'
import { getFirebaseServices } from '@/platform/firebase/client'
import { parseMemberApiConfig } from '@/platform/firebase/config'
import { loadUrinationPage } from '@/features/history/device-event-history-repository'
import { createDeviceEventHistoryStore } from '@/features/history/device-event-history-store'
import { DEVICE_EVENT_HISTORY_STORE_KEY } from '@/features/history/device-event-history-store-key'
import { loadDailyStats } from '@/features/stats/daily-stats-repository'
import { createDailyStatsSource } from '@/features/stats/daily-stats-source'
import { createDailyStatsStore } from '@/features/stats/daily-stats-store'
import { DAILY_STATS_STORE_KEY } from '@/features/stats/daily-stats-store-key'
import './styles/main.css'

// Composition root: the single auth store and provider are created here and
// shared with the shell (App.vue mounts/disposes the store lifecycle) and the
// navigation guard. Tests provide their own fakes instead.
const memberApiConfig = parseMemberApiConfig(import.meta.env)
const authStore = createAuthStore()
const authProvider = createFirebaseAuthProvider()
const memberDeviceApi = createMemberDeviceApi({ baseUrl: memberApiConfig.baseUrl })

// The device overview store shares the auth store's teardown registry so its
// live Firestore listener is disposed when the member signs out.
const deviceOverviewStore = createDeviceOverviewStore({
  source: createFirestoreDeviceSource(),
  memberApi: memberDeviceApi,
  registry: authStore.registry,
})
const deviceEventHistoryStore = createDeviceEventHistoryStore({
  source: {
    loadPage(deviceId, cursor) {
      return loadUrinationPage(getFirebaseServices().firestore, deviceId, cursor as never)
    },
  },
})
const dailyStatsStore = createDailyStatsStore({
  source: createDailyStatsSource({
    loadDocuments(deviceId, range) {
      return loadDailyStats(getFirebaseServices().firestore, deviceId, range)
    },
  }),
})

registerAuthGuard(router, authStore)

const app = createApp(App)
app.use(router)
app.provide(AUTH_STORE_KEY, authStore)
app.provide(AUTH_PROVIDER_KEY, authProvider)
app.provide(DEVICE_OVERVIEW_STORE_KEY, deviceOverviewStore)
app.provide(DEVICE_EVENT_HISTORY_STORE_KEY, deviceEventHistoryStore)
app.provide(DAILY_STATS_STORE_KEY, dailyStatsStore)
app.mount('#app')

// The service worker is registered only in production builds. Development and
// unit-test modes never register it, and browsers without Service Worker
// support still mount the Vue application above.
if (import.meta.env.PROD) {
  void import('./pwa').then((module) => module.registerServiceWorker())
}
