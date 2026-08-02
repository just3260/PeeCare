<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'

import AppHeader from '@/components/AppHeader.vue'
import DailyUrinationChart from '@/components/DailyUrinationChart.vue'
import DeviceSelector from '@/components/DeviceSelector.vue'
import type { DailyCountPoint } from '@/features/stats/daily-series'
import type { DailyStatsState } from '@/features/stats/daily-stats-store'
import { DAILY_STATS_STORE_KEY } from '@/features/stats/daily-stats-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { useDeviceSelection } from '@/features/devices/use-device-selection'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'

const props = withDefaults(defineProps<{
  series?: readonly DailyCountPoint[]
  state?: DailyStatsState
}>(), { series: () => [] })

const dailyStatsStore = inject(DAILY_STATS_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)
const authStore = inject(AUTH_STORE_KEY, null)
const { devices, selectedDeviceId, hasMultipleDevices, selectDevice } = useDeviceSelection()
const series = computed(() => dailyStatsStore?.series.value ?? props.series)

// The chart keeps the conventional oldest-to-newest time axis; the table reads
// as a log, so it lists the most recent day first. `slice()` keeps the source
// series untouched — `reverse()` would otherwise mutate the store's array.
const recentFirstSeries = computed(() => series.value.slice().reverse())
const state = computed<DailyStatsState>(() => {
  if (deviceStore?.state?.value.status === 'error') return { status: 'error' }
  return dailyStatsStore?.state.value
    ?? props.state
    ?? (props.series.length > 0 ? { status: 'ready' } : { status: 'no-device' })
})

async function syncDevice(): Promise<void> {
  const session = authStore?.state.value
  if (session?.status === 'signed-in') {
    await deviceStore?.load(session.user.uid)
  }
  await dailyStatsStore?.selectDevice(deviceStore?.selectedDeviceId.value ?? null)
}

onMounted(syncDevice)
watch(() => deviceStore?.selectedDeviceId.value, () => { void syncDevice() })
watch(() => authStore?.state.value.status, () => { void syncDevice() })
</script>

<template>
  <AppHeader />
  <main class="stats-main" aria-label="排尿統計">
    <DeviceSelector
      v-if="hasMultipleDevices"
      :devices="devices"
      :selected-device-id="selectedDeviceId"
      @select="selectDevice"
    />
    <section class="stats-section" aria-labelledby="daily-count-title">
      <h1 id="daily-count-title" class="stats-title">最近十四日排尿次數</h1>
      <p v-if="state.status === 'no-device'" class="stats-notice" data-test="stats-no-device">請先選擇裝置</p>
      <p v-else-if="state.status === 'loading'" class="stats-notice" data-test="stats-loading">載入中…</p>
      <div v-else-if="state.status === 'error'" class="stats-notice" data-test="stats-error">
        <p>無法載入排尿統計</p>
        <button type="button" class="stats-action" @click="syncDevice">重試</button>
      </div>
      <template v-else>
        <DailyUrinationChart :series="series" />

        <table class="daily-count-table stats-table" data-test="daily-count-table">
        <caption>最近十四日每日排尿次數</caption>
        <thead>
          <tr>
            <th scope="col" data-test="daily-count-date-header">日期</th>
            <th scope="col" data-test="daily-count-value-header">排尿次數</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in recentFirstSeries" :key="point.date">
            <td><time :datetime="point.date" data-test="daily-count-date">{{ point.date }}</time></td>
            <td data-test="daily-count-value">{{ point.urinationCount }} 次</td>
          </tr>
        </tbody>
        </table>
      </template>
    </section>
  </main>
</template>

<style scoped>
.stats-main {
  padding: 0 20px;
}

.stats-section {
  padding: 20px;
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.stats-title {
  color: var(--color-ink);
  font-size: 18px;
  font-weight: 700;
}

.stats-notice {
  color: var(--color-muted);
  font-size: 14px;
}

.stats-action {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
}

.daily-count-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--color-muted);
  font-size: 14px;
  text-align: left;
}

.daily-count-table caption,
.daily-count-table th {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 500;
}

.daily-count-table th,
.daily-count-table td {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border, #d0d0d0);
}
</style>
