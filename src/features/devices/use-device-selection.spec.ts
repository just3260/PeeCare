import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { useDeviceSelection, type DeviceSelection } from './use-device-selection'
import { DEVICE_OVERVIEW_STORE_KEY } from './device-overview-store-key'
import type { OwnedDevice } from './owned-device-model'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled', customName: null }
}

/** Run the composable inside a real setup and return its API for assertions. */
function useIn(store: unknown): DeviceSelection {
  let api!: DeviceSelection
  const Harness = defineComponent({
    setup() {
      api = useDeviceSelection()
      return () => h('div')
    },
  })
  const provide = store === null ? {} : { [DEVICE_OVERVIEW_STORE_KEY as symbol]: store }
  mount(Harness, { global: { provide } })
  return api
}

describe('useDeviceSelection', () => {
  it('defaults to an empty selection when no store is provided', () => {
    const api = useIn(null)

    expect(api.devices.value).toEqual([])
    expect(api.selectedDeviceId.value).toBeNull()
    expect(api.hasMultipleDevices.value).toBe(false)
  })

  it('flags multiple devices only when more than one is owned', () => {
    const single = useIn({
      devices: ref([device('PC-000001')]),
      selectedDeviceId: ref('PC-000001'),
      selectDevice: vi.fn(),
    })
    expect(single.hasMultipleDevices.value).toBe(false)

    const many = useIn({
      devices: ref([device('PC-000001'), device('PC-000002')]),
      selectedDeviceId: ref('PC-000002'),
      selectDevice: vi.fn(),
    })
    expect(many.hasMultipleDevices.value).toBe(true)
    expect(many.selectedDeviceId.value).toBe('PC-000002')
  })

  it('delegates selection to the shared store', () => {
    const selectDevice = vi.fn()
    const api = useIn({
      devices: ref([device('PC-000001'), device('PC-000002')]),
      selectedDeviceId: ref('PC-000001'),
      selectDevice,
    })

    api.selectDevice('PC-000002')

    expect(selectDevice).toHaveBeenCalledWith('PC-000002')
  })
})
