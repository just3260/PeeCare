<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'
import AppHeader from '@/components/AppHeader.vue'
import DeviceSelector from '@/components/DeviceSelector.vue'
import type { DeviceEventHistoryState } from '@/features/history/device-event-history-store'
import type { UrinationHistoryRecord } from '@/features/history/urination-history-model'
import { formatTaipeiTimestamp } from '@/features/devices/device-overview-model'
import { DEVICE_EVENT_HISTORY_STORE_KEY } from '@/features/history/device-event-history-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import { useDeviceSelection } from '@/features/devices/use-device-selection'

const props = withDefaults(defineProps<{
  state?: DeviceEventHistoryState
  items?: readonly UrinationHistoryRecord[]
}>(), { state: () => ({ status: 'empty' }), items: () => [] })

const emit = defineEmits<{
  loadMore: []
  retry: []
}>()

/** Human-readable urine volume label; flags implausible estimates for review. */
function formatVolume(item: UrinationHistoryRecord): string {
  const base = `排尿量：${item.estimatedUrineMl} mL`
  return item.estimationStatus === 'out_of_range' ? `${base}（數值異常）` : base
}

const historyStore = inject(DEVICE_EVENT_HISTORY_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)
const { devices, selectedDeviceId, hasMultipleDevices, selectDevice } = useDeviceSelection()
const state = computed(() => historyStore?.state.value ?? props.state)
const items = computed(() => historyStore?.items.value ?? props.items)

function syncDevice(): void {
  void historyStore?.selectDevice(deviceStore?.selectedDeviceId.value ?? null)
}
function loadMore(): void {
  if (historyStore) void historyStore.loadMore()
  emit('loadMore')
}
function retry(): void {
  syncDevice()
  emit('retry')
}
onMounted(syncDevice)
watch(() => deviceStore?.selectedDeviceId.value, syncDevice)
</script>

<template>
  <AppHeader />
  <main class="history-main" aria-label="排尿歷史">
    <DeviceSelector
      v-if="hasMultipleDevices"
      :devices="devices"
      :selected-device-id="selectedDeviceId"
      @select="selectDevice"
    />
    <section class="history-section">
      <p v-if="state.status === 'loading'" class="history-notice" data-test="history-loading">載入中…</p>
      <p v-else-if="state.status === 'empty'" class="history-notice" data-test="history-empty">尚無排尿紀錄</p>
      <template v-else>
        <ul data-test="history-list">
          <li v-for="item in items" :key="item.eventId" class="history-item">
            <time class="history-item__time" :datetime="new Date(item.effectiveAtMs).toISOString()">
              {{ formatTaipeiTimestamp(item.effectiveAtMs) }}
            </time>
            <span class="history-item__detail" data-test="history-volume-status">{{ formatVolume(item) }}</span>
          </li>
        </ul>
        <button v-if="state.status === 'ready'" type="button" class="history-action" data-test="history-load-more" @click="loadMore">
          載入更多
        </button>
        <p v-else-if="state.status === 'end'" class="history-notice history-notice--end" data-test="history-end">已顯示全部紀錄</p>
        <div v-else-if="state.status === 'error'" class="history-notice" data-test="history-error">
          <p>無法載入排尿歷史</p>
          <button type="button" class="history-action" data-test="history-retry" @click="retry">重試</button>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.history-main {
  padding: 0 20px;
}

.history-section {
  padding: 20px;
  border-radius: 20px;
  background: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.history-notice {
  color: var(--color-muted);
  font-size: 14px;
}

/* The end-of-list line closes the list rather than labelling a row, so it is
   centred and kept clear of the last item's bottom rule. */
.history-notice--end {
  margin-top: 16px;
  text-align: center;
}

.history-item {
  display: grid;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.history-item__time {
  color: var(--color-ink);
  font-size: 18px;
  font-weight: 700;
}

.history-item__detail {
  color: var(--color-muted);
  font-size: 13px;
}

.history-action {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
}
</style>
