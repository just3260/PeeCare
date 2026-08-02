import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DeviceSelector from './DeviceSelector.vue'
import type { OwnedDevice } from '@/features/devices/owned-device-model'

function device(deviceId: string, customName: string | null = null): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled', customName }
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

  it('uses resolved labels while duplicate names retain distinct deviceId values', () => {
    const wrapper = mount(DeviceSelector, {
      props: {
        devices: [device('PC-000001', '浴室'), device('PC-000002', '浴室'), device('PC-000003')],
        selectedDeviceId: 'PC-000002',
      },
    })

    const options = wrapper.get('[data-test="device-select"]').findAll('option')
    expect(options.map((option) => option.text())).toEqual(['浴室', '浴室', 'PC-000003'])
    expect(options.map((option) => option.attributes('value'))).toEqual([
      'PC-000001',
      'PC-000002',
      'PC-000003',
    ])
  })

  it('updates a renamed label without changing the selected deviceId', async () => {
    const devices = [device('PC-000001'), device('PC-000002')]
    const wrapper = mount(DeviceSelector, {
      props: { devices, selectedDeviceId: 'PC-000002' },
    })

    await wrapper.setProps({
      devices: [devices[0], { ...devices[1], customName: '主浴室' }],
    })

    const select = wrapper.get('[data-test="device-select"]')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['PC-000001', '主浴室'])
    expect((select.element as HTMLSelectElement).value).toBe('PC-000002')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
