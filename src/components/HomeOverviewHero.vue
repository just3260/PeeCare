<script setup lang="ts">
// The green overview hero at the top of the home page. It summarises the
// selected device at a glance: an online/idle status line and three quick
// pills. Metrics that the backend does not yet compute (today's count and
// today's total volume) render an explicit "N/A" placeholder rather than a
// fabricated zero; the last-urination volume is shown when the validated
// projection carries it.
import { computed } from 'vue'

import {
  formatTaipeiTimestamp,
  type DeviceOverviewProjection,
} from '@/features/devices/device-overview-model'

const props = defineProps<{ projection: DeviceOverviewProjection }>()

const NOT_AVAILABLE = 'N/A'

// A device that has reported at least once is treated as connected; without any
// report instant we cannot claim it is online.
const isOnline = computed(() => props.projection.lastReportedAtMs !== null)

const statusLabel = computed(() => (isOnline.value ? '連線中' : '待機中'))

const lastUpdated = computed(() =>
  props.projection.lastReportedAtMs !== null
    ? formatTaipeiTimestamp(props.projection.lastReportedAtMs)
    : NOT_AVAILABLE,
)

// Today's toilet count is not computed yet — placeholder until implemented.
const todayCount = computed(() => NOT_AVAILABLE)

// Today's total volume is not computed yet — placeholder until implemented.
const todayVolume = computed(() => NOT_AVAILABLE)

const latestVolume = computed(() => {
  const urination = props.projection.urination
  if (!urination || urination.estimatedUrineMl === null) return NOT_AVAILABLE
  return String(urination.estimatedUrineMl)
})
</script>

<template>
  <section class="hero" aria-label="首頁總覽">
    <p class="hero__eyebrow">首頁總覽</p>
    <h2 class="hero__title" data-test="hero-title">
      今天已上廁所 {{ todayCount }} 次 <span aria-hidden="true">✏️</span>
    </h2>
    <p class="hero__status" data-test="hero-status">
      目前狀態：{{ statusLabel }}，最後更新於 {{ lastUpdated }}。
    </p>

    <div class="hero__pills">
      <span class="hero__pill hero__pill--status" data-test="hero-connection">
        <span
          class="hero__dot"
          :class="{ 'hero__dot--online': isOnline }"
          aria-hidden="true"
        />
        {{ statusLabel }}
      </span>
      <span class="hero__pill" data-test="hero-today-volume">
        今日尿量 {{ todayVolume }} mL
      </span>
      <span class="hero__pill" data-test="hero-latest-volume">
        最近一次 {{ latestVolume }} mL
      </span>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  border-radius: 24px;
  background-color: var(--color-brand);
  color: #ffffff;
}

.hero__eyebrow {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.hero__title {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
}

.hero__status {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

.hero__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.hero__pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.14);
  font-size: 13px;
  font-weight: 500;
}

.hero__pill--status {
  background-color: rgba(255, 255, 255, 0.2);
}

.hero__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.5);
}

.hero__dot--online {
  background-color: #4ade80;
}
</style>
