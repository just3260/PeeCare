import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import type { DeviceEventHistoryState } from '@/features/history/device-event-history-store'
import type { UrinationHistoryRecord } from '@/features/history/urination-history-model'
import type { OwnedDevice } from '@/features/devices/owned-device-model'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import HistoryView from './HistoryView.vue'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

const record: UrinationHistoryRecord = Object.freeze({
  eventId: 'evt-000001', eventType: 'urination', deviceId: 'PC-000001', sequence: 42,
  effectiveAtMs: Date.parse('2026-07-27T16:00:00.000Z'), flushDurationMs: 3_000, pumpDurationMs: 5_000,
  estimatedUrineMl: null, estimationStatus: 'pending_calibration',
})

function render(state: DeviceEventHistoryState, items: readonly UrinationHistoryRecord[] = []) {
  return mount(HistoryView, { props: { state, items } })
}

describe('HistoryView', () => {
  it('uses the shared header and surface card presentation', () => {
    const wrapper = render({ status: 'empty' })

    expect(wrapper.find('header.app-header').exists()).toBe(true)
    expect(wrapper.find('.history-section').exists()).toBe(true)
  })

  it('uses the shared primary and secondary typography classes', () => {
    const wrapper = render({ status: 'ready' }, [record])

    expect(wrapper.find('.history-item__time').exists()).toBe(true)
    expect(wrapper.findAll('.history-item__detail')).toHaveLength(3)
    expect(wrapper.get('[data-test="history-load-more"]').classes()).toContain('history-action')
  })

  it('renders distinct loading, empty, ready, end, and retryable error states', () => {
    expect(render({ status: 'loading' }).find('[data-test="history-loading"]').exists()).toBe(true)
    expect(render({ status: 'empty' }).find('[data-test="history-empty"]').exists()).toBe(true)
    expect(render({ status: 'ready' }, [record]).find('[data-test="history-list"]').exists()).toBe(true)
    expect(render({ status: 'end' }, [record]).find('[data-test="history-end"]').exists()).toBe(true)
    expect(render({ status: 'error' }).find('[data-test="history-error"]').exists()).toBe(true)
  })

  it('displays raw durations and the pending-calibration status without inventing volume', () => {
    const wrapper = render({ status: 'ready' }, [record])

    expect(wrapper.get('[data-test="history-flush-duration"]').text()).toContain('3000 ms')
    expect(wrapper.get('[data-test="history-pump-duration"]').text()).toContain('5000 ms')
    expect(wrapper.get('[data-test="history-volume-status"]').text()).toContain('待校正')
    expect(wrapper.text()).not.toContain('mL')
  })

  it('formats UTC-boundary history dates in Asia/Taipei without changing the stored instant', () => {
    const wrapper = render({ status: 'end' }, [record])

    expect(wrapper.get('time').text()).toMatch(/2026\/07\/28\s+00:00/)
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-07-27T16:00:00.000Z')
  })

  it('shows the shared device selector and switches devices when the member owns more than one', async () => {
    const selectDevice = vi.fn()
    const wrapper = mount(HistoryView, {
      props: { state: { status: 'empty' } },
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
    const wrapper = mount(HistoryView, {
      props: { state: { status: 'empty' } },
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
