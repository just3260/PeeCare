import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DeviceSelector from './DeviceSelector.vue'
import type { OwnedDevice } from '@/features/devices/owned-device-model'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

describe('DeviceSelector', () => {
  it('renders one option per device and reflects the current selection', () => {
    const wrapper = mount(DeviceSelector, {
      props: { devices: [device('PC-000001'), device('PC-000002')], selectedDeviceId: 'PC-000002' },
    })

    const select = wrapper.get('[data-test="device-select"]')
    expect(select.findAll('option')).toHaveLength(2)
    expect((select.element as HTMLSelectElement).value).toBe('PC-000002')
  })

  it('emits the chosen device id when a different option is picked', async () => {
    const wrapper = mount(DeviceSelector, {
      props: { devices: [device('PC-000001'), device('PC-000002')], selectedDeviceId: 'PC-000001' },
    })

    await wrapper.get('[data-test="device-select"]').setValue('PC-000002')

    expect(wrapper.emitted('select')).toEqual([['PC-000002']])
  })
})
