<script setup lang="ts">
// Latest-projection cards for the selected device: latest urination time,
// latest battery level (with optional voltage), and last reported time. Values
// are shown exactly as the validated projection carries them — a missing tuple
// renders an explicit unknown state, never a zero or an inferred value. Every
// timestamp is formatted in the fixed Asia/Taipei timezone.
import { computed } from 'vue'

import {
  formatTaipeiTimestamp,
  type DeviceOverviewProjection,
} from '@/features/devices/device-overview-model'

const props = defineProps<{ projection: DeviceOverviewProjection }>()

const UNKNOWN_LABEL = '尚無資料'

const urinationTime = computed(() =>
  props.projection.urination
    ? formatTaipeiTimestamp(props.projection.urination.atMs)
    : UNKNOWN_LABEL,
)

const batteryLevel = computed(() =>
  props.projection.battery ? `${props.projection.battery.levelPercent}%` : UNKNOWN_LABEL,
)

const batteryTime = computed(() =>
  props.projection.battery ? formatTaipeiTimestamp(props.projection.battery.atMs) : UNKNOWN_LABEL,
)

const batteryVoltage = computed(() => {
  const voltage = props.projection.battery?.voltageMv
  return voltage === null || voltage === undefined ? null : `${voltage} mV`
})

const lastReportedTime = computed(() =>
  props.projection.lastReportedAtMs !== null
    ? formatTaipeiTimestamp(props.projection.lastReportedAtMs)
    : UNKNOWN_LABEL,
)
</script>

<template>
  <div class="status-cards" aria-label="裝置最新狀態">
    <article class="status-card">
      <p class="status-card__label">最近排尿</p>
      <p class="status-card__value" data-test="urination-time">{{ urinationTime }}</p>
    </article>

    <article class="status-card">
      <p class="status-card__label">電量</p>
      <p class="status-card__value" data-test="battery-level">{{ batteryLevel }}</p>
      <p v-if="batteryVoltage" class="status-card__footer" data-test="battery-voltage">
        {{ batteryVoltage }}
      </p>
      <p class="status-card__footer" data-test="battery-time">{{ batteryTime }}</p>
    </article>

    <article class="status-card">
      <p class="status-card__label">最近回報</p>
      <p class="status-card__value" data-test="last-reported-time">{{ lastReportedTime }}</p>
    </article>
  </div>
</template>

<style scoped>
.status-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.status-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border-radius: 20px;
  background-color: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.status-card__label {
  font-size: 13px;
  color: var(--color-muted);
}

.status-card__value {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-ink);
}

.status-card__footer {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
}
</style>
