<script setup lang="ts">
import { computed } from 'vue'

import type { DailyCountPoint } from '@/features/stats/daily-series'

const props = withDefaults(defineProps<{
  series?: readonly DailyCountPoint[]
}>(), { series: () => [] })

const chartHeight = 120
const barWidth = 24
const barGap = 12
const chartWidth = computed(() => Math.max(props.series.length * (barWidth + barGap), 180))
const maximumCount = computed(() => Math.max(1, ...props.series.map((point) => point.urinationCount)))

function barHeight(point: DailyCountPoint): number {
  return (point.urinationCount / maximumCount.value) * chartHeight
}

function barX(index: number): number {
  return index * (barWidth + barGap) + barGap / 2
}

const chartLabel = computed(() => props.series.length === 0
  ? '最近十四日排尿次數圖表，尚無資料。'
  : `最近十四日排尿次數圖表：${props.series.map((point) => `${point.date}：${point.urinationCount} 次`).join('；')}。`,
)
</script>

<template>
  <svg
    class="daily-count-chart"
    data-test="daily-count-chart"
    role="img"
    :aria-label="chartLabel"
    :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
  >
    <rect
      v-for="(point, index) in series"
      :key="point.date"
      class="daily-count-chart__bar"
      data-test="daily-count-bar"
      :data-date="point.date"
      :data-count="point.urinationCount"
      :x="barX(index)"
      :y="chartHeight - barHeight(point)"
      :width="barWidth"
      :height="barHeight(point)"
    />
  </svg>
</template>

<style scoped>
.daily-count-chart {
  display: block;
  width: 100%;
  min-height: 160px;
  overflow: visible;
}

.daily-count-chart__bar {
  fill: var(--color-primary, #166554);
}
</style>
