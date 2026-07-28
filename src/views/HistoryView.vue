<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'
import type { DeviceEventHistoryState } from '@/features/history/device-event-history-store'
import type { UrinationHistoryRecord } from '@/features/history/urination-history-model'
import { formatTaipeiTimestamp } from '@/features/devices/device-overview-model'
import { DEVICE_EVENT_HISTORY_STORE_KEY } from '@/features/history/device-event-history-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'

const props = withDefaults(defineProps<{
  state?: DeviceEventHistoryState
  items?: readonly UrinationHistoryRecord[]
}>(), { state: () => ({ status: 'empty' }), items: () => [] })

const emit = defineEmits<{
  loadMore: []
  retry: []
}>()

const historyStore = inject(DEVICE_EVENT_HISTORY_STORE_KEY, null)
const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)
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
  <main class="history-main" aria-label="排尿歷史">
    <p v-if="state.status === 'loading'" data-test="history-loading">載入中…</p>
    <p v-else-if="state.status === 'empty'" data-test="history-empty">尚無排尿紀錄</p>
    <section v-else>
      <ul data-test="history-list">
        <li v-for="item in items" :key="item.eventId" class="history-item">
          <time :datetime="new Date(item.effectiveAtMs).toISOString()">
            {{ formatTaipeiTimestamp(item.effectiveAtMs) }}
          </time>
          <span data-test="history-flush-duration">沖水 {{ item.flushDurationMs }} ms</span>
          <span data-test="history-pump-duration">抽水 {{ item.pumpDurationMs }} ms</span>
          <span data-test="history-volume-status">尿量：待校正</span>
        </li>
      </ul>
      <button v-if="state.status === 'ready'" type="button" data-test="history-load-more" @click="loadMore">
        載入更多
      </button>
      <p v-else-if="state.status === 'end'" data-test="history-end">已顯示全部紀錄</p>
      <div v-else-if="state.status === 'error'" data-test="history-error">
        <p>無法載入排尿歷史</p>
        <button type="button" data-test="history-retry" @click="retry">重試</button>
      </div>
    </section>
  </main>
</template>
