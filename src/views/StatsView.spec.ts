import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import type { DailyCountPoint } from '@/features/stats/daily-series'
import type { DailyStatsState } from '@/features/stats/daily-stats-store'
import type { OwnedDevice } from '@/features/devices/owned-device-model'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { DAILY_STATS_STORE_KEY } from '@/features/stats/daily-stats-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import StatsView from './StatsView.vue'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

const series: readonly DailyCountPoint[] = [
  { date: '2026-07-15', urinationCount: 1, synthetic: false },
  { date: '2026-07-16', urinationCount: 0, synthetic: true },
  { date: '2026-07-17', urinationCount: 2, synthetic: false },
]

describe('StatsView', () => {
  it('uses the shared header and surface card presentation', () => {
    const wrapper = mount(StatsView, { props: { state: { status: 'no-device' } } })

    expect(wrapper.find('header.app-header').exists()).toBe(true)
    expect(wrapper.find('.stats-section').exists()).toBe(true)
  })

  it('uses the shared primary and secondary typography classes', () => {
    const wrapper = mount(StatsView, { props: { series } })

    expect(wrapper.get('#daily-count-title').classes()).toContain('stats-title')
    expect(wrapper.get('[data-test="daily-count-table"]').classes()).toContain('stats-table')
  })

  it('loads the selected device before querying on a cold signed-in stats route', async () => {
    const selectedDeviceId = ref<string | null>(null)
    const load = vi.fn(async () => { selectedDeviceId.value = 'PC-000001' })
    const selectDevice = vi.fn(async () => undefined)
    mount(StatsView, {
      global: {
        provide: {
          [AUTH_STORE_KEY as symbol]: { state: ref({ status: 'signed-in', user: { uid: 'member-001' } }) },
          [DEVICE_OVERVIEW_STORE_KEY as symbol]: { selectedDeviceId, load },
          [DAILY_STATS_STORE_KEY as symbol]: { series: ref([]), state: ref({ status: 'no-device' }), selectDevice },
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(load).toHaveBeenCalledWith('member-001')
    expect(selectDevice).toHaveBeenCalledWith('PC-000001')
  })

  it('surfaces a cold device-list failure as a stats error', async () => {
    const selectDevice = vi.fn(async () => undefined)
    const wrapper = mount(StatsView, {
      global: {
        provide: {
          [AUTH_STORE_KEY as symbol]: { state: ref({ status: 'signed-in', user: { uid: 'member-001' } }) },
          [DEVICE_OVERVIEW_STORE_KEY as symbol]: {
            selectedDeviceId: ref(null),
            state: ref({ status: 'error' }),
            load: vi.fn(async () => undefined),
          },
          [DAILY_STATS_STORE_KEY as symbol]: { series: ref([]), state: ref({ status: 'no-device' }), selectDevice },
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.find('[data-test="stats-error"]').exists()).toBe(true)
  })

  it('exposes no-device, loading, and error states without showing a stale series', () => {
    const render = (state: DailyStatsState) => mount(StatsView, { props: { state, series } })

    expect(render({ status: 'no-device' }).find('[data-test="stats-no-device"]').exists()).toBe(true)
    expect(render({ status: 'loading' }).find('[data-test="stats-loading"]').exists()).toBe(true)
    expect(render({ status: 'loading' }).find('[data-test="daily-count-table"]').exists()).toBe(false)
    expect(render({ status: 'error' }).find('[data-test="stats-error"]').exists()).toBe(true)
  })

  it('renders an accessible count chart and a semantic table from exactly the same series', () => {
    const wrapper = mount(StatsView, { props: { series } })

    const chartPoints = wrapper.findAll('[data-test="daily-count-chart"] [data-test="daily-count-bar"]')
      .map((point) => ({ date: point.attributes('data-date'), count: point.attributes('data-count') }))
    const tableRows = wrapper.findAll('[data-test="daily-count-table"] tbody tr')
      .map((row) => ({
        date: row.get('[data-test="daily-count-date"]').attributes('datetime'),
        count: row.get('[data-test="daily-count-value"]').text(),
      }))

    expect(chartPoints).toEqual([
      { date: '2026-07-15', count: '1' },
      { date: '2026-07-16', count: '0' },
      { date: '2026-07-17', count: '2' },
    ])
    expect(tableRows).toEqual([
      { date: '2026-07-15', count: '1 次' },
      { date: '2026-07-16', count: '0 次' },
      { date: '2026-07-17', count: '2 次' },
    ])
  })

  it('uses a semantic table with date and count headers', () => {
    const wrapper = mount(StatsView, { props: { series } })

    expect(wrapper.get('[data-test="daily-count-table"]').element.tagName).toBe('TABLE')
    expect(wrapper.get('[data-test="daily-count-date-header"]').attributes('scope')).toBe('col')
    expect(wrapper.get('[data-test="daily-count-value-header"]').attributes('scope')).toBe('col')
  })

  it('shows the shared device selector and switches devices when the member owns more than one', async () => {
    const selectDevice = vi.fn()
    const wrapper = mount(StatsView, {
      props: { series },
      global: {
        provide: {
          [DEVICE_OVERVIEW_STORE_KEY as symbol]: {
            devices: ref([device('PC-000001'), device('PC-000002')]),
            selectedDeviceId: ref('PC-000001'),
            selectDevice,
          },
        },
      },
    })

    expect(wrapper.find('.device-selector').exists()).toBe(true)
    await wrapper.get('[data-test="device-select"]').setValue('PC-000002')
    expect(selectDevice).toHaveBeenCalledWith('PC-000002')
  })

  it('omits the device selector when the member owns a single device', () => {
    const wrapper = mount(StatsView, {
      props: { series },
      global: {
        provide: {
          [DEVICE_OVERVIEW_STORE_KEY as symbol]: {
            devices: ref([device('PC-000001')]),
            selectedDeviceId: ref('PC-000001'),
            selectDevice: vi.fn(),
          },
        },
      },
    })

    expect(wrapper.find('.device-selector').exists()).toBe(false)
  })
})
