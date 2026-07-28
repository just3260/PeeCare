import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DeviceSelector from './DeviceSelector.vue'
import type { OwnedDevice } from '@/features/devices/owned-device-model'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

describe('DeviceSelector', () => {
  it('marks the selected device as active', () => {
    const wrapper = mount(DeviceSelector, {
      props: { devices: [device('PC-000001'), device('PC-000002')], selectedDeviceId: 'PC-000002' },
    })

    expect(wrapper.get('[data-test="device-option-PC-000002"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.get('[data-test="device-option-PC-000001"]').attributes('aria-pressed')).toBe(
      'false',
    )
  })

  it('emits the chosen device id when an option is clicked', async () => {
    const wrapper = mount(DeviceSelector, {
      props: { devices: [device('PC-000001'), device('PC-000002')], selectedDeviceId: 'PC-000001' },
    })

    await wrapper.get('[data-test="device-option-PC-000002"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['PC-000002']])
  })
})
