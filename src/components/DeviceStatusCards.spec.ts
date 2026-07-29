import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DeviceStatusCards from './DeviceStatusCards.vue'
import type { DeviceOverviewProjection } from '@/features/devices/device-overview-model'

// 2026-07-27T16:00:00.000Z is 2026-07-28 00:00 in Asia/Taipei.
const BOUNDARY_MS = Date.parse('2026-07-27T16:00:00.000Z')

function readyProjection(
  overrides: Partial<DeviceOverviewProjection> = {},
): DeviceOverviewProjection {
  return {
    urination: { eventId: 'evt-u', atMs: BOUNDARY_MS, receivedAtMs: BOUNDARY_MS, estimatedUrineMl: 200, estimationStatus: 'estimated' },
    battery: {
      eventId: 'evt-b',
      levelPercent: 50,
      atMs: BOUNDARY_MS,
      receivedAtMs: BOUNDARY_MS,
      voltageMv: 3840,
    },
    lastReportedAtMs: BOUNDARY_MS,
    ...overrides,
  }
}

describe('DeviceStatusCards', () => {
  it('renders the latest battery level from the projection', () => {
    const wrapper = mount(DeviceStatusCards, { props: { projection: readyProjection() } })

    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('50%')
    expect(wrapper.get('[data-test="battery-voltage"]').text()).toBe('3840 mV')
  })

  // Spec example: a battery update from 50 to 25 changes the visible card to 25.
  it('reflects a battery projection update from 50 to 25', async () => {
    const wrapper = mount(DeviceStatusCards, { props: { projection: readyProjection() } })
    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('50%')

    await wrapper.setProps({
      projection: readyProjection({
        battery: {
          eventId: 'evt-b',
          levelPercent: 25,
          atMs: BOUNDARY_MS,
          receivedAtMs: BOUNDARY_MS,
          voltageMv: null,
        },
      }),
    })

    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('25%')
  })

  it('shows all three timestamps in the fixed Asia/Taipei timezone', () => {
    const wrapper = mount(DeviceStatusCards, { props: { projection: readyProjection() } })

    // All three cards format the same UTC-boundary instant as the next Taipei day.
    expect(wrapper.get('[data-test="urination-time"]').text()).toContain('2026/07/28')
    expect(wrapper.get('[data-test="battery-time"]').text()).toContain('2026/07/28')
    expect(wrapper.get('[data-test="last-reported-time"]').text()).toContain('2026/07/28')
  })

  it('renders an explicit unknown state for a missing battery projection', () => {
    const wrapper = mount(DeviceStatusCards, {
      props: { projection: readyProjection({ battery: null }) },
    })

    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('尚無資料')
    // A missing tuple is never shown as a zero or a fabricated value.
    expect(wrapper.get('[data-test="battery-level"]').text()).not.toContain('0%')
    expect(wrapper.find('[data-test="battery-voltage"]').exists()).toBe(false)
  })

  it('omits the voltage line when the battery event has no voltage', () => {
    const wrapper = mount(DeviceStatusCards, {
      props: {
        projection: readyProjection({
          battery: {
            eventId: 'evt-b',
            levelPercent: 50,
            atMs: BOUNDARY_MS,
            receivedAtMs: BOUNDARY_MS,
            voltageMv: null,
          },
        }),
      },
    })

    expect(wrapper.find('[data-test="battery-voltage"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('50%')
  })

  it('renders unknown states for missing urination and last-reported values', () => {
    const wrapper = mount(DeviceStatusCards, {
      props: { projection: readyProjection({ urination: null, lastReportedAtMs: null }) },
    })

    expect(wrapper.get('[data-test="urination-time"]').text()).toBe('尚無資料')
    expect(wrapper.get('[data-test="last-reported-time"]').text()).toBe('尚無資料')
  })

  it('shows the estimated urine volume alongside the latest urination time', () => {
    const wrapper = mount(DeviceStatusCards, { props: { projection: readyProjection() } })

    expect(wrapper.get('[data-test="urination-volume"]').text()).toContain('排尿量 200 mL')
  })

  it('gives the volume the prominent value style and the time the muted footer style', () => {
    const wrapper = mount(DeviceStatusCards, { props: { projection: readyProjection() } })

    expect(wrapper.get('[data-test="urination-volume"]').classes()).toContain('status-card__value')
    expect(wrapper.get('[data-test="urination-time"]').classes()).toContain('status-card__footer')
  })

  it('flags an out-of-range urine volume for review', () => {
    const wrapper = mount(DeviceStatusCards, {
      props: {
        projection: readyProjection({
          urination: { eventId: 'evt-u', atMs: BOUNDARY_MS, receivedAtMs: BOUNDARY_MS, estimatedUrineMl: 3_000, estimationStatus: 'out_of_range' },
        }),
      },
    })

    expect(wrapper.get('[data-test="urination-volume"]').text()).toContain('排尿量 3000 mL（數值異常）')
  })

  it('omits the volume line for a legacy projection without a stored volume', () => {
    const wrapper = mount(DeviceStatusCards, {
      props: {
        projection: readyProjection({
          urination: { eventId: 'evt-u', atMs: BOUNDARY_MS, receivedAtMs: BOUNDARY_MS, estimatedUrineMl: null, estimationStatus: null },
        }),
      },
    })

    expect(wrapper.get('[data-test="urination-time"]').text()).toContain('2026/07/28')
    expect(wrapper.find('[data-test="urination-volume"]').exists()).toBe(false)
  })
})
