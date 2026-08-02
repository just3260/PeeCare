<script setup lang="ts">
// The 2x2 grid of "instant cards" below the device selector. Each card shows a
// headline metric with a muted footer. Today's volume and count come from the
// registry today projection, resolved against the current Asia/Taipei day; the
// day-over-day comparison footers have no data behind them yet and render an
// explicit "N/A" placeholder rather than a fabricated value. The
// latest-urination card is filled from the validated projection when the tuple
// is present.
import { computed } from 'vue'

import {
  formatTaipeiClock,
  resolveTodayTotals,
  type DeviceOverviewProjection,
} from '@/features/devices/device-overview-model'

const props = defineProps<{ projection: DeviceOverviewProjection }>()

const NOT_AVAILABLE = 'N/A'
const NO_TIME = '--:--'

const todayTotals = computed(() => resolveTodayTotals(props.projection.today, Date.now()))

const todayVolume = computed(() =>
  todayTotals.value ? String(todayTotals.value.estimatedUrineTotalMl) : NOT_AVAILABLE,
)

const todayCount = computed(() =>
  todayTotals.value ? String(todayTotals.value.urinationCount) : NOT_AVAILABLE,
)

const latestVolume = computed(() => {
  const urination = props.projection.urination
  if (!urination || urination.estimatedUrineMl === null) return NOT_AVAILABLE
  return String(urination.estimatedUrineMl)
})

const latestTime = computed(() =>
  props.projection.urination ? formatTaipeiClock(props.projection.urination.atMs) : NO_TIME,
)

const statusLabel = computed(() =>
  props.projection.lastReportedAtMs !== null ? '連線中' : '待機中',
)
</script>

<template>
  <div class="instant-cards" aria-label="即時卡片">
    <article class="instant-card">
      <p class="instant-card__label">今日尿量</p>
      <p class="instant-card__value" data-test="card-today-volume">
        {{ todayVolume }} <span class="instant-card__unit">mL</span>
      </p>
      <p class="instant-card__footer" data-test="card-today-volume-footer">
        比昨天 {{ NOT_AVAILABLE }}
      </p>
    </article>

    <article class="instant-card">
      <p class="instant-card__label">今日次數</p>
      <p class="instant-card__value" data-test="card-today-count">
        {{ todayCount }} <span class="instant-card__unit">次</span>
      </p>
      <p class="instant-card__footer" data-test="card-today-count-footer">{{ NOT_AVAILABLE }}</p>
    </article>

    <article class="instant-card">
      <p class="instant-card__label">最近一次</p>
      <p class="instant-card__value" data-test="card-latest-volume">
        {{ latestVolume }} <span class="instant-card__unit">mL</span>
      </p>
      <p class="instant-card__footer" data-test="card-latest-time">{{ latestTime }}</p>
    </article>

    <article class="instant-card">
      <p class="instant-card__label">目前狀態</p>
      <p class="instant-card__value instant-card__value--text" data-test="card-status">
        {{ statusLabel }}
      </p>
      <p class="instant-card__footer">Wi-Fi {{ NOT_AVAILABLE }}</p>
    </article>
  </div>
</template>

<style scoped>
.instant-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.instant-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-radius: 20px;
  background-color: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.instant-card__label {
  font-size: 13px;
  color: var(--color-muted);
}

.instant-card__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-ink);
}

.instant-card__value--text {
  font-size: 24px;
}

.instant-card__unit {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-muted);
}

.instant-card__footer {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand);
}
</style>
