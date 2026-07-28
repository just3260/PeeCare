import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { DailyCountPoint } from '@/features/stats/daily-series'
import DailyUrinationChart from './DailyUrinationChart.vue'

const series: readonly DailyCountPoint[] = [
  { date: '2026-07-15', urinationCount: 1, synthetic: false },
  { date: '2026-07-16', urinationCount: 0, synthetic: true },
  { date: '2026-07-17', urinationCount: 2, synthetic: false },
]

describe('DailyUrinationChart', () => {
  it('exposes every normalized date and count to assistive technology', () => {
    const wrapper = mount(DailyUrinationChart, { props: { series } })

    expect(wrapper.get('[data-test="daily-count-chart"]').attributes('role')).toBe('img')
    expect(wrapper.get('[data-test="daily-count-chart"]').attributes('aria-label'))
      .toContain('2026-07-15：1 次')
    expect(wrapper.get('[data-test="daily-count-chart"]').attributes('aria-label'))
      .toContain('2026-07-16：0 次')
    expect(wrapper.get('[data-test="daily-count-chart"]').attributes('aria-label'))
      .toContain('2026-07-17：2 次')
  })

  it('renders one visual bar for each point without rendering urine volume', () => {
    const wrapper = mount(DailyUrinationChart, { props: { series } })

    expect(wrapper.findAll('[data-test="daily-count-bar"]')).toHaveLength(series.length)
    expect(wrapper.text()).not.toContain('mL')
  })
})
